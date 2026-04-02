use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager};
use tracing::{debug, error, info};

#[derive(Serialize, Deserialize, Clone)]
struct PtyOutput {
    session_id: u32,
    data: String,
}

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    child_pid: Option<u32>,
}

type Sessions = Arc<Mutex<HashMap<u32, PtySession>>>;

pub struct PtyState {
    sessions: Sessions,
}

impl PtyState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[tauri::command]
pub fn create_pty_session(session_id: u32, rows: u16, cols: u16, app: AppHandle) -> Result<(), String> {
    let state = app.state::<PtyState>();
    let sessions = state.sessions.clone();

    if sessions.lock().unwrap().contains_key(&session_id) {
        debug!(session_id, "PTY session already exists, reusing");
        return Ok(());
    }

    let pty_system = NativePtySystem::default();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| {
            error!(session_id, error = %e, "Failed to open PTY");
            e.to_string()
        })?;

    let shell = if cfg!(target_os = "windows") {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    };
    let mut cmd = CommandBuilder::new(&shell);
    if !cfg!(target_os = "windows") {
        cmd.env("TERM", "xterm-256color");
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| {
        error!(session_id, error = %e, "Failed to spawn shell");
        e.to_string()
    })?;
    let child_pid = child.process_id();

    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    sessions.lock().unwrap().insert(
        session_id,
        PtySession {
            writer,
            master: pair.master,
            child_pid,
        },
    );

    info!(session_id, shell = %shell, rows, cols, "PTY session created");

    let app_handle = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    info!(session_id, "PTY session ended");
                    let _ = app_handle.emit("pty-closed", session_id);
                    break;
                }
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_handle.emit(
                        "pty-output",
                        PtyOutput {
                            session_id,
                            data,
                        },
                    );
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn write_to_pty(session_id: u32, data: String, app: AppHandle) -> Result<(), String> {
    let state = app.state::<PtyState>();
    let mut sessions = state.sessions.lock().unwrap();

    if let Some(session) = sessions.get_mut(&session_id) {
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn resize_pty(session_id: u32, rows: u16, cols: u16, app: AppHandle) -> Result<(), String> {
    let state = app.state::<PtyState>();
    let sessions = state.sessions.lock().unwrap();

    if let Some(session) = sessions.get(&session_id) {
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
        debug!(session_id, rows, cols, "PTY resized");
    }

    Ok(())
}

#[tauri::command]
pub fn close_pty_session(session_id: u32, app: AppHandle) -> Result<(), String> {
    let state = app.state::<PtyState>();
    let mut sessions = state.sessions.lock().unwrap();
    if sessions.remove(&session_id).is_some() {
        info!(session_id, "PTY session closed");
    }
    Ok(())
}

#[tauri::command]
pub fn get_pty_cwd(session_id: u32, app: AppHandle) -> Result<String, String> {
    let state = app.state::<PtyState>();
    let sessions = state.sessions.lock().unwrap();

    let session = sessions.get(&session_id).ok_or("Session not found")?;
    let pid = session.child_pid.ok_or("No PID available")?;

    get_cwd_for_pid(pid)
}

#[cfg(target_os = "linux")]
fn get_cwd_for_pid(pid: u32) -> Result<String, String> {
    std::fs::read_link(format!("/proc/{}/cwd", pid))
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn get_cwd_for_pid(pid: u32) -> Result<String, String> {
    const PROC_PIDVNODEPATHINFO: i32 = 9;
    const MAXPATHLEN: usize = 1024;

    #[repr(C)]
    struct VnodeInfoPath {
        _vip_vi: [u8; 152],
        vip_path: [u8; MAXPATHLEN],
    }

    #[repr(C)]
    struct ProcVnodePathInfo {
        pvi_cdir: VnodeInfoPath,
        _pvi_rdir: VnodeInfoPath,
    }

    extern "C" {
        fn proc_pidinfo(
            pid: i32,
            flavor: i32,
            arg: u64,
            buffer: *mut std::ffi::c_void,
            buffersize: i32,
        ) -> i32;
    }

    let mut info = std::mem::MaybeUninit::<ProcVnodePathInfo>::zeroed();
    let ret = unsafe {
        proc_pidinfo(
            pid as i32,
            PROC_PIDVNODEPATHINFO,
            0,
            info.as_mut_ptr() as *mut std::ffi::c_void,
            std::mem::size_of::<ProcVnodePathInfo>() as i32,
        )
    };

    if ret <= 0 {
        return Err(format!("proc_pidinfo failed for pid {}", pid));
    }

    let info = unsafe { info.assume_init() };
    let path = unsafe {
        std::ffi::CStr::from_ptr(info.pvi_cdir.vip_path.as_ptr() as *const std::ffi::c_char)
    };

    Ok(path.to_string_lossy().to_string())
}

#[cfg(target_os = "windows")]
fn get_cwd_for_pid(pid: u32) -> Result<String, String> {
    std::env::var("USERPROFILE")
        .map_err(|_| "Could not determine cwd".to_string())
}

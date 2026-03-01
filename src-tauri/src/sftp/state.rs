use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use russh_sftp::client::SftpSession;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;
use tokio::time::timeout;
use tracing::{debug, error, info};

use crate::ssh::SshState;
use super::errors::*;

pub struct SftpState {
    pub sessions: Arc<Mutex<HashMap<u32, Arc<Mutex<SftpSession>>>>>,
    pub active_transfers: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl SftpState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            active_transfers: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

pub async fn get_session(app: &AppHandle, session_id: u32) -> Result<Arc<Mutex<SftpSession>>, String> {
    let sftp_state = app.state::<SftpState>();
    let sessions = sftp_state.sessions.lock().await;
    sessions.get(&session_id)
        .cloned()
        .ok_or_else(|| format!("SFTP session {} not found", session_id))
}

#[tauri::command]
pub async fn sftp_connect(
    session_id: u32,
    app: AppHandle,
) -> Result<(), String> {
    let ssh_state = app.state::<SshState>();
    let sftp_state = app.state::<SftpState>();

    {
        let sessions = sftp_state.sessions.lock().await;
        if sessions.contains_key(&session_id) {
            debug!(session_id, "SFTP session already exists");
            return Ok(());
        }
    }

    info!(session_id, "Connecting SFTP session");

    let channel = timeout(SFTP_CONNECT_TIMEOUT, ssh_state.open_sftp_channel(session_id))
        .await
        .map_err(|_| timeout_msg("SFTP connect"))?
        .map_err(|e| {
            error!(session_id, error = %e, "Failed to open SFTP channel");
            format!("Failed to open SFTP channel: {}", e)
        })?;

    let sftp = timeout(
        SFTP_CONNECT_TIMEOUT,
        SftpSession::new_opts(channel.into_stream(), Some(SFTP_SESSION_TIMEOUT_SECS)),
    )
    .await
    .map_err(|_| timeout_msg("SFTP session init"))?
    .map_err(|e| {
        error!(session_id, error = %e, "Failed to create SFTP session");
        format!("Failed to create SFTP session: {}", e)
    })?;

    {
        let mut sessions = sftp_state.sessions.lock().await;
        sessions.insert(session_id, Arc::new(Mutex::new(sftp)));
    }

    info!(session_id, "SFTP session connected");
    Ok(())
}

#[tauri::command]
pub async fn sftp_disconnect(
    session_id: u32,
    app: AppHandle,
) -> Result<(), String> {
    let sftp_state = app.state::<SftpState>();
    let mut sessions = sftp_state.sessions.lock().await;

    if let Some(sftp_arc) = sessions.remove(&session_id) {
        let sftp = sftp_arc.lock().await;
        let _ = sftp.close().await;
        info!(session_id, "SFTP session disconnected");
    }

    Ok(())
}

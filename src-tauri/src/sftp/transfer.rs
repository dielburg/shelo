use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};
use tokio::time::timeout;
use tracing::info;

use super::state::{get_session, SftpState};
use super::types::TransferProgress;
use super::errors::*;

#[tauri::command]
pub async fn sftp_upload(
    session_id: u32,
    local_path: String,
    remote_dir: String,
    dest_name: Option<String>,
    app: AppHandle,
) -> Result<String, String> {
    let transfer_id = format!("up-{}-{}", session_id, chrono::Utc::now().timestamp_millis());
    info!(session_id, path = %local_path, dest = %remote_dir, "Starting upload");

    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let sftp_state = app.state::<SftpState>();
        let mut transfers = sftp_state.active_transfers.lock().await;
        transfers.insert(transfer_id.clone(), cancel_flag.clone());
    }

    let local = std::path::Path::new(&local_path);
    let file_name = dest_name.unwrap_or_else(|| {
        local.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "unknown".to_string())
    });

    let result = if local.is_dir() {
        upload_dir_recursive(session_id, local, &remote_dir, &transfer_id, &cancel_flag, &app).await
    } else {
        upload_single_file(session_id, local, &remote_dir, &file_name, &transfer_id, 0, 1, &cancel_flag, &app).await
    };

    let cancelled = cancel_flag.load(Ordering::Relaxed);
    {
        let sftp_state = app.state::<SftpState>();
        let mut transfers = sftp_state.active_transfers.lock().await;
        transfers.remove(&transfer_id);
    }

    let _ = app.emit("transfer-progress", TransferProgress {
        transfer_id: transfer_id.clone(),
        file_name: file_name.clone(),
        bytes_transferred: 0,
        total_bytes: 0,
        files_done: 0,
        files_total: 0,
        speed_bps: 0,
        status: if cancelled { "cancelled" } else { "done" }.to_string(),
    });

    match result {
        Ok(_) => Ok(transfer_id),
        Err(e) if e == "Transfer cancelled" => Ok(transfer_id),
        Err(e) => Err(e),
    }
}

async fn upload_single_file(
    session_id: u32,
    local_path: &std::path::Path,
    remote_dir: &str,
    file_name: &str,
    transfer_id: &str,
    file_index: u32,
    files_total: u32,
    cancel_flag: &Arc<AtomicBool>,
    app: &AppHandle,
) -> Result<(), String> {
    if cancel_flag.load(Ordering::Relaxed) {
        return Err("Transfer cancelled".to_string());
    }

    let local_meta = tokio::fs::metadata(local_path).await.map_err(map_local_error)?;
    let total_bytes = local_meta.len();

    let remote_path = if remote_dir == "/" {
        format!("/{}", file_name)
    } else {
        format!("{}/{}", remote_dir.trim_end_matches('/'), file_name)
    };

    let session_arc = get_session(app, session_id).await?;
    let sftp = session_arc.lock().await;

    let mut remote_file = timeout(SFTP_OP_TIMEOUT, sftp.create(&remote_path))
        .await
        .map_err(|_| timeout_msg("Create remote file"))?
        .map_err(map_sftp_error)?;

    let mut local_file = tokio::fs::File::open(local_path).await.map_err(map_local_error)?;
    let mut buf = vec![0u8; CHUNK_SIZE];
    let start = std::time::Instant::now();
    let mut bytes_written: u64 = 0;

    loop {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("Transfer cancelled".to_string());
        }

        use tokio::io::AsyncReadExt;
        let n = local_file.read(&mut buf).await.map_err(map_local_error)?;
        if n == 0 { break; }

        use tokio::io::AsyncWriteExt;
        timeout(SFTP_TRANSFER_TIMEOUT, remote_file.write_all(&buf[..n]))
            .await
            .map_err(|_| timeout_msg("Upload data"))?
            .map_err(|e| format!("Write error: {}", e))?;

        bytes_written += n as u64;

        let elapsed = start.elapsed().as_secs_f64().max(0.001);
        let speed = (bytes_written as f64 / elapsed) as u64;

        let _ = app.emit("transfer-progress", TransferProgress {
            transfer_id: transfer_id.to_string(),
            file_name: file_name.to_string(),
            bytes_transferred: bytes_written,
            total_bytes,
            files_done: file_index,
            files_total,
            speed_bps: speed,
            status: "uploading".to_string(),
        });
    }

    use tokio::io::AsyncWriteExt;
    let _ = timeout(SFTP_OP_TIMEOUT, remote_file.shutdown()).await;

    Ok(())
}

async fn upload_dir_recursive(
    session_id: u32,
    local_dir: &std::path::Path,
    remote_base: &str,
    transfer_id: &str,
    cancel_flag: &Arc<AtomicBool>,
    app: &AppHandle,
) -> Result<(), String> {
    let dir_name = local_dir.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let _ = app.emit("transfer-progress", TransferProgress {
        transfer_id: transfer_id.to_string(),
        file_name: dir_name,
        bytes_transferred: 0,
        total_bytes: 0,
        files_done: 0,
        files_total: 0,
        speed_bps: 0,
        status: "preparing".to_string(),
    });

    let mut files: Vec<(std::path::PathBuf, String)> = Vec::new();
    collect_local_files(local_dir, local_dir, remote_base, &mut files).map_err(|e| map_local_error(e))?;

    let files_total = files.len() as u32;

    let mut dirs: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (_, remote_path) in &files {
        if let Some(pos) = remote_path.rfind('/') {
            let parent = &remote_path[..pos];
            let parts: Vec<&str> = parent.split('/').filter(|s| !s.is_empty()).collect();
            let mut cur = String::new();
            for part in parts {
                cur = if cur.is_empty() { format!("/{}", part) } else { format!("{}/{}", cur, part) };
                dirs.insert(cur.clone());
            }
        }
    }

    {
        let session_arc = get_session(app, session_id).await?;
        let sftp = session_arc.lock().await;

        let mut sorted_dirs: Vec<String> = dirs.into_iter().collect();
        sorted_dirs.sort();
        for dir in &sorted_dirs {
            if cancel_flag.load(Ordering::Relaxed) {
                return Err("Transfer cancelled".to_string());
            }
            let exists = timeout(SFTP_STAT_TIMEOUT, sftp.try_exists(dir.as_str()))
                .await
                .map_err(|_| timeout_msg("Check dir"))?
                .map_err(map_sftp_error)?;
            if !exists {
                let _ = timeout(SFTP_OP_TIMEOUT, sftp.create_dir(dir.as_str())).await;
            }
        }
    }

    for (i, (local_path, remote_path)) in files.iter().enumerate() {
        let (remote_dir, file_name) = match remote_path.rfind('/') {
            Some(pos) => (remote_path[..pos].to_string(), remote_path[pos + 1..].to_string()),
            None => ("/".to_string(), remote_path.clone()),
        };
        let remote_dir = if remote_dir.is_empty() { "/".to_string() } else { remote_dir };

        upload_single_file(session_id, local_path, &remote_dir, &file_name, transfer_id, i as u32, files_total, cancel_flag, app).await?;
    }

    Ok(())
}

fn collect_local_files(
    base: &std::path::Path,
    current: &std::path::Path,
    remote_base: &str,
    files: &mut Vec<(std::path::PathBuf, String)>,
) -> std::io::Result<()> {
    let dir_name = base.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    for entry in std::fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();
        let relative = path.strip_prefix(base).unwrap_or(&path);
        let relative_str = relative.to_string_lossy().replace('\\', "/");
        let remote_path = format!("{}/{}/{}", remote_base.trim_end_matches('/'), dir_name, relative_str);

        if path.is_dir() {
            collect_local_files(base, &path, remote_base, files)?;
        } else {
            files.push((path, remote_path));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn sftp_upload_paths(
    session_id: u32,
    paths: Vec<String>,
    dest_names: Option<Vec<String>>,
    remote_dir: String,
    app: AppHandle,
) -> Result<(), String> {
    for (i, path) in paths.iter().enumerate() {
        let name = dest_names.as_ref().and_then(|n| n.get(i).cloned());
        sftp_upload(session_id, path.clone(), remote_dir.clone(), name, app.clone()).await.map(|_| ())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn sftp_download(
    session_id: u32,
    remote_path: String,
    local_dir: String,
    is_dir: bool,
    dest_name: Option<String>,
    app: AppHandle,
) -> Result<String, String> {
    let transfer_id = format!("dl-{}-{}", session_id, chrono::Utc::now().timestamp_millis());
    info!(session_id, path = %remote_path, dest = %local_dir, "Starting download");

    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let sftp_state = app.state::<SftpState>();
        let mut transfers = sftp_state.active_transfers.lock().await;
        transfers.insert(transfer_id.clone(), cancel_flag.clone());
    }

    let file_name = dest_name.unwrap_or_else(|| {
        remote_path.rsplit('/').next().unwrap_or("file").to_string()
    });

    let result = if is_dir {
        download_dir_recursive(session_id, &remote_path, &local_dir, &transfer_id, &cancel_flag, &app).await
    } else {
        download_single_file(session_id, &remote_path, &local_dir, &file_name, &transfer_id, 0, 1, &cancel_flag, &app).await
    };

    let cancelled = cancel_flag.load(Ordering::Relaxed);
    {
        let sftp_state = app.state::<SftpState>();
        let mut transfers = sftp_state.active_transfers.lock().await;
        transfers.remove(&transfer_id);
    }

    let _ = app.emit("transfer-progress", TransferProgress {
        transfer_id: transfer_id.clone(),
        file_name: file_name.clone(),
        bytes_transferred: 0,
        total_bytes: 0,
        files_done: 0,
        files_total: 0,
        speed_bps: 0,
        status: if cancelled { "cancelled" } else { "done" }.to_string(),
    });

    match result {
        Ok(_) => Ok(transfer_id),
        Err(e) if e == "Transfer cancelled" => Ok(transfer_id),
        Err(e) => Err(e),
    }
}

async fn download_single_file(
    session_id: u32,
    remote_path: &str,
    local_dir: &str,
    file_name: &str,
    transfer_id: &str,
    file_index: u32,
    files_total: u32,
    cancel_flag: &Arc<AtomicBool>,
    app: &AppHandle,
) -> Result<(), String> {
    if cancel_flag.load(Ordering::Relaxed) {
        return Err("Transfer cancelled".to_string());
    }

    let session_arc = get_session(app, session_id).await?;
    let sftp = session_arc.lock().await;

    let metadata = timeout(SFTP_STAT_TIMEOUT, sftp.metadata(remote_path))
        .await
        .map_err(|_| timeout_msg("Get file info"))?
        .map_err(map_sftp_error)?;
    let total_bytes = metadata.size.unwrap_or(0);

    let _ = app.emit("transfer-progress", TransferProgress {
        transfer_id: transfer_id.to_string(),
        file_name: file_name.to_string(),
        bytes_transferred: 0,
        total_bytes,
        files_done: file_index,
        files_total,
        speed_bps: 0,
        status: "downloading".to_string(),
    });

    let start = std::time::Instant::now();

    let mut remote_file = timeout(SFTP_OP_TIMEOUT, sftp.open(remote_path))
        .await
        .map_err(|_| timeout_msg("Open remote file"))?
        .map_err(map_sftp_error)?;

    drop(sftp);

    let local_path = format!("{}/{}", local_dir.trim_end_matches('/'), file_name);
    let mut local_file = tokio::fs::File::create(&local_path).await.map_err(map_local_error)?;
    let mut buf = vec![0u8; CHUNK_SIZE];
    let mut bytes_downloaded: u64 = 0;

    loop {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("Transfer cancelled".to_string());
        }

        use tokio::io::AsyncReadExt;
        let n = timeout(SFTP_TRANSFER_TIMEOUT, remote_file.read(&mut buf))
            .await
            .map_err(|_| timeout_msg("Download data"))?
            .map_err(|e| format!("Read error: {}", e))?;

        if n == 0 { break; }

        use tokio::io::AsyncWriteExt;
        local_file.write_all(&buf[..n]).await.map_err(map_local_error)?;

        bytes_downloaded += n as u64;

        let elapsed = start.elapsed().as_secs_f64().max(0.001);
        let speed = (bytes_downloaded as f64 / elapsed) as u64;

        let _ = app.emit("transfer-progress", TransferProgress {
            transfer_id: transfer_id.to_string(),
            file_name: file_name.to_string(),
            bytes_transferred: bytes_downloaded,
            total_bytes,
            files_done: file_index,
            files_total,
            speed_bps: speed,
            status: "downloading".to_string(),
        });
    }

    Ok(())
}

async fn download_dir_recursive(
    session_id: u32,
    remote_dir: &str,
    local_base: &str,
    transfer_id: &str,
    cancel_flag: &Arc<AtomicBool>,
    app: &AppHandle,
) -> Result<(), String> {
    let dir_name = remote_dir.rsplit('/').next().unwrap_or("folder");
    let local_root = format!("{}/{}", local_base.trim_end_matches('/'), dir_name);
    tokio::fs::create_dir_all(&local_root).await.map_err(map_local_error)?;

    let _ = app.emit("transfer-progress", TransferProgress {
        transfer_id: transfer_id.to_string(),
        file_name: dir_name.to_string(),
        bytes_transferred: 0,
        total_bytes: 0,
        files_done: 0,
        files_total: 0,
        speed_bps: 0,
        status: "preparing".to_string(),
    });

    let mut files: Vec<(String, String)> = Vec::new();
    collect_remote_files(session_id, remote_dir, &local_root, &mut files, app).await?;

    let files_total = files.len() as u32;
    for (i, (rpath, ldir)) in files.iter().enumerate() {
        let fname = rpath.rsplit('/').next().unwrap_or("file").to_string();
        download_single_file(session_id, rpath, ldir, &fname, transfer_id, i as u32, files_total, cancel_flag, app).await?;
    }

    Ok(())
}

async fn collect_remote_files(
    session_id: u32,
    remote_dir: &str,
    local_dir: &str,
    files: &mut Vec<(String, String)>,
    app: &AppHandle,
) -> Result<(), String> {
    let entries = {
        let session_arc = get_session(app, session_id).await?;
        let sftp = session_arc.lock().await;

        timeout(SFTP_OP_TIMEOUT, sftp.read_dir(remote_dir))
            .await
            .map_err(|_| timeout_msg("List remote dir"))?
            .map_err(map_sftp_error)?
    };

    let mut subdirs = Vec::new();

    for entry in entries {
        let name = entry.file_name();
        if name == "." || name == ".." { continue; }

        let remote_path = format!("{}/{}", remote_dir.trim_end_matches('/'), name);

        if entry.file_type().is_dir() {
            let subdir = format!("{}/{}", local_dir, name);
            tokio::fs::create_dir_all(&subdir).await.map_err(map_local_error)?;
            subdirs.push((remote_path, subdir));
        } else {
            files.push((remote_path, local_dir.to_string()));
        }
    }

    for (rdir, ldir) in subdirs {
        Box::pin(collect_remote_files(session_id, &rdir, &ldir, files, app)).await?;
    }

    Ok(())
}

#[tauri::command]
pub async fn local_copy(
    src_paths: Vec<String>,
    dest_names: Option<Vec<String>>,
    dest_dir: String,
    app: AppHandle,
) -> Result<(), String> {
    let transfer_id = format!("cp-{}", chrono::Utc::now().timestamp_millis());
    info!(count = src_paths.len(), dest = %dest_dir, "Starting local copy");
    let files_total = src_paths.len() as u32;

    for (i, src) in src_paths.iter().enumerate() {
        let src_path = std::path::Path::new(src);
        let file_name = dest_names.as_ref()
            .and_then(|n| n.get(i).cloned())
            .unwrap_or_else(|| {
                src_path.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "unknown".to_string())
            });
        let dest_path = format!("{}/{}", dest_dir.trim_end_matches('/'), file_name);

        let _ = app.emit("transfer-progress", TransferProgress {
            transfer_id: transfer_id.clone(),
            file_name: file_name.clone(),
            bytes_transferred: 0,
            total_bytes: 0,
            files_done: i as u32,
            files_total,
            speed_bps: 0,
            status: "copying".to_string(),
        });

        if src_path.is_dir() {
            copy_dir_recursive(src_path, std::path::Path::new(&dest_path)).await?;
        } else {
            tokio::fs::copy(src, &dest_path).await.map_err(map_local_error)?;
        }
    }

    let _ = app.emit("transfer-progress", TransferProgress {
        transfer_id,
        file_name: "".to_string(),
        bytes_transferred: 0,
        total_bytes: 0,
        files_done: files_total,
        files_total,
        speed_bps: 0,
        status: "done".to_string(),
    });

    Ok(())
}

async fn copy_dir_recursive(src: &std::path::Path, dest: &std::path::Path) -> Result<(), String> {
    tokio::fs::create_dir_all(dest).await.map_err(map_local_error)?;

    let mut dir = tokio::fs::read_dir(src).await.map_err(map_local_error)?;
    while let Some(entry) = dir.next_entry().await.map_err(map_local_error)? {
        let src_child = entry.path();
        let dest_child = dest.join(entry.file_name());

        if src_child.is_dir() {
            Box::pin(copy_dir_recursive(&src_child, &dest_child)).await?;
        } else {
            tokio::fs::copy(&src_child, &dest_child).await.map_err(map_local_error)?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn sftp_cross_transfer(
    src_session_id: u32,
    dest_session_id: u32,
    src_paths: Vec<String>,
    src_is_dirs: Vec<bool>,
    dest_names: Option<Vec<String>>,
    dest_dir: String,
    app: AppHandle,
) -> Result<String, String> {
    let transfer_id = format!("xfer-{}", chrono::Utc::now().timestamp_millis());
    info!(src_session_id, dest_session_id, files = src_paths.len(), "Starting cross-transfer");
    let cancel_flag = Arc::new(AtomicBool::new(false));

    {
        let sftp_state = app.state::<SftpState>();
        let mut transfers = sftp_state.active_transfers.lock().await;
        transfers.insert(transfer_id.clone(), cancel_flag.clone());
    }

    let result = sftp_cross_transfer_inner(
        src_session_id, dest_session_id, &src_paths, &src_is_dirs,
        &dest_names, &dest_dir, &transfer_id, &cancel_flag, &app,
    ).await;

    {
        let sftp_state = app.state::<SftpState>();
        let mut transfers = sftp_state.active_transfers.lock().await;
        transfers.remove(&transfer_id);
    }

    let _ = app.emit("transfer-progress", TransferProgress {
        transfer_id: transfer_id.clone(),
        file_name: "".to_string(),
        bytes_transferred: 0,
        total_bytes: 0,
        files_done: 0,
        files_total: 0,
        speed_bps: 0,
        status: if cancel_flag.load(Ordering::Relaxed) { "cancelled" } else { "done" }.to_string(),
    });

    match result {
        Ok(_) => Ok(transfer_id),
        Err(e) if e == "Transfer cancelled" => Ok(transfer_id),
        Err(e) => Err(e),
    }
}

#[allow(clippy::too_many_arguments)]
async fn sftp_cross_transfer_inner(
    src_session_id: u32,
    dest_session_id: u32,
    src_paths: &[String],
    src_is_dirs: &[bool],
    dest_names: &Option<Vec<String>>,
    dest_dir: &str,
    transfer_id: &str,
    cancel_flag: &Arc<AtomicBool>,
    app: &AppHandle,
) -> Result<(), String> {
    let mut all_files: Vec<(String, String, bool)> = Vec::new();
    for (i, src_path) in src_paths.iter().enumerate() {
        let is_dir = src_is_dirs.get(i).copied().unwrap_or(false);
        let file_name = dest_names.as_ref()
            .and_then(|n| n.get(i).map(|s| s.as_str()))
            .unwrap_or_else(|| src_path.rsplit('/').next().unwrap_or("file"));
        let dest_path = if dest_dir == "/" {
            format!("/{}", file_name)
        } else {
            format!("{}/{}", dest_dir.trim_end_matches('/'), file_name)
        };

        if is_dir {
            collect_remote_files_for_transfer(src_session_id, src_path, &dest_path, &mut all_files, app).await?;
        } else {
            all_files.push((src_path.clone(), dest_path, false));
        }
    }

    let files_total = all_files.len() as u32;

    for (i, (src, dest, is_dir_entry)) in all_files.iter().enumerate() {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("Transfer cancelled".to_string());
        }

        if *is_dir_entry {
            let dest_arc = get_session(app, dest_session_id).await?;
            let sftp = dest_arc.lock().await;
            let exists = timeout(SFTP_STAT_TIMEOUT, sftp.try_exists(dest.as_str()))
                .await
                .map_err(|_| timeout_msg("Check dir"))?
                .map_err(map_sftp_error)?;
            if !exists {
                let _ = timeout(SFTP_OP_TIMEOUT, sftp.create_dir(dest.as_str())).await;
            }
            continue;
        }

        let file_name = src.rsplit('/').next().unwrap_or("file").to_string();

        let total_bytes = {
            let src_arc = get_session(app, src_session_id).await?;
            let sftp = src_arc.lock().await;
            let stat = timeout(SFTP_STAT_TIMEOUT, sftp.metadata(src))
                .await
                .map_err(|_| timeout_msg("Stat source file"))?
                .map_err(map_sftp_error)?;
            stat.len()
        };

        let mut src_file = {
            let src_arc = get_session(app, src_session_id).await?;
            let sftp = src_arc.lock().await;
            timeout(SFTP_OP_TIMEOUT, sftp.open(src))
                .await
                .map_err(|_| timeout_msg("Open source file"))?
                .map_err(map_sftp_error)?
        };

        let mut dest_file = {
            let dest_arc = get_session(app, dest_session_id).await?;
            let sftp = dest_arc.lock().await;
            timeout(SFTP_OP_TIMEOUT, sftp.create(dest))
                .await
                .map_err(|_| timeout_msg("Create dest file"))?
                .map_err(map_sftp_error)?
        };

        let _ = app.emit("transfer-progress", TransferProgress {
            transfer_id: transfer_id.to_string(),
            file_name: file_name.clone(),
            bytes_transferred: 0,
            total_bytes,
            files_done: i as u32,
            files_total,
            speed_bps: 0,
            status: "transferring".to_string(),
        });

        let start = std::time::Instant::now();
        let mut bytes_transferred: u64 = 0;
        let mut buf = vec![0u8; CHUNK_SIZE];
        let mut stream_error: Option<String> = None;

        loop {
            if cancel_flag.load(Ordering::Relaxed) {
                stream_error = Some("Transfer cancelled".to_string());
                break;
            }

            use tokio::io::AsyncReadExt;
            let read_result = timeout(SFTP_TRANSFER_TIMEOUT, src_file.read(&mut buf)).await;
            let n = match read_result {
                Ok(Ok(n)) => n,
                Ok(Err(e)) => { stream_error = Some(format!("Read error: {}", e)); break; }
                Err(_) => { stream_error = Some(timeout_msg("Read source file")); break; }
            };

            if n == 0 { break; }

            use tokio::io::AsyncWriteExt;
            let write_result = timeout(SFTP_TRANSFER_TIMEOUT, dest_file.write_all(&buf[..n])).await;
            match write_result {
                Ok(Ok(())) => {}
                Ok(Err(e)) => { stream_error = Some(format!("Write error: {}", e)); break; }
                Err(_) => { stream_error = Some(timeout_msg("Write dest file")); break; }
            }

            bytes_transferred += n as u64;
            let elapsed = start.elapsed().as_secs_f64().max(0.001);
            let speed = (bytes_transferred as f64 / elapsed) as u64;

            let _ = app.emit("transfer-progress", TransferProgress {
                transfer_id: transfer_id.to_string(),
                file_name: file_name.clone(),
                bytes_transferred,
                total_bytes,
                files_done: i as u32,
                files_total,
                speed_bps: speed,
                status: "transferring".to_string(),
            });
        }

        use tokio::io::AsyncWriteExt;
        let _ = timeout(SFTP_OP_TIMEOUT, dest_file.shutdown()).await;
        drop(src_file);
        drop(dest_file);

        if let Some(err) = stream_error {
            let dest_arc = get_session(app, dest_session_id).await?;
            let sftp = dest_arc.lock().await;
            let _ = timeout(SFTP_OP_TIMEOUT, sftp.remove_file(dest.as_str())).await;
            return Err(err);
        }
    }

    Ok(())
}

async fn collect_remote_files_for_transfer(
    session_id: u32,
    remote_dir: &str,
    dest_dir: &str,
    files: &mut Vec<(String, String, bool)>,
    app: &AppHandle,
) -> Result<(), String> {
    files.push((remote_dir.to_string(), dest_dir.to_string(), true));

    let entries = {
        let session_arc = get_session(app, session_id).await?;
        let sftp = session_arc.lock().await;

        timeout(SFTP_OP_TIMEOUT, sftp.read_dir(remote_dir))
            .await
            .map_err(|_| timeout_msg("List remote dir"))?
            .map_err(map_sftp_error)?
    };

    let mut subdirs = Vec::new();

    for entry in entries {
        let name = entry.file_name();
        if name == "." || name == ".." { continue; }

        let src_path = format!("{}/{}", remote_dir.trim_end_matches('/'), name);
        let dst_path = format!("{}/{}", dest_dir.trim_end_matches('/'), name);

        if entry.file_type().is_dir() {
            subdirs.push((src_path, dst_path));
        } else {
            files.push((src_path, dst_path, false));
        }
    }

    for (src, dst) in subdirs {
        Box::pin(collect_remote_files_for_transfer(session_id, &src, &dst, files, app)).await?;
    }

    Ok(())
}

#[tauri::command]
pub async fn sftp_cancel_transfer(
    transfer_id: String,
    app: AppHandle,
) -> Result<(), String> {
    let sftp_state = app.state::<SftpState>();
    let transfers = sftp_state.active_transfers.lock().await;
    if let Some(cancel_flag) = transfers.get(&transfer_id) {
        info!(transfer_id = %transfer_id, "Transfer cancelled by user");
        cancel_flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

use tauri::AppHandle;
use tokio::time::timeout;

use super::state::get_session;
use super::types::{FileEntry, FileStat};
use super::errors::*;

#[tauri::command]
pub async fn sftp_list_dir(
    session_id: u32,
    path: String,
    app: AppHandle,
) -> Result<Vec<FileEntry>, String> {
    let session_arc = get_session(&app, session_id).await?;
    let sftp = session_arc.lock().await;

    let entries = timeout(SFTP_OP_TIMEOUT, sftp.read_dir(&path))
        .await
        .map_err(|_| timeout_msg("List directory"))?
        .map_err(map_sftp_error)?;

    let mut result = Vec::new();

    for entry in entries {
        let name = entry.file_name();

        if name == "." || name == ".." {
            continue;
        }

        let full_path = if path == "/" {
            format!("/{}", name)
        } else {
            format!("{}/{}", path.trim_end_matches('/'), name)
        };

        let metadata = entry.metadata();
        let is_symlink = metadata.file_type().is_symlink();

        let (is_dir, symlink_target) = if is_symlink {
            let target = sftp.read_link(full_path.as_str()).await.ok();
            let resolved_is_dir = sftp.metadata(full_path.as_str()).await
                .map(|m| m.file_type().is_dir())
                .unwrap_or(false);
            (resolved_is_dir, target)
        } else {
            (metadata.file_type().is_dir(), None)
        };

        result.push(FileEntry {
            name,
            path: full_path,
            is_dir,
            is_symlink,
            symlink_target,
            size: metadata.size.unwrap_or(0),
            modified: metadata.mtime.map(|v| v as u64),
            permissions: metadata.permissions,
        });
    }

    result.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(result)
}

#[tauri::command]
pub async fn sftp_get_cwd(
    session_id: u32,
    app: AppHandle,
) -> Result<String, String> {
    let session_arc = get_session(&app, session_id).await?;
    let sftp = session_arc.lock().await;

    timeout(SFTP_STAT_TIMEOUT, sftp.canonicalize("."))
        .await
        .map_err(|_| timeout_msg("Get working directory"))?
        .map_err(map_sftp_error)
}

#[tauri::command]
pub async fn sftp_stat(
    session_id: u32,
    path: String,
    app: AppHandle,
) -> Result<FileStat, String> {
    let session_arc = get_session(&app, session_id).await?;
    let sftp = session_arc.lock().await;

    let lstat = timeout(SFTP_STAT_TIMEOUT, sftp.symlink_metadata(&path))
        .await
        .map_err(|_| timeout_msg("Get file info"))?
        .map_err(map_sftp_error)?;

    let is_symlink = lstat.file_type().is_symlink();

    let (metadata, symlink_target) = if is_symlink {
        let target = sftp.read_link(path.as_str()).await.ok();
        let resolved = sftp.metadata(path.as_str()).await.unwrap_or(lstat.clone());
        (resolved, target)
    } else {
        (lstat, None)
    };

    Ok(FileStat {
        size: metadata.size.unwrap_or(0),
        is_dir: metadata.file_type().is_dir(),
        is_symlink,
        symlink_target,
        modified: metadata.mtime.map(|v| v as u64),
        accessed: metadata.atime.map(|v| v as u64),
        permissions: metadata.permissions,
        uid: metadata.uid,
        gid: metadata.gid,
    })
}

#[tauri::command]
pub async fn sftp_read_file(
    session_id: u32,
    path: String,
    app: AppHandle,
) -> Result<Vec<u8>, String> {
    let session_arc = get_session(&app, session_id).await?;
    let sftp = session_arc.lock().await;

    timeout(SFTP_TRANSFER_TIMEOUT, sftp.read(&path))
        .await
        .map_err(|_| timeout_msg("Read file"))?
        .map_err(map_sftp_error)
}

#[tauri::command]
pub async fn sftp_write_file(
    session_id: u32,
    path: String,
    data: Vec<u8>,
    app: AppHandle,
) -> Result<(), String> {
    let session_arc = get_session(&app, session_id).await?;
    let sftp = session_arc.lock().await;

    timeout(SFTP_TRANSFER_TIMEOUT, sftp.write(&path, &data))
        .await
        .map_err(|_| timeout_msg("Write file"))?
        .map_err(map_sftp_error)
}

#[tauri::command]
pub async fn sftp_create_file(
    session_id: u32,
    path: String,
    app: AppHandle,
) -> Result<(), String> {
    let session_arc = get_session(&app, session_id).await?;
    let sftp = session_arc.lock().await;

    let exists = timeout(SFTP_STAT_TIMEOUT, sftp.try_exists(&path))
        .await
        .map_err(|_| timeout_msg("Check file"))?
        .map_err(map_sftp_error)?;

    if exists {
        return Err(format!("Already exists: {}", path.rsplit('/').next().unwrap_or(&path)));
    }

    let _file = timeout(SFTP_OP_TIMEOUT, sftp.create(&path))
        .await
        .map_err(|_| timeout_msg("Create file"))?
        .map_err(map_sftp_error)?;

    Ok(())
}

#[tauri::command]
pub async fn sftp_mkdir(
    session_id: u32,
    path: String,
    app: AppHandle,
) -> Result<(), String> {
    let session_arc = get_session(&app, session_id).await?;
    let sftp = session_arc.lock().await;

    let exists = timeout(SFTP_STAT_TIMEOUT, sftp.try_exists(&path))
        .await
        .map_err(|_| timeout_msg("Check directory"))?
        .map_err(map_sftp_error)?;

    if exists {
        return Err(format!("Already exists: {}", path.rsplit('/').next().unwrap_or(&path)));
    }

    timeout(SFTP_OP_TIMEOUT, sftp.create_dir(&path))
        .await
        .map_err(|_| timeout_msg("Create directory"))?
        .map_err(map_sftp_error)
}

#[tauri::command]
pub async fn sftp_remove(
    session_id: u32,
    path: String,
    is_dir: bool,
    app: AppHandle,
) -> Result<(), String> {
    if is_dir {
        sftp_remove_dir_recursive(session_id, &path, &app).await
    } else {
        let session_arc = get_session(&app, session_id).await?;
        let sftp = session_arc.lock().await;

        timeout(SFTP_OP_TIMEOUT, sftp.remove_file(&path))
            .await
            .map_err(|_| timeout_msg("Remove file"))?
            .map_err(|e| map_sftp_error_ctx(e, &path))
    }
}

async fn sftp_remove_dir_recursive(
    session_id: u32,
    path: &str,
    app: &AppHandle,
) -> Result<(), String> {
    let entries = {
        let session_arc = get_session(app, session_id).await?;
        let sftp = session_arc.lock().await;

        timeout(SFTP_OP_TIMEOUT, sftp.read_dir(path))
            .await
            .map_err(|_| timeout_msg("List directory for removal"))?
            .map_err(|e| map_sftp_error_ctx(e, path))?
    };

    for entry in entries {
        let name = entry.file_name();
        if name == "." || name == ".." { continue; }

        let child_path = format!("{}/{}", path.trim_end_matches('/'), name);

        if entry.file_type().is_dir() {
            Box::pin(sftp_remove_dir_recursive(session_id, &child_path, app)).await?;
        } else {
            let session_arc = get_session(app, session_id).await?;
            let sftp = session_arc.lock().await;

            timeout(SFTP_OP_TIMEOUT, sftp.remove_file(&child_path))
                .await
                .map_err(|_| timeout_msg("Remove file"))?
                .map_err(|e| map_sftp_error_ctx(e, &child_path))?;
        }
    }

    let session_arc = get_session(app, session_id).await?;
    let sftp = session_arc.lock().await;

    timeout(SFTP_OP_TIMEOUT, sftp.remove_dir(path))
        .await
        .map_err(|_| timeout_msg("Remove directory"))?
        .map_err(|e| map_sftp_error_ctx(e, path))
}

#[tauri::command]
pub async fn sftp_rename(
    session_id: u32,
    old_path: String,
    new_path: String,
    app: AppHandle,
) -> Result<(), String> {
    let session_arc = get_session(&app, session_id).await?;
    let sftp = session_arc.lock().await;

    timeout(SFTP_OP_TIMEOUT, sftp.rename(&old_path, &new_path))
        .await
        .map_err(|_| timeout_msg("Rename"))?
        .map_err(map_sftp_error)
}

#[tauri::command]
pub async fn sftp_chmod(
    session_id: u32,
    path: String,
    permissions: u32,
    app: AppHandle,
) -> Result<(), String> {
    let session_arc = get_session(&app, session_id).await?;
    let sftp = session_arc.lock().await;

    use russh_sftp::protocol::FileAttributes;
    let mut attrs = FileAttributes::default();
    attrs.permissions = Some(permissions);

    timeout(SFTP_OP_TIMEOUT, sftp.set_metadata(&path, attrs))
        .await
        .map_err(|_| timeout_msg("Set permissions"))?
        .map_err(map_sftp_error)
}

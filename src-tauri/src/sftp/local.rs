use super::types::{FileEntry, FileStat};
use super::errors::map_local_error;

fn normalize_path(path: String) -> String {
    if cfg!(target_os = "windows") {
        path.replace('\\', "/")
    } else {
        path
    }
}

#[tauri::command]
pub async fn local_list_dir(path: String) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();

    let mut dir = tokio::fs::read_dir(&path)
        .await
        .map_err(map_local_error)?;

    while let Some(entry) = dir.next_entry().await.map_err(|e| map_local_error(e))? {
        let name = entry.file_name().to_string_lossy().to_string();
        let full_path = normalize_path(entry.path().to_string_lossy().to_string());

        let lmeta = tokio::fs::symlink_metadata(&full_path).await.map_err(map_local_error)?;
        let is_symlink = lmeta.file_type().is_symlink();

        let (metadata, symlink_target) = if is_symlink {
            let target = tokio::fs::read_link(&full_path).await
                .ok()
                .map(|p| normalize_path(p.to_string_lossy().to_string()));
            let resolved = tokio::fs::metadata(&full_path).await.unwrap_or(lmeta.clone());
            (resolved, target)
        } else {
            (lmeta, None)
        };

        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs());

        #[cfg(unix)]
        let permissions = {
            use std::os::unix::fs::PermissionsExt;
            Some(metadata.permissions().mode())
        };
        #[cfg(not(unix))]
        let permissions = None;

        entries.push(FileEntry {
            name,
            path: full_path,
            is_dir: metadata.is_dir(),
            is_symlink,
            symlink_target,
            size: metadata.len(),
            modified,
            permissions,
        });
    }

    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[tauri::command]
pub async fn local_get_cwd() -> Result<String, String> {
    std::env::current_dir()
        .map(|p| normalize_path(p.to_string_lossy().to_string()))
        .map_err(|e| map_local_error(e))
}

#[tauri::command]
pub async fn local_stat(path: String) -> Result<FileStat, String> {
    let lmeta = tokio::fs::symlink_metadata(&path)
        .await
        .map_err(map_local_error)?;
    let is_symlink = lmeta.file_type().is_symlink();

    let (metadata, symlink_target) = if is_symlink {
        let target = tokio::fs::read_link(&path).await
            .ok()
            .map(|p| normalize_path(p.to_string_lossy().to_string()));
        let resolved = tokio::fs::metadata(&path).await.unwrap_or(lmeta.clone());
        (resolved, target)
    } else {
        (lmeta, None)
    };

    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());

    let accessed = metadata
        .accessed()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());

    #[cfg(unix)]
    let (permissions, uid, gid) = {
        use std::os::unix::fs::MetadataExt;
        use std::os::unix::fs::PermissionsExt;
        (
            Some(metadata.permissions().mode()),
            Some(metadata.uid()),
            Some(metadata.gid()),
        )
    };
    #[cfg(not(unix))]
    let (permissions, uid, gid) = (None, None, None);

    Ok(FileStat {
        size: metadata.len(),
        is_dir: metadata.is_dir(),
        is_symlink,
        symlink_target,
        modified,
        accessed,
        permissions,
        uid,
        gid,
    })
}

#[tauri::command]
pub async fn local_read_file(path: String) -> Result<Vec<u8>, String> {
    tokio::fs::read(&path)
        .await
        .map_err(map_local_error)
}

#[tauri::command]
pub async fn local_write_file(path: String, data: Vec<u8>) -> Result<(), String> {
    tokio::fs::write(&path, &data)
        .await
        .map_err(map_local_error)
}

#[tauri::command]
pub async fn local_mkdir(path: String) -> Result<(), String> {
    tokio::fs::create_dir(&path)
        .await
        .map_err(map_local_error)
}

#[tauri::command]
pub async fn local_remove(path: String, is_dir: bool) -> Result<(), String> {
    if is_dir {
        tokio::fs::remove_dir_all(&path)
            .await
            .map_err(map_local_error)
    } else {
        tokio::fs::remove_file(&path)
            .await
            .map_err(map_local_error)
    }
}

#[tauri::command]
pub async fn local_rename(old_path: String, new_path: String) -> Result<(), String> {
    tokio::fs::rename(&old_path, &new_path)
        .await
        .map_err(map_local_error)
}

#[tauri::command]
pub async fn local_chmod(path: String, permissions: u32) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(permissions);
        tokio::fs::set_permissions(&path, perms)
            .await
            .map_err(map_local_error)
    }
    #[cfg(not(unix))]
    {
        let _ = (path, permissions);
        Err("Changing permissions is not supported on this platform".to_string())
    }
}

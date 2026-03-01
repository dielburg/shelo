pub mod crypto;
pub mod keychain;
pub mod store;

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use store::{EncryptedStore, HostEntry, HostStore, HostsFile, PlaintextStore};
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;
use tracing::{debug, info, warn};

pub struct HostsState {
    pub store: Mutex<Option<HostStore>>,
    pub data_dir: PathBuf,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct HostDto {
    pub id: u32,
    pub label: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub group: String,
    pub has_password: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jump_path: Option<Vec<u32>>,
}

#[derive(Deserialize)]
pub struct HostPayload {
    pub id: Option<u32>,
    pub label: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub group: String,
    pub jump_path: Option<Vec<u32>>,
}

#[derive(Serialize)]
pub struct VaultStatus {
    pub status: String,
}

impl HostsState {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            store: Mutex::new(None),
            data_dir,
        }
    }

    pub fn try_auto_unlock(&self) -> Option<HostStore> {
        if !EncryptedStore::exists(&self.data_dir) {
            return None;
        }

        let password = keychain::get_master_password()?;
        match EncryptedStore::new(&self.data_dir, password) {
            Ok(store) => {
                info!("Vault auto-unlocked from keychain");
                Some(HostStore::Encrypted(store))
            }
            Err(e) => {
                warn!(error = %e, "Keychain password invalid, clearing");
                keychain::delete_master_password();
                None
            }
        }
    }

    fn entry_to_dto(entry: &HostEntry) -> HostDto {
        HostDto {
            id: entry.id,
            label: entry.label.clone(),
            hostname: entry.hostname.clone(),
            port: entry.port,
            username: entry.username.clone(),
            group: entry.group.clone(),
            has_password: entry.password.is_some(),
            jump_path: entry.jump_path.clone().filter(|p| !p.is_empty()),
        }
    }
}

fn require_store(store: &Option<HostStore>) -> Result<&HostStore, String> {
    store.as_ref().ok_or_else(|| "Vault is locked".to_string())
}

#[tauri::command]
pub async fn get_vault_status(app: AppHandle) -> Result<VaultStatus, String> {
    let state = app.state::<HostsState>();
    let store = state.store.lock().await;

    let status = if store.is_some() {
        match store.as_ref().unwrap() {
            HostStore::Encrypted(_) => "unlocked",
            HostStore::Plaintext(_) => "plaintext",
        }
    } else if EncryptedStore::exists(&state.data_dir) {
        "locked"
    } else if PlaintextStore::exists(&state.data_dir) {
        drop(store);
        let plaintext = PlaintextStore::new(&state.data_dir)?;
        let mut store = state.store.lock().await;
        *store = Some(HostStore::Plaintext(plaintext));
        "plaintext"
    } else {
        "first_run"
    };

    debug!(status, "Vault status checked");
    Ok(VaultStatus {
        status: status.to_string(),
    })
}

#[tauri::command]
pub async fn setup_vault(
    mode: String,
    password: Option<String>,
    app: AppHandle,
) -> Result<(), String> {
    info!(mode = %mode, "Setting up vault");
    let state = app.state::<HostsState>();
    let mut store = state.store.lock().await;

    let new_store = match mode.as_str() {
        "encrypted" => {
            let pw = password.ok_or("Password is required for encrypted vault")?;
            if pw.is_empty() {
                return Err("Password cannot be empty".to_string());
            }
            let encrypted = EncryptedStore::create(&state.data_dir, pw.clone())?;

            let _ = keychain::store_master_password(&pw);

            info!("Encrypted vault created");
            HostStore::Encrypted(encrypted)
        }
        "plaintext" => {
            let plaintext = PlaintextStore::new(&state.data_dir)?;
            warn!("Plaintext vault created (not recommended)");
            HostStore::Plaintext(plaintext)
        }
        _ => return Err(format!("Unknown vault mode: {}", mode)),
    };

    *store = Some(new_store);
    Ok(())
}

#[tauri::command]
pub async fn unlock_vault(password: String, app: AppHandle) -> Result<(), String> {
    info!("Unlocking vault with master password");
    let state = app.state::<HostsState>();
    let mut store = state.store.lock().await;

    let encrypted = EncryptedStore::new(&state.data_dir, password.clone()).map_err(|e| {
        warn!(error = %e, "Vault unlock failed");
        e
    })?;

    let _ = keychain::store_master_password(&password);

    *store = Some(HostStore::Encrypted(encrypted));
    info!("Vault unlocked successfully");
    Ok(())
}

#[tauri::command]
pub async fn lock_vault(app: AppHandle) -> Result<(), String> {
    let state = app.state::<HostsState>();
    let mut store = state.store.lock().await;

    match store.as_ref() {
        Some(HostStore::Encrypted(_)) => {
            *store = None;
            info!("Vault locked");
            Ok(())
        }
        Some(HostStore::Plaintext(_)) => Err("Cannot lock a plaintext store".to_string()),
        None => Ok(()),
    }
}

#[tauri::command]
pub async fn import_vault(path: String, password: Option<String>, app: AppHandle) -> Result<(), String> {
    info!(path = %path, "Importing vault");
    let state = app.state::<HostsState>();
    let mut store = state.store.lock().await;

    let source = PathBuf::from(&path);
    if !source.exists() {
        return Err("File not found".to_string());
    }

    let file_data = std::fs::read(&source).map_err(|e| format!("Failed to read file: {}", e))?;

    let is_vault = file_data.len() >= 4 && &file_data[0..4] == b"SHEV";

    if is_vault {
        let pw = password.ok_or("Password is required for encrypted vault import")?;

        crypto::decrypt(&file_data, &pw)?;

        let dest = state.data_dir.join("hosts.vault");
        std::fs::create_dir_all(&state.data_dir).map_err(|e| e.to_string())?;
        std::fs::write(&dest, &file_data).map_err(|e| format!("Failed to copy vault: {}", e))?;

        let encrypted = EncryptedStore::new(&state.data_dir, pw.clone())?;
        let _ = keychain::store_master_password(&pw);
        *store = Some(HostStore::Encrypted(encrypted));
        info!("Encrypted vault imported successfully");
    } else {
        let _hosts_file: HostsFile = serde_json::from_slice(&file_data)
            .map_err(|e| format!("Invalid hosts file: {}", e))?;

        let dest = state.data_dir.join("hosts.json");
        std::fs::create_dir_all(&state.data_dir).map_err(|e| e.to_string())?;
        std::fs::write(&dest, &file_data).map_err(|e| format!("Failed to copy file: {}", e))?;

        let plaintext = PlaintextStore::new(&state.data_dir)?;
        *store = Some(HostStore::Plaintext(plaintext));
        info!("Plaintext hosts file imported");
    }

    Ok(())
}

#[tauri::command]
pub async fn migrate_to_encrypted(password: String, app: AppHandle) -> Result<(), String> {
    info!("Migrating plaintext store to encrypted vault");
    let state = app.state::<HostsState>();
    let mut store = state.store.lock().await;

    let current = require_store(&store)?;
    match current {
        HostStore::Plaintext(_) => {}
        HostStore::Encrypted(_) => return Err("Already encrypted".to_string()),
    };

    let hosts_file = current.read_hosts_file();

    let json = serde_json::to_string_pretty(&hosts_file).map_err(|e| e.to_string())?;
    let vault_data = crypto::encrypt(json.as_bytes(), &password)?;
    std::fs::create_dir_all(&state.data_dir).map_err(|e| e.to_string())?;
    std::fs::write(state.data_dir.join("hosts.vault"), vault_data)
        .map_err(|e| format!("Failed to write vault: {}", e))?;

    let json_path = state.data_dir.join("hosts.json");
    let bak_path = state.data_dir.join("hosts.json.bak");
    if json_path.exists() {
        let _ = std::fs::rename(&json_path, &bak_path);
    }

    let _ = keychain::store_master_password(&password);

    let reopened = EncryptedStore::new(&state.data_dir, password)?;
    *store = Some(HostStore::Encrypted(reopened));

    info!("Migration to encrypted vault complete");
    Ok(())
}

#[tauri::command]
pub async fn change_master_password(
    current_password: String,
    new_password: String,
    app: AppHandle,
) -> Result<(), String> {
    info!("Changing master password");
    let state = app.state::<HostsState>();
    let mut store = state.store.lock().await;

    if new_password.is_empty() {
        return Err("New password cannot be empty".to_string());
    }

    match store.as_mut() {
        Some(HostStore::Encrypted(s)) => {
            let vault_data = std::fs::read(state.data_dir.join("hosts.vault"))
                .map_err(|e| format!("Failed to read vault: {}", e))?;
            let verify_key = crypto::derive_key_from_vault(&vault_data, &current_password)?;
            crypto::decrypt_with_key(&vault_data, &verify_key)
                .map_err(|_| "Current password is incorrect".to_string())?;

            s.change_password(new_password.clone())?;
            let _ = keychain::store_master_password(&new_password);
            info!("Master password changed successfully");
            Ok(())
        }
        Some(HostStore::Plaintext(_)) => Err("Cannot change password on plaintext store".to_string()),
        None => Err("Vault is locked".to_string()),
    }
}

#[tauri::command]
pub async fn get_hosts(app: AppHandle) -> Result<Vec<HostDto>, String> {
    let state = app.state::<HostsState>();
    let store = state.store.lock().await;
    let s = require_store(&store)?;
    let entries = s.list()?;
    Ok(entries.iter().map(HostsState::entry_to_dto).collect())
}

#[tauri::command]
pub async fn save_host(payload: HostPayload, app: AppHandle) -> Result<HostDto, String> {
    let state = app.state::<HostsState>();
    let store = state.store.lock().await;
    let s = require_store(&store)?;

    let group = if payload.group.trim().is_empty() {
        "default".to_string()
    } else {
        payload.group.trim().to_string()
    };

    let password = if payload.id.is_some() {
        match &payload.password {
            Some(pw) if !pw.is_empty() => Some(pw.clone()),
            _ => s
                .list()?
                .iter()
                .find(|h| h.id == payload.id.unwrap())
                .and_then(|h| h.password.clone()),
        }
    } else {
        payload.password.filter(|pw| !pw.is_empty())
    };

    let jump_path = payload.jump_path.filter(|p| !p.is_empty());

    let entry = HostEntry {
        id: payload.id.unwrap_or(0),
        label: if payload.label.trim().is_empty() {
            payload.hostname.trim().to_string()
        } else {
            payload.label.trim().to_string()
        },
        hostname: payload.hostname.trim().to_string(),
        port: payload.port,
        username: payload.username.trim().to_string(),
        group,
        password,
        jump_path,
    };

    let saved = if payload.id.is_some() {
        s.update(entry.clone())?;
        info!(id = entry.id, label = %entry.label, "Host updated");
        entry
    } else {
        let added = s.add(entry)?;
        info!(id = added.id, label = %added.label, "Host added");
        added
    };

    Ok(HostsState::entry_to_dto(&saved))
}

#[tauri::command]
pub async fn delete_host(id: u32, app: AppHandle) -> Result<(), String> {
    let state = app.state::<HostsState>();
    let store = state.store.lock().await;
    let s = require_store(&store)?;
    s.delete(id)?;
    info!(id, "Host deleted");
    Ok(())
}

#[tauri::command]
pub async fn export_vault(dest_path: String, app: AppHandle) -> Result<(), String> {
    let state = app.state::<HostsState>();
    let store = state.store.lock().await;
    let s = require_store(&store)?;

    let source = match s {
        HostStore::Encrypted(_) => state.data_dir.join("hosts.vault"),
        HostStore::Plaintext(_) => state.data_dir.join("hosts.json"),
    };

    if !source.exists() {
        return Err("No vault file found to export".to_string());
    }

    std::fs::copy(&source, &dest_path)
        .map_err(|e| format!("Failed to export vault: {}", e))?;

    info!(dest = %dest_path, "Vault exported");
    Ok(())
}

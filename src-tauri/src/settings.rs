use std::path::PathBuf;
use tauri::Manager;
use tokio::sync::Mutex;
use tracing::{info, warn};

pub struct SettingsState {
    file_path: PathBuf,
    settings: Mutex<serde_json::Value>,
}

impl SettingsState {
    pub fn new(data_dir: PathBuf) -> Self {
        let file_path = data_dir.join("settings.json");
        let settings = if file_path.exists() {
            match std::fs::read_to_string(&file_path) {
                Ok(content) => {
                    serde_json::from_str(&content).unwrap_or_else(|e| {
                        warn!("Failed to parse settings.json: {}, using defaults", e);
                        serde_json::Value::Object(serde_json::Map::new())
                    })
                }
                Err(e) => {
                    warn!("Failed to read settings.json: {}, using defaults", e);
                    serde_json::Value::Object(serde_json::Map::new())
                }
            }
        } else {
            serde_json::Value::Object(serde_json::Map::new())
        };

        Self {
            file_path,
            settings: Mutex::new(settings),
        }
    }
}

#[tauri::command]
pub async fn get_settings(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let state = app.state::<SettingsState>();
    let settings = state.settings.lock().await;
    Ok(settings.clone())
}

#[tauri::command]
pub async fn set_settings(settings: serde_json::Value, app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<SettingsState>();
    let mut current = state.settings.lock().await;
    *current = settings.clone();

    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    std::fs::write(&state.file_path, json)
        .map_err(|e| format!("Failed to write settings.json: {}", e))?;

    info!("Settings saved");
    Ok(())
}

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::Mutex;
use tracing::{info, warn};

#[derive(Debug, Clone, Serialize)]
pub struct UpdateCheckResult {
    pub available: bool,
    pub version: String,
    pub notes: String,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    prerelease: bool,
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
}

pub struct UpdaterState {
    pending: Mutex<Option<tauri_plugin_updater::Update>>,
}

impl UpdaterState {
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(None),
        }
    }
}

const GITHUB_REPO: &str = "dielburg/shelo";
const STABLE_ENDPOINT: &str =
    "https://github.com/dielburg/shelo/releases/latest/download/latest.json";

async fn find_beta_endpoint() -> Result<String, String> {
    let url = format!("https://api.github.com/repos/{}/releases", GITHUB_REPO);

    let client = reqwest::Client::builder()
        .user_agent("shelo-updater")
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let releases: Vec<GitHubRelease> = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch releases: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse releases: {}", e))?;

    let release = releases
        .iter()
        .find(|r| r.assets.iter().any(|a| a.name == "latest.json"))
        .ok_or_else(|| "No release with update manifest found".to_string())?;

    let endpoint = format!(
        "https://github.com/{}/releases/download/{}/latest.json",
        GITHUB_REPO, release.tag_name
    );

    info!(
        "Beta endpoint resolved: {} (prerelease={})",
        release.tag_name, release.prerelease
    );

    Ok(endpoint)
}

#[tauri::command]
pub async fn check_for_update(app: tauri::AppHandle) -> Result<UpdateCheckResult, String> {
    let settings_state = app.state::<crate::settings::SettingsState>();
    let settings = crate::settings::get_settings_internal(&settings_state).await;

    let include_beta = settings
        .get("includeBetaUpdates")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    info!("Checking for updates (include_beta={})", include_beta);

    let endpoint = if include_beta {
        match find_beta_endpoint().await {
            Ok(ep) => ep,
            Err(e) => {
                warn!("Beta endpoint lookup failed, falling back to stable: {}", e);
                STABLE_ENDPOINT.to_string()
            }
        }
    } else {
        STABLE_ENDPOINT.to_string()
    };

    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint.parse().map_err(|e| format!("Invalid URL: {}", e))?])
        .map_err(|e| format!("Failed to set endpoints: {}", e))?
        .build()
        .map_err(|e| format!("Failed to build updater: {}", e))?;

    match updater.check().await {
        Ok(Some(update)) => {
            let result = UpdateCheckResult {
                available: true,
                version: update.version.clone(),
                notes: update.body.clone().unwrap_or_default(),
            };
            info!("Update available: v{}", update.version);

            let updater_state = app.state::<UpdaterState>();
            *updater_state.pending.lock().await = Some(update);

            Ok(result)
        }
        Ok(None) => {
            info!("No update available");
            let updater_state = app.state::<UpdaterState>();
            *updater_state.pending.lock().await = None;

            Ok(UpdateCheckResult {
                available: false,
                version: String::new(),
                notes: String::new(),
            })
        }
        Err(e) => {
            warn!("Update check failed: {}", e);
            Err(format!("Update check failed: {}", e))
        }
    }
}

#[derive(Clone, Serialize)]
struct DownloadProgressPayload {
    downloaded: u64,
    total: Option<u64>,
}

#[tauri::command]
pub async fn download_and_install_update(app: tauri::AppHandle) -> Result<(), String> {
    let updater_state = app.state::<UpdaterState>();
    let update = updater_state
        .pending
        .lock()
        .await
        .take()
        .ok_or_else(|| "No pending update".to_string())?;

    info!("Downloading update v{}", update.version);

    let app_handle = app.clone();
    let app_handle2 = app.clone();
    update
        .download_and_install(
            move |chunk_length, total| {
                let _ = app_handle.emit(
                    "update-download-progress",
                    DownloadProgressPayload {
                        downloaded: chunk_length as u64,
                        total: total,
                    },
                );
            },
            move || {
                let _ = app_handle2.emit(
                    "update-download-progress",
                    DownloadProgressPayload {
                        downloaded: 0,
                        total: Some(0),
                    },
                );
            },
        )
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    info!("Update downloaded and installed, relaunch required");
    Ok(())
}

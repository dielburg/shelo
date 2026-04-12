mod hosts;
mod pty;
mod settings;
mod sftp;
mod ssh;

use tauri::Manager;
use tauri::menu::{MenuBuilder, SubmenuBuilder};
use tracing::info;

#[tauri::command]
fn get_platform() -> &'static str {
    std::env::consts::OS
}

// -- Consider old log files cleanup
fn setup_logging(data_dir: &std::path::Path) {
    let logs_dir = data_dir.join("logs");
    std::fs::create_dir_all(&logs_dir).ok();

    let file_appender = tracing_appender::rolling::daily(&logs_dir, "shelo.log");

    tracing_subscriber::fmt()
        .with_writer(file_appender)
        .with_ansi(false)
        .with_target(true)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| e.to_string())?;

            setup_logging(&data_dir);
            info!("Shelo v{} ({}) starting", env!("CARGO_PKG_VERSION"), env!("GIT_HASH"));
            info!("Data directory: {}", data_dir.display());

            app.manage(pty::PtyState::new());
            app.manage(ssh::SshState::new(data_dir.clone()));
            app.manage(sftp::SftpState::new());
            app.manage(settings::SettingsState::new(data_dir.clone()));

            let hosts_state = hosts::HostsState::new(data_dir);

            if let Some(store) = hosts_state.try_auto_unlock() {
                *hosts_state.store.blocking_lock() = Some(store);
                info!("Vault auto-unlocked via keychain");
            }

            app.manage(hosts_state);

            #[cfg(target_os = "macos")]
            {
                let app_name = "shelo";
                let menu = MenuBuilder::new(app)
                    .item(
                        &SubmenuBuilder::new(app, app_name)
                            .about(None)
                            .separator()
                            .hide()
                            .hide_others()
                            .show_all()
                            .separator()
                            .quit()
                            .build()?,
                    )
                    .item(
                        &SubmenuBuilder::new(app, "Edit")
                            .undo()
                            .redo()
                            .separator()
                            .cut()
                            .copy()
                            .paste()
                            .select_all()
                            .build()?,
                    )
                    .item(
                        &SubmenuBuilder::new(app, "Window")
                            .minimize()
                            .build()?,
                    )
                    .build()?;
                app.set_menu(menu)?;
            }

            if cfg!(not(target_os = "macos")) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_decorations(false);
                }
            }

            info!("Application setup complete");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_platform,
            pty::create_pty_session,
            pty::write_to_pty,
            pty::resize_pty,
            pty::close_pty_session,
            pty::get_pty_cwd,
            ssh::create_ssh_session,
            ssh::write_to_ssh,
            ssh::resize_ssh,
            ssh::close_ssh_session,
            ssh::respond_host_key,
            hosts::get_vault_status,
            hosts::setup_vault,
            hosts::unlock_vault,
            hosts::lock_vault,
            hosts::import_vault,
            hosts::migrate_to_encrypted,
            hosts::change_master_password,
            hosts::get_hosts,
            hosts::get_host_password,
            hosts::save_host,
            hosts::delete_host,
            hosts::get_tunnels,
            hosts::save_tunnel,
            hosts::delete_tunnel,
            hosts::export_vault,
            sftp::state::sftp_connect,
            sftp::state::sftp_disconnect,
            sftp::remote::sftp_list_dir,
            sftp::remote::sftp_get_cwd,
            sftp::remote::sftp_stat,
            sftp::remote::sftp_read_file,
            sftp::remote::sftp_write_file,
            sftp::remote::sftp_create_file,
            sftp::remote::sftp_mkdir,
            sftp::remote::sftp_remove,
            sftp::remote::sftp_rename,
            sftp::remote::sftp_chmod,
            sftp::local::local_list_dir,
            sftp::local::local_get_cwd,
            sftp::local::local_stat,
            sftp::local::local_read_file,
            sftp::local::local_write_file,
            sftp::local::local_mkdir,
            sftp::local::local_remove,
            sftp::local::local_rename,
            sftp::local::local_chmod,
            sftp::transfer::sftp_upload,
            sftp::transfer::sftp_upload_paths,
            sftp::transfer::sftp_download,
            sftp::transfer::local_copy,
            sftp::transfer::sftp_cross_transfer,
            sftp::transfer::sftp_cancel_transfer,
            settings::get_settings,
            settings::set_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use russh::client;
use russh::keys::PublicKey;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::time::{timeout, sleep};
use tracing::{debug, error, info, warn};

use crate::hosts::HostsState;
use crate::ssh::known_hosts::{HostKeyStatus, KnownHostsStore};
use crate::ssh::{make_ssh_config, ssh_fingerprint, SshState};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const AUTH_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Serialize, Clone)]
struct TunnelStatusEvent {
    id: u32,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn emit_tunnel_status(app: &AppHandle, id: u32, status: &str, error: Option<String>) {
    let _ = app.emit(
        "tunnel-status",
        TunnelStatusEvent {
            id,
            status: status.to_string(),
            error,
        },
    );
}

#[derive(Serialize, Clone)]
struct TunnelHostVerifyEvent {
    tunnel_id: u32,
    stage: String,
    fingerprint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    expected_fingerprint: Option<String>,
    hostname: String,
    port: u16,
}

fn emit_host_verify(app: &AppHandle, event: TunnelHostVerifyEvent) {
    let _ = app.emit("tunnel-host-verify", event);
}

struct TunnelHandle {
    shutdown_tx: oneshot::Sender<()>,
}

struct PendingKeyVerification {
    respond: oneshot::Sender<bool>,
}

pub struct TunnelState {
    active: Arc<Mutex<HashMap<u32, TunnelHandle>>>,
    pending_verifications: Arc<Mutex<HashMap<u32, PendingKeyVerification>>>,
}

impl TunnelState {
    pub fn new() -> Self {
        Self {
            active: Arc::new(Mutex::new(HashMap::new())),
            pending_verifications: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

struct TunnelHandler {
    host_key_tx: Option<oneshot::Sender<PublicKey>>,
    forwarded_tx: Option<mpsc::UnboundedSender<russh::Channel<client::Msg>>>,
}

impl client::Handler for TunnelHandler {
    type Error = russh::Error;

    fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> impl std::future::Future<Output = Result<bool, Self::Error>> + Send {
        let key = server_public_key.clone();
        let tx = self.host_key_tx.take();
        async move {
            if let Some(tx) = tx {
                let _ = tx.send(key);
            }
            Ok(true)
        }
    }

    fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: russh::Channel<client::Msg>,
        _connected_address: &str,
        _connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        _session: &mut client::Session,
    ) -> impl std::future::Future<Output = Result<(), Self::Error>> + Send {
        if let Some(ref tx) = self.forwarded_tx {
            let _ = tx.send(channel);
        }
        async { Ok(()) }
    }
}

#[tauri::command]
pub async fn start_tunnel(tunnel_id: u32, app: AppHandle) -> Result<(), String> {
    info!(tunnel_id, "Starting tunnel");

    let tunnel_state = app.state::<TunnelState>();

    {
        let active = tunnel_state.active.lock().await;
        if active.contains_key(&tunnel_id) {
            return Err("Tunnel is already running".to_string());
        }
    }

    let hosts_state = app.state::<HostsState>();
    let store_guard = hosts_state.store.lock().await;
    let store = store_guard.as_ref().ok_or("Vault is locked")?;

    let tunnels = store.list_tunnels()?;
    let tunnel = tunnels
        .iter()
        .find(|t| t.id == tunnel_id)
        .ok_or_else(|| format!("Tunnel {} not found", tunnel_id))?
        .clone();

    let hosts = store.list()?;
    let host = hosts
        .iter()
        .find(|h| h.id == tunnel.host_id)
        .ok_or_else(|| format!("Host {} not found", tunnel.host_id))?
        .clone();

    drop(store_guard);

    let ssh_state = app.state::<SshState>();
    let known_hosts = ssh_state.known_hosts.clone();

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    {
        let mut active = tunnel_state.active.lock().await;
        active.insert(tunnel_id, TunnelHandle { shutdown_tx });
    }

    let active_ref = tunnel_state.active.clone();
    let pending_ref = tunnel_state.pending_verifications.clone();
    let app_handle = app.clone();

    tokio::spawn(async move {
        let result = run_tunnel(
            tunnel_id,
            &tunnel.tunnel_type,
            &host.hostname,
            host.port,
            &host.username,
            host.password.as_deref().unwrap_or(""),
            &tunnel.bind_address,
            tunnel.source_port,
            &tunnel.destination_host,
            tunnel.destination_port,
            known_hosts,
            pending_ref,
            shutdown_rx,
            &app_handle,
        )
        .await;

        active_ref.lock().await.remove(&tunnel_id);

        match result {
            Ok(()) => {
                info!(tunnel_id, "Tunnel stopped");
                emit_tunnel_status(&app_handle, tunnel_id, "stopped", None);
            }
            Err(e) => {
                error!(tunnel_id, error = %e, "Tunnel error");
                emit_tunnel_status(&app_handle, tunnel_id, "error", Some(e));
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_tunnel(tunnel_id: u32, app: AppHandle) -> Result<(), String> {
    info!(tunnel_id, "Stopping tunnel");

    let tunnel_state = app.state::<TunnelState>();
    let mut active = tunnel_state.active.lock().await;

    if let Some(handle) = active.remove(&tunnel_id) {
        let _ = handle.shutdown_tx.send(());
        Ok(())
    } else {
        Err("Tunnel is not running".to_string())
    }
}

#[tauri::command]
pub async fn respond_tunnel_host_key(
    tunnel_id: u32,
    accept: bool,
    app: AppHandle,
) -> Result<(), String> {
    let state = app.state::<TunnelState>();
    let mut pending = state.pending_verifications.lock().await;

    if let Some(verification) = pending.remove(&tunnel_id) {
        info!(tunnel_id, accepted = accept, "Tunnel host key verification response");
        let _ = verification.respond.send(accept);
        Ok(())
    } else {
        Err("No pending verification for this tunnel".to_string())
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_tunnel(
    tunnel_id: u32,
    tunnel_type: &str,
    hostname: &str,
    port: u16,
    username: &str,
    password: &str,
    bind_address: &str,
    source_port: u16,
    dest_host: &str,
    dest_port: u16,
    known_hosts: Arc<Mutex<KnownHostsStore>>,
    pending_verifications: Arc<Mutex<HashMap<u32, PendingKeyVerification>>>,
    shutdown_rx: oneshot::Receiver<()>,
    app: &AppHandle,
) -> Result<(), String> {
    let (forwarded_tx, forwarded_rx) = if tunnel_type == "remote" {
        let (tx, rx) = mpsc::unbounded_channel();
        (Some(tx), Some(rx))
    } else {
        (None, None)
    };

    let handle = establish_ssh(
        tunnel_id,
        hostname,
        port,
        username,
        password,
        &known_hosts,
        &pending_verifications,
        forwarded_tx,
        app,
    )
    .await?;

    info!(tunnel_id, tunnel_type, "SSH connected, starting tunnel");

    match tunnel_type {
        "local" => {
            run_local_tunnel(tunnel_id, handle, bind_address, source_port, dest_host, dest_port, shutdown_rx, app).await
        }
        "remote" => {
            run_remote_tunnel(
                tunnel_id,
                handle,
                forwarded_rx.unwrap(),
                bind_address,
                source_port,
                dest_host,
                dest_port,
                shutdown_rx,
                app,
            )
            .await
        }
        _ => Err(format!("Unknown tunnel type: {}", tunnel_type)),
    }
}

#[allow(clippy::too_many_arguments)]
async fn establish_ssh(
    tunnel_id: u32,
    hostname: &str,
    port: u16,
    username: &str,
    password: &str,
    known_hosts: &Arc<Mutex<KnownHostsStore>>,
    pending_verifications: &Arc<Mutex<HashMap<u32, PendingKeyVerification>>>,
    forwarded_tx: Option<mpsc::UnboundedSender<russh::Channel<client::Msg>>>,
    app: &AppHandle,
) -> Result<client::Handle<TunnelHandler>, String> {
    emit_tunnel_status(
        app,
        tunnel_id,
        "connecting",
        Some(format!("Connecting to {}:{}...", hostname, port)),
    );

    let config = make_ssh_config();
    let (key_tx, key_rx) = oneshot::channel::<PublicKey>();
    let handler = TunnelHandler {
        host_key_tx: Some(key_tx),
        forwarded_tx,
    };

    let addr = format!("{}:{}", hostname, port);
    let mut handle = timeout(CONNECT_TIMEOUT, client::connect(config, &addr, handler))
        .await
        .map_err(|_| format!("Connection timed out after {}s", CONNECT_TIMEOUT.as_secs()))?
        .map_err(|e| format!("Connection failed: {}", e))?;

    let server_key = timeout(CONNECT_TIMEOUT, key_rx)
        .await
        .map_err(|_| "Timed out waiting for server key".to_string())?
        .map_err(|_| "Failed to receive server key".to_string())?;

    let fingerprint = ssh_fingerprint(&server_key);

    let key_status = {
        let store = known_hosts.lock().await;
        store.check(hostname, port, &fingerprint)
    };

    match key_status {
        HostKeyStatus::Known => {
            debug!(tunnel_id, hostname, "Host key verified");
        }
        HostKeyStatus::Unknown => {
            info!(tunnel_id, hostname, "Unknown host key for tunnel, requesting user verification");
            emit_host_verify(app, TunnelHostVerifyEvent {
                tunnel_id,
                stage: "unknown".to_string(),
                fingerprint: fingerprint.clone(),
                expected_fingerprint: None,
                hostname: hostname.to_string(),
                port,
            });

            let (resp_tx, resp_rx) = oneshot::channel::<bool>();
            {
                let mut p = pending_verifications.lock().await;
                p.insert(tunnel_id, PendingKeyVerification { respond: resp_tx });
            }

            let accepted = resp_rx
                .await
                .map_err(|_| "Verification cancelled".to_string())?;
            if !accepted {
                warn!(tunnel_id, hostname, "Tunnel host key rejected by user");
                return Err("Host key rejected by user".to_string());
            }

            {
                let store = known_hosts.lock().await;
                store.add(hostname, port, &fingerprint)?;
            }
            info!(tunnel_id, hostname, "Tunnel host key trusted and saved");
        }
        HostKeyStatus::Changed { expected } => {
            warn!(tunnel_id, hostname, "Host key CHANGED for tunnel");
            emit_host_verify(app, TunnelHostVerifyEvent {
                tunnel_id,
                stage: "changed".to_string(),
                fingerprint: fingerprint.clone(),
                expected_fingerprint: Some(expected),
                hostname: hostname.to_string(),
                port,
            });

            let (resp_tx, resp_rx) = oneshot::channel::<bool>();
            {
                let mut p = pending_verifications.lock().await;
                p.insert(tunnel_id, PendingKeyVerification { respond: resp_tx });
            }

            let accepted = resp_rx
                .await
                .map_err(|_| "Verification cancelled".to_string())?;
            if !accepted {
                warn!(tunnel_id, hostname, "Changed tunnel host key rejected by user");
                return Err("Host key rejected by user".to_string());
            }

            {
                let store = known_hosts.lock().await;
                store.remove(hostname, port);
                store.add(hostname, port, &fingerprint)?;
            }
            info!(tunnel_id, hostname, "Changed tunnel host key accepted and updated");
        }
    }

    let auth_result = timeout(AUTH_TIMEOUT, handle.authenticate_password(username, password))
        .await
        .map_err(|_| format!("Authentication timed out after {}s", AUTH_TIMEOUT.as_secs()))?
        .map_err(|e| format!("Authentication failed: {}", e))?;

    match auth_result {
        russh::client::AuthResult::Success => {
            info!(tunnel_id, hostname, username, "Tunnel SSH authenticated");
        }
        russh::client::AuthResult::Failure { .. } => {
            return Err("Authentication failed: wrong credentials".to_string());
        }
    }

    Ok(handle)
}

#[allow(clippy::too_many_arguments)]
async fn run_local_tunnel(
    tunnel_id: u32,
    handle: client::Handle<TunnelHandler>,
    bind_address: &str,
    source_port: u16,
    dest_host: &str,
    dest_port: u16,
    mut shutdown_rx: oneshot::Receiver<()>,
    app: &AppHandle,
) -> Result<(), String> {
    let listen_addr = format!("{}:{}", bind_address, source_port);
    let listener = TcpListener::bind(&listen_addr)
        .await
        .map_err(|e| format!("Failed to bind {}: {}", listen_addr, e))?;

    info!(tunnel_id, addr = %listen_addr, "Local tunnel listening");
    emit_tunnel_status(app, tunnel_id, "started", None);

    let handle = Arc::new(Mutex::new(handle));
    let health_handle = handle.clone();

    loop {
        tokio::select! {
            _ = &mut shutdown_rx => {
                info!(tunnel_id, "Local tunnel shutdown requested");
                return Ok(());
            }
            _ = async {
                loop {
                    sleep(Duration::from_secs(5)).await;
                    if health_handle.lock().await.is_closed() {
                        return;
                    }
                }
            } => {
                warn!(tunnel_id, "SSH connection lost");
                return Err("SSH connection lost".to_string());
            }
            result = listener.accept() => {
                match result {
                    Ok((tcp_stream, peer_addr)) => {
                        debug!(tunnel_id, peer = %peer_addr, "Accepted local connection");
                        let handle = handle.clone();
                        let dest_host = dest_host.to_string();
                        let tid = tunnel_id;
                        tokio::spawn(async move {
                            if let Err(e) = forward_local_connection(
                                tcp_stream, handle, &dest_host, dest_port,
                            ).await {
                                warn!(tunnel_id = tid, error = %e, "Local forward connection error");
                            }
                        });
                    }
                    Err(e) => {
                        error!(tunnel_id, error = %e, "TCP accept error");
                    }
                }
            }
        }
    }
}

async fn forward_local_connection(
    tcp_stream: TcpStream,
    ssh_handle: Arc<Mutex<client::Handle<TunnelHandler>>>,
    dest_host: &str,
    dest_port: u16,
) -> Result<(), String> {
    let channel = {
        let handle = ssh_handle.lock().await;
        handle
            .channel_open_direct_tcpip(dest_host, dest_port as u32, "127.0.0.1", 0)
            .await
            .map_err(|e| format!("Failed to open SSH channel: {}", e))?
    };

    bridge_streams(tcp_stream, channel).await;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn run_remote_tunnel(
    tunnel_id: u32,
    handle: client::Handle<TunnelHandler>,
    mut forwarded_rx: mpsc::UnboundedReceiver<russh::Channel<client::Msg>>,
    bind_address: &str,
    source_port: u16,
    dest_host: &str,
    dest_port: u16,
    mut shutdown_rx: oneshot::Receiver<()>,
    app: &AppHandle,
) -> Result<(), String> {
    handle
        .tcpip_forward(bind_address, source_port as u32)
        .await
        .map_err(|e| format!("Failed to request remote forwarding: {}", e))?;

    info!(
        tunnel_id,
        bind_address,
        source_port,
        "Remote forwarding requested"
    );
    emit_tunnel_status(app, tunnel_id, "started", None);

    loop {
        tokio::select! {
            _ = &mut shutdown_rx => {
                info!(tunnel_id, "Remote tunnel shutdown requested");
                let _ = handle.cancel_tcpip_forward(bind_address, source_port as u32).await;
                return Ok(());
            }
            _ = async {
                loop {
                    sleep(Duration::from_secs(5)).await;
                    if handle.is_closed() {
                        return;
                    }
                }
            } => {
                warn!(tunnel_id, "SSH connection lost (remote tunnel)");
                return Err("SSH connection lost".to_string());
            }
            channel = forwarded_rx.recv() => {
                match channel {
                    Some(channel) => {
                        debug!(tunnel_id, "Received forwarded channel");
                        let dest_host = dest_host.to_string();
                        let tid = tunnel_id;
                        tokio::spawn(async move {
                            if let Err(e) = forward_remote_connection(
                                channel, &dest_host, dest_port,
                            ).await {
                                warn!(tunnel_id = tid, error = %e, "Remote forward connection error");
                            }
                        });
                    }
                    None => {
                        info!(tunnel_id, "Forwarded channel stream ended");
                        return Err("SSH connection lost".to_string());
                    }
                }
            }
        }
    }
}

async fn forward_remote_connection(
    channel: russh::Channel<client::Msg>,
    dest_host: &str,
    dest_port: u16,
) -> Result<(), String> {
    let tcp_stream = TcpStream::connect(format!("{}:{}", dest_host, dest_port))
        .await
        .map_err(|e| format!("Failed to connect to {}:{}: {}", dest_host, dest_port, e))?;

    bridge_streams(tcp_stream, channel).await;
    Ok(())
}

async fn bridge_streams(tcp_stream: TcpStream, channel: russh::Channel<client::Msg>) {
    let mut ssh_stream = channel.into_stream();
    let (mut tcp_read, mut tcp_write) = tcp_stream.into_split();
    let (mut ssh_read, mut ssh_write) = tokio::io::split(&mut ssh_stream);

    tokio::select! {
        r = tokio::io::copy(&mut tcp_read, &mut ssh_write) => {
            debug!("TCP->SSH copy finished: {:?}", r);
        }
        r = tokio::io::copy(&mut ssh_read, &mut tcp_write) => {
            debug!("SSH->TCP copy finished: {:?}", r);
        }
    }
}

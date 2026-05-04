use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use russh::client;
use russh::keys::PublicKey;
use russh::ChannelMsg;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::time::timeout;
use tracing::{debug, error, info, warn};

use crate::hosts::HostsState;

pub(crate) mod known_hosts;
use known_hosts::{HostKeyStatus, KnownHostsStore};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const AUTH_TIMEOUT: Duration = Duration::from_secs(30);
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(15);

#[derive(Serialize, Deserialize, Clone)]
struct SshOutput {
    session_id: u32,
    data: String,
}

#[derive(Serialize, Clone)]
struct SshStatus {
    session_id: u32,
    stage: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    expected_fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hop_current: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hop_total: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hop_label: Option<String>,
}

impl SshStatus {
    fn new(session_id: u32, stage: &str, message: &str) -> Self {
        Self {
            session_id,
            stage: stage.to_string(),
            message: message.to_string(),
            fingerprint: None,
            expected_fingerprint: None,
            hop_current: None,
            hop_total: None,
            hop_label: None,
        }
    }

    fn with_hop(mut self, current: u32, total: u32, label: &str) -> Self {
        self.hop_current = Some(current);
        self.hop_total = Some(total);
        self.hop_label = Some(label.to_string());
        self
    }
}

enum SshCommand {
    Write(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close,
}

struct SshHandle {
    cmd_tx: mpsc::UnboundedSender<SshCommand>,
    shutdown_tx: Option<oneshot::Sender<()>>,
    ssh_handle: Arc<tokio::sync::Mutex<client::Handle<SshClientHandler>>>,
}

pub struct SshState {
    handles: Arc<Mutex<HashMap<u32, SshHandle>>>,
    pub(crate) known_hosts: Arc<Mutex<KnownHostsStore>>,
    pending_verifications: Arc<Mutex<HashMap<u32, PendingVerification>>>,
}

struct PendingVerification {
    respond: oneshot::Sender<bool>,
}

impl SshState {
    pub fn new(data_dir: std::path::PathBuf) -> Self {
        Self {
            handles: Arc::new(Mutex::new(HashMap::new())),
            known_hosts: Arc::new(Mutex::new(KnownHostsStore::new(data_dir))),
            pending_verifications: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub(crate) async fn connect_to_host(
        &self,
        session_id: u32,
        host_id: u32,
        app: &AppHandle,
    ) -> Result<SshConnection, String> {
        let hosts_state = app.state::<HostsState>();
        let store_guard = hosts_state.store.lock().await;
        let all_hosts = store_guard
            .as_ref()
            .ok_or("Vault is locked")?
            .list()?;
        drop(store_guard);

        let host = all_hosts
            .iter()
            .find(|h| h.id == host_id)
            .ok_or_else(|| format!("Host {} not found", host_id))?;

        let hops = resolve_full_hop_chain(host_id, &all_hosts, &mut vec![])
            .map_err(|e| format!("Failed to resolve jump path: {}", e))?;

        let destination = HopInfo {
            hostname: host.hostname.clone(),
            port: host.port,
            username: host.username.clone(),
            password: host.password.clone().unwrap_or_default(),
            label: host.label.clone(),
        };

        if hops.is_empty() {
            self.direct_connect_raw(session_id, &destination, app).await
        } else {
            self.jump_connect_raw(session_id, hops, destination, app).await
        }
    }

    async fn direct_connect_raw(
        &self,
        session_id: u32,
        destination: &HopInfo,
        app: &AppHandle,
    ) -> Result<SshConnection, String> {
        info!(session_id, host = %destination.hostname, port = destination.port, "SFTP direct SSH connect");

        let config = make_ssh_config();
        let (key_tx, key_rx) = oneshot::channel::<PublicKey>();
        let handler = SshClientHandler { host_key_tx: Some(key_tx) };

        let addr = format!("{}:{}", destination.hostname, destination.port);
        let mut handle = timeout(CONNECT_TIMEOUT, client::connect(config, &addr, handler))
            .await
            .map_err(|_| format!("Connection timed out after {}s", CONNECT_TIMEOUT.as_secs()))?
            .map_err(|e| format!("Connection failed: {}", e))?;

        ssh_authenticate_and_verify(
            session_id, &mut handle, key_rx,
            &destination.hostname, destination.port,
            &destination.username, &destination.password,
            &self.known_hosts, &self.pending_verifications,
            app, None,
        ).await?;

        Ok(SshConnection {
            handle: Arc::new(tokio::sync::Mutex::new(handle)),
            _keepalive: None,
        })
    }

    async fn jump_connect_raw(
        &self,
        session_id: u32,
        hops: Vec<HopInfo>,
        destination: HopInfo,
        app: &AppHandle,
    ) -> Result<SshConnection, String> {
        let total_hops = hops.len() as u32;
        info!(session_id, total_hops, destination = %destination.hostname, "SFTP jump SSH connect");

        let first_hop = &hops[0];
        let config = make_ssh_config();
        let (key_tx, key_rx) = oneshot::channel::<PublicKey>();
        let handler = SshClientHandler { host_key_tx: Some(key_tx) };

        let addr = format!("{}:{}", first_hop.hostname, first_hop.port);
        let mut current_handle = timeout(CONNECT_TIMEOUT, client::connect(config, &addr, handler))
            .await
            .map_err(|_| format!("Hop 1/{}: Connection to {} timed out", total_hops, first_hop.label))?
            .map_err(|e| format!("Hop 1/{}: Connection to {} failed: {}", total_hops, first_hop.label, e))?;

        ssh_authenticate_and_verify(
            session_id, &mut current_handle, key_rx,
            &first_hop.hostname, first_hop.port,
            &first_hop.username, &first_hop.password,
            &self.known_hosts, &self.pending_verifications,
            app, Some((1, total_hops, &first_hop.label)),
        ).await?;

        let mut intermediate_handles: Vec<client::Handle<SshClientHandler>> = Vec::new();

        for (i, hop) in hops.iter().enumerate().skip(1) {
            let hop_num = (i + 1) as u32;

            let tunnel_channel = timeout(
                CONNECT_TIMEOUT,
                current_handle.channel_open_direct_tcpip(&hop.hostname, hop.port as u32, "127.0.0.1", 0),
            )
            .await
            .map_err(|_| format!("Hop {}/{}: Tunnel to {} timed out", hop_num, total_hops, hop.label))?
            .map_err(|e| format!("Hop {}/{}: Tunnel to {} failed: {}", hop_num, total_hops, hop.label, e))?;

            let stream = tunnel_channel.into_stream();
            let config = make_ssh_config();
            let (key_tx, key_rx) = oneshot::channel::<PublicKey>();
            let handler = SshClientHandler { host_key_tx: Some(key_tx) };

            let mut new_handle = timeout(CONNECT_TIMEOUT, client::connect_stream(config, stream, handler))
                .await
                .map_err(|_| format!("Hop {}/{}: SSH to {} timed out", hop_num, total_hops, hop.label))?
                .map_err(|e| format!("Hop {}/{}: SSH to {} failed: {}", hop_num, total_hops, hop.label, e))?;

            ssh_authenticate_and_verify(
                session_id, &mut new_handle, key_rx,
                &hop.hostname, hop.port,
                &hop.username, &hop.password,
                &self.known_hosts, &self.pending_verifications,
                app, Some((hop_num, total_hops, &hop.label)),
            ).await?;

            intermediate_handles.push(current_handle);
            current_handle = new_handle;
        }

        let tunnel_channel = timeout(
            CONNECT_TIMEOUT,
            current_handle.channel_open_direct_tcpip(&destination.hostname, destination.port as u32, "127.0.0.1", 0),
        )
        .await
        .map_err(|_| format!("Tunnel to destination {} timed out", destination.label))?
        .map_err(|e| format!("Tunnel to destination {} failed: {}", destination.label, e))?;

        let stream = tunnel_channel.into_stream();
        let config = make_ssh_config();
        let (key_tx, key_rx) = oneshot::channel::<PublicKey>();
        let handler = SshClientHandler { host_key_tx: Some(key_tx) };

        let mut dest_handle = timeout(CONNECT_TIMEOUT, client::connect_stream(config, stream, handler))
            .await
            .map_err(|_| format!("SSH to destination {} timed out", destination.label))?
            .map_err(|e| format!("SSH to destination {} failed: {}", destination.label, e))?;

        intermediate_handles.push(current_handle);

        ssh_authenticate_and_verify(
            session_id, &mut dest_handle, key_rx,
            &destination.hostname, destination.port,
            &destination.username, &destination.password,
            &self.known_hosts, &self.pending_verifications,
            app, None,
        ).await?;

        let (keepalive_tx, keepalive_rx) = oneshot::channel::<()>();
        tokio::spawn(async move {
            let _handles = intermediate_handles;
            let _ = keepalive_rx.await;
        });

        Ok(SshConnection {
            handle: Arc::new(tokio::sync::Mutex::new(dest_handle)),
            _keepalive: Some(keepalive_tx),
        })
    }
}

pub(crate) struct SshConnection {
    handle: Arc<tokio::sync::Mutex<client::Handle<SshClientHandler>>>,
    _keepalive: Option<oneshot::Sender<()>>,
}

impl SshConnection {
    pub(crate) async fn open_sftp_channel(&self) -> Result<russh::Channel<client::Msg>, String> {
        let handle = self.handle.lock().await;
        let channel = handle
            .channel_open_session()
            .await
            .map_err(|e| format!("Failed to open SFTP channel: {}", e))?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| format!("Failed to request SFTP subsystem: {}", e))?;
        Ok(channel)
    }
}

struct SshClientHandler {
    host_key_tx: Option<oneshot::Sender<PublicKey>>,
}

impl client::Handler for SshClientHandler {
    type Error = russh::Error;

    fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> impl Future<Output = Result<bool, Self::Error>> + Send {
        let key = server_public_key.clone();
        let tx = self.host_key_tx.take();
        async move {
            if let Some(tx) = tx {
                let _ = tx.send(key);
            }
            Ok(true)
        }
    }
}

fn emit_status(app: &AppHandle, status: SshStatus) {
    let _ = app.emit("ssh-status", status);
}

pub(crate) fn resolve_full_hop_chain(
    host_id: u32,
    all_hosts: &[crate::hosts::store::HostEntry],
    visited: &mut Vec<u32>,
) -> Result<Vec<HopInfo>, String> {
    if visited.contains(&host_id) {
        return Err(format!("Circular jump path detected at host {}", host_id));
    }
    visited.push(host_id);

    let host = all_hosts
        .iter()
        .find(|h| h.id == host_id)
        .ok_or_else(|| format!("Jump host {} not found", host_id))?;

    let mut chain: Vec<HopInfo> = Vec::new();

    if let Some(ref jump_path) = host.jump_path {
        for &hop_id in jump_path {
            let sub_chain = resolve_full_hop_chain(hop_id, all_hosts, visited)?;
            chain.extend(sub_chain);
            let hop_host = all_hosts
                .iter()
                .find(|h| h.id == hop_id)
                .ok_or_else(|| format!("Jump host {} not found", hop_id))?;
            chain.push(HopInfo {
                hostname: hop_host.hostname.clone(),
                port: hop_host.port,
                username: hop_host.username.clone(),
                password: hop_host.password.clone().unwrap_or_default(),
                label: hop_host.label.clone(),
            });
        }
    }

    visited.pop();
    Ok(chain)
}

pub(crate) struct HopInfo {
    pub(crate) hostname: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) password: String,
    pub(crate) label: String,
}

#[tauri::command]
pub async fn create_ssh_session(
    session_id: u32,
    host_id: u32,
    rows: u16,
    cols: u16,
    app: AppHandle,
) -> Result<(), String> {
    info!(session_id, host_id, "Creating SSH session");
    let ssh_state = app.state::<SshState>();

    {
        let mut handles = ssh_state.handles.lock().await;
        if let Some(old_handle) = handles.remove(&session_id) {
            debug!(session_id, "Cleaning up existing SSH session");
            let _ = old_handle.cmd_tx.send(SshCommand::Close);
            if let Some(tx) = old_handle.shutdown_tx {
                let _ = tx.send(());
            }
        }
    }

    let hosts_state = app.state::<HostsState>();
    let store_guard = hosts_state.store.lock().await;
    let all_hosts = store_guard
        .as_ref()
        .ok_or("Vault is locked")?
        .list()?;
    drop(store_guard);

    let host = all_hosts
        .iter()
        .find(|h| h.id == host_id)
        .ok_or_else(|| format!("Host {} not found", host_id))?;

    let hops = resolve_full_hop_chain(host_id, &all_hosts, &mut vec![])
        .map_err(|e| format!("Failed to resolve jump path: {}", e))?;

    if !hops.is_empty() {
        info!(session_id, hops = hops.len(), "SSH connection with jump path");
    }

    let destination = HopInfo {
        hostname: host.hostname.clone(),
        port: host.port,
        username: host.username.clone(),
        password: host.password.clone().unwrap_or_default(),
        label: host.label.clone(),
    };

    let known_hosts = ssh_state.known_hosts.clone();
    let pending = ssh_state.pending_verifications.clone();
    let handles_ref = ssh_state.handles.clone();
    let app_handle = app.clone();

    tokio::spawn(async move {
        let result = if hops.is_empty() {
            ssh_direct_connect(
                session_id,
                &destination,
                rows,
                cols,
                known_hosts,
                pending,
                handles_ref,
                &app_handle,
            )
            .await
        } else {
            ssh_jump_connect(
                session_id,
                hops,
                destination,
                rows,
                cols,
                known_hosts,
                pending,
                handles_ref,
                &app_handle,
            )
            .await
        };

        if let Err(e) = result {
            error!(session_id, error = %e, "SSH connection failed");
            emit_status(&app_handle, SshStatus::new(session_id, "error", &e));
        }
    });

    Ok(())
}

async fn ssh_authenticate_and_verify(
    session_id: u32,
    handle: &mut client::Handle<SshClientHandler>,
    key_rx: oneshot::Receiver<PublicKey>,
    hostname: &str,
    port: u16,
    username: &str,
    password: &str,
    known_hosts: &Arc<Mutex<KnownHostsStore>>,
    pending: &Arc<Mutex<HashMap<u32, PendingVerification>>>,
    app: &AppHandle,
    hop_info: Option<(u32, u32, &str)>,
) -> Result<(), String> {
    let make_status = |stage: &str, msg: &str| -> SshStatus {
        let s = SshStatus::new(session_id, stage, msg);
        if let Some((current, total, label)) = hop_info {
            s.with_hop(current, total, label)
        } else {
            s
        }
    };

    emit_status(app, make_status("handshake", "SSH handshake completed"));

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
            debug!(session_id, hostname, "Host key verified (known)");
            emit_status(app, make_status("host_verified", "Host key verified"));
        }
        HostKeyStatus::Unknown => {
            info!(session_id, hostname, "Unknown host key, requesting user verification");
            let mut status = make_status("host_verify", "Unknown host. Do you trust this server?");
            status.fingerprint = Some(fingerprint.clone());
            emit_status(app, status);

            let (resp_tx, resp_rx) = oneshot::channel::<bool>();
            {
                let mut p = pending.lock().await;
                p.insert(session_id, PendingVerification { respond: resp_tx });
            }

            let accepted = resp_rx
                .await
                .map_err(|_| "Verification cancelled".to_string())?;
            if !accepted {
                warn!(session_id, hostname, "Host key rejected by user");
                return Err("Host key rejected by user".to_string());
            }

            {
                let store = known_hosts.lock().await;
                store.add(hostname, port, &fingerprint)?;
            }

            info!(session_id, hostname, "Host key trusted and saved");
            emit_status(app, make_status("host_verified", "Host key trusted and saved"));
        }
        HostKeyStatus::Changed { expected } => {
            warn!(session_id, hostname, "Host key CHANGED — possible MITM");
            let mut status = make_status(
                "host_changed",
                "WARNING: Host key has changed! This could indicate a man-in-the-middle attack.",
            );
            status.fingerprint = Some(fingerprint.clone());
            status.expected_fingerprint = Some(expected);
            emit_status(app, status);

            let (resp_tx, resp_rx) = oneshot::channel::<bool>();
            {
                let mut p = pending.lock().await;
                p.insert(session_id, PendingVerification { respond: resp_tx });
            }

            let accepted = resp_rx
                .await
                .map_err(|_| "Verification cancelled".to_string())?;
            if !accepted {
                warn!(session_id, hostname, "Changed host key rejected by user");
                return Err("Host key rejected by user".to_string());
            }

            {
                let store = known_hosts.lock().await;
                store.remove(hostname, port);
                store.add(hostname, port, &fingerprint)?;
            }

            info!(session_id, hostname, "Changed host key accepted and updated");
            emit_status(app, make_status("host_verified", "Host key updated and saved"));
        }
    }

    emit_status(
        app,
        make_status("authenticating", &format!("Authenticating as {}...", username)),
    );
    debug!(session_id, hostname, username, "Authenticating");

    let auth_result = timeout(AUTH_TIMEOUT, handle.authenticate_password(username, password))
        .await
        .map_err(|_| {
            error!(session_id, hostname, "Authentication timed out");
            format!("Authentication timed out after {}s", AUTH_TIMEOUT.as_secs())
        })?
        .map_err(|e| {
            error!(session_id, hostname, error = %e, "Authentication failed");
            format!("Authentication failed: {}", e)
        })?;

    match auth_result {
        russh::client::AuthResult::Success => {
            info!(session_id, hostname, username, "Authentication successful");
        }
        russh::client::AuthResult::Failure { .. } => {
            warn!(session_id, hostname, username, "Authentication failed: wrong credentials");
            return Err("Authentication failed: wrong credentials".to_string());
        }
    }

    Ok(())
}

pub(crate) fn make_ssh_config() -> Arc<client::Config> {
    Arc::new(client::Config {
        keepalive_interval: Some(KEEPALIVE_INTERVAL),
        keepalive_max: 3,
        inactivity_timeout: None,
        ..Default::default()
    })
}

async fn ssh_direct_connect(
    session_id: u32,
    destination: &HopInfo,
    rows: u16,
    cols: u16,
    known_hosts: Arc<Mutex<KnownHostsStore>>,
    pending: Arc<Mutex<HashMap<u32, PendingVerification>>>,
    handles: Arc<Mutex<HashMap<u32, SshHandle>>>,
    app: &AppHandle,
) -> Result<(), String> {
    info!(session_id, host = %destination.hostname, port = destination.port, "Direct SSH connect");

    emit_status(
        app,
        SshStatus::new(
            session_id,
            "connecting",
            &format!("Connecting to {}:{}...", destination.hostname, destination.port),
        ),
    );

    let config = make_ssh_config();
    let (key_tx, key_rx) = oneshot::channel::<PublicKey>();
    let handler = SshClientHandler {
        host_key_tx: Some(key_tx),
    };

    let addr = format!("{}:{}", destination.hostname, destination.port);
    let mut handle = timeout(CONNECT_TIMEOUT, client::connect(config, &addr, handler))
        .await
        .map_err(|_| {
            error!(session_id, addr = %addr, "Connection timed out");
            format!("Connection timed out after {}s", CONNECT_TIMEOUT.as_secs())
        })?
        .map_err(|e| {
            error!(session_id, addr = %addr, error = %e, "Connection failed");
            format!("Connection failed: {}", e)
        })?;

    ssh_authenticate_and_verify(
        session_id,
        &mut handle,
        key_rx,
        &destination.hostname,
        destination.port,
        &destination.username,
        &destination.password,
        &known_hosts,
        &pending,
        app,
        None,
    )
    .await?;

    open_pty_channel(session_id, handle, rows, cols, handles, app, None).await
}

async fn ssh_jump_connect(
    session_id: u32,
    hops: Vec<HopInfo>,
    destination: HopInfo,
    rows: u16,
    cols: u16,
    known_hosts: Arc<Mutex<KnownHostsStore>>,
    pending: Arc<Mutex<HashMap<u32, PendingVerification>>>,
    handles: Arc<Mutex<HashMap<u32, SshHandle>>>,
    app: &AppHandle,
) -> Result<(), String> {
    let total_hops = hops.len() as u32;
    info!(session_id, total_hops, destination = %destination.hostname, "Jump SSH connect");

    let first_hop = &hops[0];
    emit_status(
        app,
        SshStatus::new(
            session_id,
            "connecting",
            &format!("Hop 1/{}: Connecting to {}:{}...", total_hops, first_hop.hostname, first_hop.port),
        )
        .with_hop(1, total_hops, &first_hop.label),
    );

    let config = make_ssh_config();
    let (key_tx, key_rx) = oneshot::channel::<PublicKey>();
    let handler = SshClientHandler {
        host_key_tx: Some(key_tx),
    };

    let addr = format!("{}:{}", first_hop.hostname, first_hop.port);
    let mut current_handle = timeout(CONNECT_TIMEOUT, client::connect(config, &addr, handler))
        .await
        .map_err(|_| format!("Hop 1/{}: Connection to {} timed out", total_hops, first_hop.label))?
        .map_err(|e| format!("Hop 1/{}: Connection to {} failed: {}", total_hops, first_hop.label, e))?;

    info!(session_id, hop = 1, total_hops, host = %first_hop.hostname, "Hop connected");

    ssh_authenticate_and_verify(
        session_id,
        &mut current_handle,
        key_rx,
        &first_hop.hostname,
        first_hop.port,
        &first_hop.username,
        &first_hop.password,
        &known_hosts,
        &pending,
        app,
        Some((1, total_hops, &first_hop.label)),
    )
    .await?;

    emit_status(
        app,
        SshStatus::new(
            session_id,
            "hop_connected",
            &format!("Hop 1/{}: {} connected", total_hops, first_hop.label),
        )
        .with_hop(1, total_hops, &first_hop.label),
    );

    let mut intermediate_handles: Vec<client::Handle<SshClientHandler>> = Vec::new();

    for (i, hop) in hops.iter().enumerate().skip(1) {
        let hop_num = (i + 1) as u32;

        emit_status(
            app,
            SshStatus::new(
                session_id,
                "connecting",
                &format!("Hop {}/{}: Tunneling to {}:{}...", hop_num, total_hops, hop.hostname, hop.port),
            )
            .with_hop(hop_num, total_hops, &hop.label),
        );

        let tunnel_channel = timeout(
            CONNECT_TIMEOUT,
            current_handle.channel_open_direct_tcpip(&hop.hostname, hop.port as u32, "127.0.0.1", 0),
        )
        .await
        .map_err(|_| format!("Hop {}/{}: Tunnel to {} timed out", hop_num, total_hops, hop.label))?
        .map_err(|e| format!("Hop {}/{}: Tunnel to {} failed: {}", hop_num, total_hops, hop.label, e))?;

        let stream = tunnel_channel.into_stream();
        let config = make_ssh_config();
        let (key_tx, key_rx) = oneshot::channel::<PublicKey>();
        let handler = SshClientHandler {
            host_key_tx: Some(key_tx),
        };

        let mut new_handle = timeout(CONNECT_TIMEOUT, client::connect_stream(config, stream, handler))
            .await
            .map_err(|_| format!("Hop {}/{}: SSH handshake with {} timed out", hop_num, total_hops, hop.label))?
            .map_err(|e| format!("Hop {}/{}: SSH to {} failed: {}", hop_num, total_hops, hop.label, e))?;

        ssh_authenticate_and_verify(
            session_id,
            &mut new_handle,
            key_rx,
            &hop.hostname,
            hop.port,
            &hop.username,
            &hop.password,
            &known_hosts,
            &pending,
            app,
            Some((hop_num, total_hops, &hop.label)),
        )
        .await?;

        info!(session_id, hop = hop_num, total_hops, host = %hop.hostname, "Hop connected");

        emit_status(
            app,
            SshStatus::new(
                session_id,
                "hop_connected",
                &format!("Hop {}/{}: {} connected", hop_num, total_hops, hop.label),
            )
            .with_hop(hop_num, total_hops, &hop.label),
        );

        intermediate_handles.push(current_handle);
        current_handle = new_handle;
    }

    emit_status(
        app,
        SshStatus::new(
            session_id,
            "connecting",
            &format!("Destination: Tunneling to {}:{}...", destination.hostname, destination.port),
        ),
    );

    let tunnel_channel = timeout(
        CONNECT_TIMEOUT,
        current_handle.channel_open_direct_tcpip(&destination.hostname, destination.port as u32, "127.0.0.1", 0),
    )
    .await
    .map_err(|_| format!("Tunnel to destination {} timed out", destination.label))?
    .map_err(|e| format!("Tunnel to destination {} failed: {}", destination.label, e))?;

    let stream = tunnel_channel.into_stream();
    let config = make_ssh_config();
    let (key_tx, key_rx) = oneshot::channel::<PublicKey>();
    let handler = SshClientHandler {
        host_key_tx: Some(key_tx),
    };

    let mut dest_handle = timeout(CONNECT_TIMEOUT, client::connect_stream(config, stream, handler))
        .await
        .map_err(|_| format!("SSH handshake with destination {} timed out", destination.label))?
        .map_err(|e| format!("SSH to destination {} failed: {}", destination.label, e))?;

    intermediate_handles.push(current_handle);

    ssh_authenticate_and_verify(
        session_id,
        &mut dest_handle,
        key_rx,
        &destination.hostname,
        destination.port,
        &destination.username,
        &destination.password,
        &known_hosts,
        &pending,
        app,
        None,
    )
    .await?;

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    tokio::spawn(async move {
        let _handles = intermediate_handles;
        let _ = shutdown_rx.await;
    });

    open_pty_channel(session_id, dest_handle, rows, cols, handles, app, Some(shutdown_tx)).await
}

async fn open_pty_channel(
    session_id: u32,
    handle: client::Handle<SshClientHandler>,
    rows: u16,
    cols: u16,
    handles: Arc<Mutex<HashMap<u32, SshHandle>>>,
    app: &AppHandle,
    shutdown_tx: Option<oneshot::Sender<()>>,
) -> Result<(), String> {
    emit_status(
        app,
        SshStatus::new(session_id, "channel", "Opening SSH channel..."),
    );

    let channel = timeout(AUTH_TIMEOUT, handle.channel_open_session())
        .await
        .map_err(|_| "Channel open timed out".to_string())?
        .map_err(|e| format!("Channel open failed: {}", e))?;

    channel
        .request_pty(false, "xterm-256color", cols as u32, rows as u32, 0, 0, &[])
        .await
        .map_err(|e| format!("PTY request failed: {}", e))?;

    channel
        .request_shell(false)
        .await
        .map_err(|e| format!("Shell request failed: {}", e))?;

    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<SshCommand>();

    {
        let mut h = handles.lock().await;
        let ssh_handle = Arc::new(tokio::sync::Mutex::new(handle));
        h.insert(session_id, SshHandle { cmd_tx, shutdown_tx, ssh_handle: ssh_handle.clone() });
    }

    info!(session_id, "SSH session connected and ready");
    emit_status(
        app,
        SshStatus::new(session_id, "connected", "Connected"),
    );

    let app_clone = app.clone();
    ssh_session_task(session_id, channel, cmd_rx, handles, &app_clone).await;

    Ok(())
}

pub(crate) fn ssh_fingerprint(key: &PublicKey) -> String {
    use base64::Engine;
    use russh::keys::PublicKeyBase64;
    use sha2::{Digest, Sha256};

    let key_bytes = key.public_key_base64();
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(key_bytes.as_bytes())
        .unwrap_or_default();
    let hash = Sha256::digest(&decoded);
    let b64 = base64::engine::general_purpose::STANDARD_NO_PAD.encode(&hash);
    format!("SHA256:{}", b64)
}

async fn ssh_session_task(
    session_id: u32,
    mut channel: russh::Channel<client::Msg>,
    mut cmd_rx: mpsc::UnboundedReceiver<SshCommand>,
    handles: Arc<Mutex<HashMap<u32, SshHandle>>>,
    app: &AppHandle,
) {
    loop {
        tokio::select! {
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { data }) => {
                        let text = String::from_utf8_lossy(&data).to_string();
                        let _ = app.emit("pty-output", SshOutput { session_id, data: text });
                    }
                    Some(ChannelMsg::ExtendedData { data, .. }) => {
                        let text = String::from_utf8_lossy(&data).to_string();
                        let _ = app.emit("pty-output", SshOutput { session_id, data: text });
                    }
                    Some(ChannelMsg::Eof | ChannelMsg::Close) | None => {
                        info!(session_id, "SSH session disconnected");
                        emit_status(app, SshStatus::new(session_id, "disconnected", "Connection lost"));
                        handles.lock().await.remove(&session_id);
                        break;
                    }
                    _ => {}
                }
            }
            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(SshCommand::Write(data)) => {
                        if channel.data(&data[..]).await.is_err() {
                            warn!(session_id, "SSH write failed, connection lost");
                            emit_status(app, SshStatus::new(session_id, "disconnected", "Connection lost"));
                            handles.lock().await.remove(&session_id);
                            break;
                        }
                    }
                    Some(SshCommand::Resize { cols, rows }) => {
                        let _ = channel.window_change(cols, rows, 0, 0).await;
                        debug!(session_id, cols, rows, "SSH terminal resized");
                    }
                    Some(SshCommand::Close) | None => {
                        info!(session_id, "SSH session closed by user");
                        let _ = channel.close().await;
                        handles.lock().await.remove(&session_id);
                        break;
                    }
                }
            }
        }
    }
}

#[tauri::command]
pub async fn respond_host_key(
    session_id: u32,
    accept: bool,
    app: AppHandle,
) -> Result<(), String> {
    let state = app.state::<SshState>();
    let mut pending = state.pending_verifications.lock().await;

    if let Some(verification) = pending.remove(&session_id) {
        info!(session_id, accepted = accept, "Host key verification response");
        let _ = verification.respond.send(accept);
        Ok(())
    } else {
        Err("No pending verification for this session".to_string())
    }
}

#[tauri::command]
pub async fn write_to_ssh(session_id: u32, data: String, app: AppHandle) -> Result<(), String> {
    let state = app.state::<SshState>();
    let handles = state.handles.lock().await;

    if let Some(handle) = handles.get(&session_id) {
        let _ = handle.cmd_tx.send(SshCommand::Write(data.into_bytes()));
    }

    Ok(())
}

#[tauri::command]
pub async fn resize_ssh(
    session_id: u32,
    rows: u16,
    cols: u16,
    app: AppHandle,
) -> Result<(), String> {
    let state = app.state::<SshState>();
    let handles = state.handles.lock().await;

    if let Some(handle) = handles.get(&session_id) {
        let _ = handle.cmd_tx.send(SshCommand::Resize {
            cols: cols as u32,
            rows: rows as u32,
        });
    }

    Ok(())
}

#[tauri::command]
pub async fn close_ssh_session(session_id: u32, app: AppHandle) -> Result<(), String> {
    let state = app.state::<SshState>();

    {
        let mut pending = state.pending_verifications.lock().await;
        if let Some(verification) = pending.remove(&session_id) {
            let _ = verification.respond.send(false);
        }
    }

    let mut handles = state.handles.lock().await;
    if let Some(handle) = handles.remove(&session_id) {
        info!(session_id, "Closing SSH session");
        let _ = handle.cmd_tx.send(SshCommand::Close);
        if let Some(tx) = handle.shutdown_tx {
            let _ = tx.send(());
        }
    }

    Ok(())
}

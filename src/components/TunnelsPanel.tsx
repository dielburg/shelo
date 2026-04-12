import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { IconTunnels, IconPlus } from "./icons";
import WindowControls from "./WindowControls";

export interface Tunnel {
  id: number;
  label: string;
  host_id: number;
  tunnel_type: string;
  bind_address: string;
  source_port: number;
  destination_host: string;
  destination_port: number;
}

interface Host {
  id: number;
  label: string;
}

export type TunnelStatus = "idle" | "connecting" | "started" | "error";

export interface TunnelCounts {
  active: number;
  error: number;
}

interface Props {
  hosts: Host[];
  visible?: boolean;
  onTunnelCountsChange?: (counts: TunnelCounts) => void;
}

type View = "list" | "form";

interface FormState {
  label: string;
  hostId: number | null;
  tunnelType: "local" | "remote";
  bindAddress: string;
  sourcePort: string;
  destinationHost: string;
  destinationPort: string;
}

const emptyForm: FormState = {
  label: "",
  hostId: null,
  tunnelType: "local",
  bindAddress: "127.0.0.1",
  sourcePort: "",
  destinationHost: "",
  destinationPort: "",
};

interface HostKeyVerification {
  tunnelId: number;
  stage: "unknown" | "changed";
  fingerprint: string;
  expectedFingerprint?: string;
  hostname: string;
  port: number;
}

export default function TunnelsPanel({ hosts, visible, onTunnelCountsChange }: Props) {
  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  const [tunnelStatuses, setTunnelStatuses] = useState<Map<number, { status: TunnelStatus; error?: string }>>(new Map());
  const [view, setView] = useState<View>("list");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>({ ...emptyForm });
  const [hostKeyVerify, setHostKeyVerify] = useState<HostKeyVerification | null>(null);

  const loadTunnels = useCallback(async () => {
    try {
      const data = await invoke<Tunnel[]>("get_tunnels");
      setTunnels(data);
    } catch (e) {
      console.error("Failed to load tunnels:", e);
    }
  }, []);

  useEffect(() => { loadTunnels(); }, [loadTunnels]);

  useEffect(() => {
    let active = 0, error = 0;
    tunnelStatuses.forEach(v => {
      if (v.status === "started") active++;
      if (v.status === "error") error++;
    });
    onTunnelCountsChange?.({ active, error });
  }, [tunnelStatuses, onTunnelCountsChange]);

  useEffect(() => {
    if (!visible) return;
    setTunnelStatuses(prev => {
      let changed = false;
      const next = new Map(prev);
      next.forEach((v, k) => {
        if (v.status === "error") { next.delete(k); changed = true; }
      });
      return changed ? next : prev;
    });
  }, [visible]);

  const goToList = useCallback(() => {
    setForm({ ...emptyForm });
    setEditingId(null);
    setView("list");
  }, []);

  const goToForm = useCallback((tunnel?: Tunnel) => {
    if (tunnel) {
      setForm({
        label: tunnel.label,
        hostId: tunnel.host_id,
        tunnelType: tunnel.tunnel_type as "local" | "remote",
        bindAddress: tunnel.bind_address,
        sourcePort: String(tunnel.source_port),
        destinationHost: tunnel.destination_host,
        destinationPort: String(tunnel.destination_port),
      });
      setEditingId(tunnel.id);
    } else {
      setForm({ ...emptyForm });
      setEditingId(null);
    }
    setView("form");
  }, []);

  const onSave = useCallback(async () => {
    if (!form.hostId || !form.sourcePort) return;

    try {
      await invoke("save_tunnel", {
        payload: {
          id: editingId,
          label: form.label.trim() || `${form.tunnelType === "local" ? "L" : "R"}:${form.sourcePort}`,
          host_id: form.hostId,
          tunnel_type: form.tunnelType,
          bind_address: form.bindAddress.trim() || "127.0.0.1",
          source_port: parseInt(form.sourcePort) || 0,
          destination_host: form.destinationHost.trim(),
          destination_port: parseInt(form.destinationPort) || 0,
        },
      });
      await loadTunnels();
      goToList();
    } catch (e) {
      console.error("Failed to save tunnel:", e);
    }
  }, [form, editingId, goToList, loadTunnels]);

  const onDelete = useCallback(async (id: number) => {
    try {
      await invoke("delete_tunnel", { id });
      setTunnelStatuses(prev => { const next = new Map(prev); next.delete(id); return next; });
      await loadTunnels();
    } catch (e) {
      console.error("Failed to delete tunnel:", e);
    }
  }, [loadTunnels]);

  const onToggle = useCallback(async (id: number) => {
    const entry = tunnelStatuses.get(id);
    const isActive = entry?.status === "started";
    try {
      if (isActive) {
        await invoke("stop_tunnel", { tunnelId: id });
      } else {
        setTunnelStatuses(prev => new Map(prev).set(id, { status: "connecting" }));
        await invoke("start_tunnel", { tunnelId: id });
      }
    } catch (e) {
      console.error("Tunnel toggle failed:", e);
      setTunnelStatuses(prev => new Map(prev).set(id, { status: "error", error: String(e) }));
    }
  }, [tunnelStatuses]);

  const onDismissError = useCallback((id: number) => {
    setTunnelStatuses(prev => { const next = new Map(prev); next.delete(id); return next; });
  }, []);

  useEffect(() => {
    const unlisten = listen<{ id: number; status: string; error?: string }>("tunnel-status", (event) => {
      const { id, status, error } = event.payload;
      if (status === "started") {
        setTunnelStatuses(prev => new Map(prev).set(id, { status: "started" }));
      } else if (status === "connecting") {
        setTunnelStatuses(prev => new Map(prev).set(id, { status: "connecting" }));
      } else if (status === "stopped") {
        setTunnelStatuses(prev => { const next = new Map(prev); next.delete(id); return next; });
      } else if (status === "error") {
        setTunnelStatuses(prev => new Map(prev).set(id, { status: "error", error }));
      }
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  useEffect(() => {
    const unlisten = listen<{
      tunnel_id: number; stage: string; fingerprint: string;
      expected_fingerprint?: string; hostname: string; port: number;
    }>("tunnel-host-verify", (event) => {
      const p = event.payload;
      setHostKeyVerify({
        tunnelId: p.tunnel_id,
        stage: p.stage as "unknown" | "changed",
        fingerprint: p.fingerprint,
        expectedFingerprint: p.expected_fingerprint,
        hostname: p.hostname,
        port: p.port,
      });
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  const respondHostKey = useCallback((accept: boolean) => {
    if (!hostKeyVerify) return;
    invoke("respond_tunnel_host_key", { tunnelId: hostKeyVerify.tunnelId, accept }).catch(console.error);
    setHostKeyVerify(null);
  }, [hostKeyVerify]);

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%", width: "100%",
      background: "#0b0d12",
      userSelect: "none", WebkitUserSelect: "none", cursor: "default",
      position: "relative",
    }}>
      <div style={{ height: 36, flexShrink: 0, borderBottom: "1px solid #161925", background: "#080a0f", display: "flex", alignItems: "center", position: "relative" }}>
        <div data-tauri-drag-region style={{ position: "absolute", inset: 0 }} />
        <WindowControls />
      </div>
      <div style={{ flex: 1, overflow: "hidden" }}>
        {view === "list"
          ? <TunnelListView tunnels={tunnels} hosts={hosts} tunnelStatuses={tunnelStatuses} onAdd={() => goToForm()} onEdit={goToForm} onDelete={onDelete} onToggle={onToggle} onDismissError={onDismissError} />
          : <TunnelFormView form={form} setForm={setForm} editingId={editingId} hosts={hosts} onSave={onSave} onCancel={goToList} />
        }
      </div>

      {hostKeyVerify && (
        <HostKeyVerifyDialog verify={hostKeyVerify} onRespond={respondHostKey} />
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 7,
  border: "1px solid #1e2330", background: "#0d1017", color: "#e2e8f0",
  fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: 10, color: "#4a5568", fontWeight: 600, marginBottom: 4,
  textTransform: "uppercase", letterSpacing: "0.05em",
};

const btnSecondary: React.CSSProperties = {
  padding: "4px 8px", borderRadius: 5, border: "1px solid #1e2330",
  background: "transparent", color: "#4a5568", cursor: "pointer",
  fontSize: 10, fontFamily: "inherit",
};

const btnPrimary: React.CSSProperties = {
  padding: "6px 14px", borderRadius: 7, border: "none", cursor: "pointer",
  background: "linear-gradient(135deg,#667eea,#764ba2)",
  color: "#fff", fontSize: 11, fontWeight: 600, fontFamily: "inherit",
};

const hintStyle: React.CSSProperties = {
  fontSize: 10, color: "#475569", marginTop: 4, lineHeight: 1.4,
};

function TunnelListView({ tunnels, hosts, tunnelStatuses, onAdd, onEdit, onDelete, onToggle, onDismissError }: {
  tunnels: Tunnel[];
  hosts: Host[];
  tunnelStatuses: Map<number, { status: TunnelStatus; error?: string }>;
  onAdd: () => void;
  onEdit: (t: Tunnel) => void;
  onDelete: (id: number) => void;
  onToggle: (id: number) => void;
  onDismissError: (id: number) => void;
}) {
  const getHostLabel = (hostId: number) => hosts.find(h => h.id === hostId)?.label ?? "Unknown host";

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 16px 10px", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <IconTunnels color="#4a5568" />
          <span style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>Tunnels</span>
          <span style={{ fontSize: 11, color: "#4a5568" }}>({tunnels.length})</span>
        </div>
        <button onClick={onAdd} style={{
          display: "flex", alignItems: "center", gap: 4,
          ...btnPrimary, padding: "5px 12px",
        }}>
          <IconPlus /> Add
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 12px" }}>
        {tunnels.length === 0 ? (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", height: "100%", gap: 12, color: "#2a3050",
          }}>
            <IconTunnels color="#2a3050" />
            <span style={{ fontSize: 12 }}>No tunnels configured</span>
            <span style={{ fontSize: 10, color: "#1e2330" }}>Click "Add" to create a port forwarding tunnel</span>
          </div>
        ) : (
          tunnels.map(t => {
            const entry = tunnelStatuses.get(t.id);
            return (
              <TunnelCard
                key={t.id}
                tunnel={t}
                hostLabel={getHostLabel(t.host_id)}
                status={entry?.status ?? "idle"}
                errorMsg={entry?.error}
                onEdit={() => onEdit(t)}
                onDelete={() => onDelete(t.id)}
                onToggle={() => onToggle(t.id)}
                onDismissError={() => onDismissError(t.id)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

function TunnelCard({ tunnel, hostLabel, status, errorMsg, onEdit, onDelete, onToggle, onDismissError }: {
  tunnel: Tunnel;
  hostLabel: string;
  status: TunnelStatus;
  errorMsg?: string;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onDismissError: () => void;
}) {
  const isLocal = tunnel.tunnel_type === "local";
  const typeLabel = isLocal ? "LOCAL" : "REMOTE";
  const typeColor = isLocal ? "#667eea" : "#f59e0b";
  const isActive = status === "started";
  const isConnecting = status === "connecting";
  const isError = status === "error";
  const isBusy = isActive || isConnecting;

  const borderColor = isActive ? "#22c55e44" : isError ? "#ef444444" : isConnecting ? "#f59e0b44" : "#1e2330";

  return (
    <div style={{
      background: "#0d1017", borderRadius: 10,
      border: `1px solid ${borderColor}`,
      padding: 14, marginBottom: 8,
      transition: "border-color 0.2s ease",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
            color: typeColor, background: `${typeColor}18`,
            padding: "2px 6px", borderRadius: 4,
          }}>
            {typeLabel}
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>{tunnel.label}</span>
          {isActive && (
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: "#22c55e", boxShadow: "0 0 6px #22c55e88",
              display: "inline-block",
            }} />
          )}
          {isConnecting && (
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: "#f59e0b",
              display: "inline-block",
              animation: "tunnelPulse 1s ease-in-out infinite",
            }} />
          )}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {isConnecting ? (
            <button style={{ ...btnSecondary, color: "#f59e0b", borderColor: "#f59e0b33", cursor: "default" }}>
              Connecting...
            </button>
          ) : (
            <button onClick={onToggle} style={{
              ...btnSecondary,
              color: isActive ? "#ef4444" : "#22c55e",
              borderColor: isActive ? "#ef444433" : "#22c55e33",
            }}>
              {isActive ? "Stop" : "Start"}
            </button>
          )}
          <button onClick={onEdit} style={{ ...btnSecondary, opacity: isBusy ? 0.4 : 1, pointerEvents: isBusy ? "none" : "auto" }}>Edit</button>
          <button onClick={onDelete} style={{ ...btnSecondary, color: "#ef4444", borderColor: "#ef444433", opacity: isBusy ? 0.4 : 1, pointerEvents: isBusy ? "none" : "auto" }}>Delete</button>
        </div>
      </div>

      <div style={{ fontSize: 10, color: "#4a5568", marginBottom: 8 }}>
        via <span style={{ color: "#64748b", fontWeight: 600 }}>{hostLabel}</span>
      </div>

      <div style={{
        display: "flex", alignItems: "center", gap: 0,
        background: "#080a0f", borderRadius: 8, padding: "10px 12px",
        fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
      }}>
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          padding: "4px 10px", borderRadius: 6,
          background: isLocal ? "rgba(102,126,234,0.1)" : "rgba(245,158,11,0.1)",
          border: `1px solid ${isLocal ? "#667eea33" : "#f59e0b33"}`,
          minWidth: 80,
        }}>
          <span style={{ fontSize: 8, color: "#4a5568", textTransform: "uppercase", marginBottom: 2 }}>
            {isLocal ? "local" : "remote"}
          </span>
          <span style={{ color: isLocal ? "#667eea" : "#f59e0b", fontWeight: 600 }}>
            {tunnel.bind_address}:{tunnel.source_port}
          </span>
        </div>

        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 6px" }}>
          <div style={{ flex: 1, height: 1, background: "#2a3050" }} />
          <span style={{ padding: "0 6px", color: "#3a4560", fontSize: 10 }}>
            {isLocal ? "→ SSH →" : "← SSH ←"}
          </span>
          <div style={{ flex: 1, height: 1, background: "#2a3050" }} />
        </div>

        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          padding: "4px 10px", borderRadius: 6,
          background: isLocal ? "rgba(245,158,11,0.1)" : "rgba(102,126,234,0.1)",
          border: `1px solid ${isLocal ? "#f59e0b33" : "#667eea33"}`,
          minWidth: 80,
        }}>
          <span style={{ fontSize: 8, color: "#4a5568", textTransform: "uppercase", marginBottom: 2 }}>
            {isLocal ? "remote" : "local"}
          </span>
          <span style={{ color: isLocal ? "#f59e0b" : "#667eea", fontWeight: 600 }}>
            {tunnel.destination_host}:{tunnel.destination_port}
          </span>
        </div>
      </div>

      {isError && errorMsg && (
        <div style={{
          marginTop: 8, padding: "8px 10px", borderRadius: 6,
          background: "#ef444412", border: "1px solid #ef444433",
          display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8,
        }}>
          <span style={{ fontSize: 10, color: "#ef4444", lineHeight: 1.4, flex: 1 }}>
            {errorMsg}
          </span>
          <button
            onClick={onDismissError}
            style={{
              background: "none", border: "none", color: "#ef444488",
              cursor: "pointer", fontSize: 12, padding: 0, lineHeight: 1, flexShrink: 0,
            }}
          >
            &#x2715;
          </button>
        </div>
      )}
    </div>
  );
}

function HostKeyVerifyDialog({ verify, onRespond }: {
  verify: HostKeyVerification;
  onRespond: (accept: boolean) => void;
}) {
  const isChanged = verify.stage === "changed";
  const warningColor = isChanged ? "#ef4444" : "#f59e0b";

  return (
    <div style={{
      position: "absolute", inset: 0,
      background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 100,
    }}>
      <div style={{
        background: "#0d1017", border: `1px solid ${warningColor}44`,
        borderRadius: 12, padding: 24, maxWidth: 420, width: "90%",
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10, marginBottom: 16,
        }}>
          <span style={{ fontSize: 22 }}>&#9888;</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: warningColor }}>
            {isChanged ? "HOST KEY CHANGED" : "Unknown Host Key"}
          </span>
        </div>

        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 16, lineHeight: 1.6 }}>
          {isChanged
            ? "WARNING: The host key for this server has changed! This could indicate a man-in-the-middle attack."
            : `The authenticity of host "${verify.hostname}:${verify.port}" can't be established. Do you want to trust this server?`
          }
        </div>

        {isChanged && verify.expectedFingerprint && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 9, color: "#4a5568", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>
              Expected Fingerprint
            </div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
              color: "#ef4444", background: "#ef444412",
              padding: "8px 10px", borderRadius: 6, wordBreak: "break-all",
            }}>
              {verify.expectedFingerprint}
            </div>
          </div>
        )}

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 9, color: "#4a5568", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>
            {isChanged ? "Received Fingerprint" : "Server Fingerprint"}
          </div>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
            color: "#e2e8f0", background: "#1e233022",
            padding: "8px 10px", borderRadius: 6, wordBreak: "break-all",
          }}>
            {verify.fingerprint}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={() => onRespond(false)}
            style={{ ...btnSecondary, padding: "6px 14px" }}
          >
            Reject
          </button>
          <button
            onClick={() => onRespond(true)}
            style={{
              ...btnPrimary,
              background: isChanged
                ? "linear-gradient(135deg, #ef4444, #dc2626)"
                : "linear-gradient(135deg, #667eea, #764ba2)",
            }}
          >
            {isChanged ? "Remove Old Key & Trust" : "Trust & Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TunnelFormView({ form, setForm, editingId, hosts, onSave, onCancel }: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  editingId: number | null;
  hosts: Host[];
  onSave: () => void;
  onCancel: () => void;
}) {
  const isLocal = form.tunnelType === "local";

  return (
    <div style={{ padding: 16, overflowY: "auto", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>
          {editingId !== null ? "Edit Tunnel" : "New Tunnel"}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={onCancel} style={btnSecondary}>Cancel</button>
          <button onClick={onSave} style={btnPrimary}>Save</button>
        </div>
      </div>

      <div style={{
        background: "#0d1017", border: "1px solid #1e2330", borderRadius: 10, padding: 16,
        display: "flex", flexDirection: "column", gap: 12,
      }}>
        <div>
          <div style={labelStyle}>Label</div>
          <input
            style={inputStyle}
            placeholder="MySQL Prod"
            value={form.label}
            onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
          />
        </div>

        <div>
          <div style={labelStyle}>SSH Server</div>
          <select
            value={form.hostId ?? ""}
            onChange={e => setForm(f => ({ ...f, hostId: e.target.value ? Number(e.target.value) : null }))}
            style={{
              ...inputStyle,
              appearance: "none",
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%234a5568' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 10px center",
              paddingRight: 28,
            }}
          >
            <option value="">Select a host...</option>
            {hosts.map(h => (
              <option key={h.id} value={h.id}>{h.label}</option>
            ))}
          </select>
          <div style={hintStyle}>The host that will be used to establish the SSH tunnel. Credentials are taken from this host's configuration.</div>
        </div>

        <div>
          <div style={labelStyle}>Type</div>
          <div style={{ display: "flex", gap: 6 }}>
            {(["local", "remote"] as const).map(type_ => (
              <button
                key={type_}
                onClick={() => setForm(f => ({ ...f, tunnelType: type_ }))}
                style={{
                  flex: 1, padding: "8px 0", borderRadius: 7, cursor: "pointer",
                  border: "1px solid",
                  borderColor: form.tunnelType === type_
                    ? (type_ === "local" ? "#667eea" : "#f59e0b")
                    : "#1e2330",
                  background: form.tunnelType === type_
                    ? (type_ === "local" ? "rgba(102,126,234,0.12)" : "rgba(245,158,11,0.12)")
                    : "transparent",
                  color: form.tunnelType === type_
                    ? (type_ === "local" ? "#667eea" : "#f59e0b")
                    : "#4a5568",
                  fontSize: 11, fontWeight: 600, fontFamily: "inherit",
                  transition: "all 0.15s ease",
                }}
              >
                {type_ === "local" ? "Local" : "Remote"}
              </button>
            ))}
          </div>
          <div style={hintStyle}>
            {form.tunnelType === "local"
              ? "Local: Opens a port on your machine that forwards traffic through SSH to a remote destination."
              : "Remote: Opens a port on the SSH server that forwards traffic back to your machine."
            }
          </div>
        </div>
      </div>

      <div style={{
        background: "#0d1017", border: "1px solid #1e2330", borderRadius: 10,
        padding: 16, marginTop: 12,
      }}>
        <div style={{
          display: "flex", alignItems: "stretch", gap: 0,
        }}>
          <div style={{
            flex: 1, padding: 12, borderRadius: 8,
            background: isLocal ? "rgba(102,126,234,0.06)" : "rgba(245,158,11,0.06)",
            border: `1px solid ${isLocal ? "#667eea22" : "#f59e0b22"}`,
          }}>
            <div style={{
              fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
              color: isLocal ? "#667eea" : "#f59e0b", marginBottom: 10,
            }}>
              {isLocal ? "Local Endpoint" : "Remote Endpoint"}
            </div>
            <div style={{ marginBottom: 8 }}>
              <div style={labelStyle}>Bind Address</div>
              <input
                style={inputStyle}
                placeholder="127.0.0.1"
                value={form.bindAddress}
                onChange={e => setForm(f => ({ ...f, bindAddress: e.target.value }))}
              />
              <div style={hintStyle}>
                {isLocal
                  ? "The address on your machine to listen on. Use 127.0.0.1 for local-only access or 0.0.0.0 to allow external connections."
                  : "The address on the SSH server to listen on. Use 127.0.0.1 for server-only access or 0.0.0.0 for all interfaces."
                }
              </div>
            </div>
            <div>
              <div style={labelStyle}>Port</div>
              <input
                style={inputStyle}
                placeholder="3306"
                value={form.sourcePort}
                onChange={e => setForm(f => ({ ...f, sourcePort: e.target.value }))}
              />
              <div style={hintStyle}>
                {isLocal
                  ? "The port on your machine where the tunnel will be accessible."
                  : "The port on the SSH server that will accept incoming connections."
                }
              </div>
            </div>
          </div>

          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            padding: "0 8px", minWidth: 50,
          }}>
            <div style={{ fontSize: 9, color: "#3a4560", fontWeight: 600, marginBottom: 4 }}>SSH</div>
            <div style={{
              fontSize: 16, color: "#3a4560",
              transform: isLocal ? "none" : "scaleX(-1)",
            }}>
              →
            </div>
          </div>

          <div style={{
            flex: 1, padding: 12, borderRadius: 8,
            background: isLocal ? "rgba(245,158,11,0.06)" : "rgba(102,126,234,0.06)",
            border: `1px solid ${isLocal ? "#f59e0b22" : "#667eea22"}`,
          }}>
            <div style={{
              fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
              color: isLocal ? "#f59e0b" : "#667eea", marginBottom: 10,
            }}>
              {isLocal ? "Remote Endpoint" : "Local Endpoint"}
            </div>
            <div style={{ marginBottom: 8 }}>
              <div style={labelStyle}>Host</div>
              <input
                style={inputStyle}
                placeholder={isLocal ? "db.internal" : "localhost"}
                value={form.destinationHost}
                onChange={e => setForm(f => ({ ...f, destinationHost: e.target.value }))}
              />
              <div style={hintStyle}>
                {isLocal
                  ? "The target machine reachable from the SSH server. Use localhost if the service runs on the server itself, or an internal hostname/IP."
                  : "The machine on your local network that will receive the forwarded traffic. Use localhost for services on your own machine."
                }
              </div>
            </div>
            <div>
              <div style={labelStyle}>Port</div>
              <input
                style={inputStyle}
                placeholder="3306"
                value={form.destinationPort}
                onChange={e => setForm(f => ({ ...f, destinationPort: e.target.value }))}
              />
              <div style={hintStyle}>
                {isLocal
                  ? "The port of the service on the remote destination host."
                  : "The port of the service on your local machine."
                }
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

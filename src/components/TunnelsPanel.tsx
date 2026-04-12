import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
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

interface Props {
  hosts: Host[];
  onActiveTunnelsChange?: (count: number) => void;
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

export default function TunnelsPanel({ hosts, onActiveTunnelsChange }: Props) {
  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  const [activeTunnels, setActiveTunnels] = useState<Set<number>>(new Set());
  const [view, setView] = useState<View>("list");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>({ ...emptyForm });

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
    onActiveTunnelsChange?.(activeTunnels.size);
  }, [activeTunnels, onActiveTunnelsChange]);

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
      setActiveTunnels(prev => { const next = new Set(prev); next.delete(id); return next; });
      await loadTunnels();
    } catch (e) {
      console.error("Failed to delete tunnel:", e);
    }
  }, [loadTunnels]);

  const onToggle = useCallback(async (id: number) => {
    const isActive = activeTunnels.has(id);
    if (isActive) {
      setActiveTunnels(prev => { const next = new Set(prev); next.delete(id); return next; });
    } else {
      setActiveTunnels(prev => new Set(prev).add(id));
    }
  }, [activeTunnels]);

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%", width: "100%",
      background: "#0b0d12",
      userSelect: "none", WebkitUserSelect: "none", cursor: "default",
    }}>
      <div style={{ height: 36, flexShrink: 0, borderBottom: "1px solid #161925", background: "#080a0f", display: "flex", alignItems: "center", position: "relative" }}>
        <div data-tauri-drag-region style={{ position: "absolute", inset: 0 }} />
        <WindowControls />
      </div>
      <div style={{ flex: 1, overflow: "hidden" }}>
        {view === "list"
          ? <TunnelListView tunnels={tunnels} hosts={hosts} activeTunnels={activeTunnels} onAdd={() => goToForm()} onEdit={goToForm} onDelete={onDelete} onToggle={onToggle} />
          : <TunnelFormView form={form} setForm={setForm} editingId={editingId} hosts={hosts} onSave={onSave} onCancel={goToList} />
        }
      </div>
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

function TunnelListView({ tunnels, hosts, activeTunnels, onAdd, onEdit, onDelete, onToggle }: {
  tunnels: Tunnel[];
  hosts: Host[];
  activeTunnels: Set<number>;
  onAdd: () => void;
  onEdit: (t: Tunnel) => void;
  onDelete: (id: number) => void;
  onToggle: (id: number) => void;
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
          tunnels.map(t => (
            <TunnelCard key={t.id} tunnel={t} hostLabel={getHostLabel(t.host_id)} isActive={activeTunnels.has(t.id)} onEdit={() => onEdit(t)} onDelete={() => onDelete(t.id)} onToggle={() => onToggle(t.id)} />
          ))
        )}
      </div>
    </div>
  );
}

function TunnelCard({ tunnel, hostLabel, isActive, onEdit, onDelete, onToggle }: {
  tunnel: Tunnel;
  hostLabel: string;
  isActive: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const isLocal = tunnel.tunnel_type === "local";
  const typeLabel = isLocal ? "LOCAL" : "REMOTE";
  const typeColor = isLocal ? "#667eea" : "#f59e0b";

  return (
    <div style={{
      background: "#0d1017", borderRadius: 10,
      border: isActive ? "1px solid #22c55e44" : "1px solid #1e2330",
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
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={onToggle} style={{
            ...btnSecondary,
            color: isActive ? "#ef4444" : "#22c55e",
            borderColor: isActive ? "#ef444433" : "#22c55e33",
          }}>
            {isActive ? "Stop" : "Start"}
          </button>
          <button onClick={onEdit} style={{ ...btnSecondary, opacity: isActive ? 0.4 : 1, pointerEvents: isActive ? "none" : "auto" }}>Edit</button>
          <button onClick={onDelete} style={{ ...btnSecondary, color: "#ef4444", borderColor: "#ef444433", opacity: isActive ? 0.4 : 1, pointerEvents: isActive ? "none" : "auto" }}>Delete</button>
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

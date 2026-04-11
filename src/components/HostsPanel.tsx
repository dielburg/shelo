import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { IconHosts, IconPlus } from "./icons";
import WindowControls from "./WindowControls";

export interface Host {
  id: number;
  label: string;
  hostname: string;
  port: number;
  username: string;
  group: string;
  has_password: boolean;
  jump_path?: number[];
}

interface Props {
  onConnect?: (host: Host) => void;
}

type View = "list" | "form";

interface FormState {
  label: string;
  hostname: string;
  port: string;
  username: string;
  password: string;
  group: string;
  jumpPath: number[];
}

const emptyForm: FormState = {
  label: "", hostname: "", port: "22", username: "", password: "", group: "", jumpPath: [],
};

export default function HostsPanel({ onConnect }: Props) {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [view, setView] = useState<View>("list");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>({ ...emptyForm });

  const loadHosts = useCallback(async () => {
    try {
      const data = await invoke<Host[]>("get_hosts");
      setHosts(data);
    } catch (e) {
      console.error("Failed to load hosts:", e);
    }
  }, []);

  useEffect(() => { loadHosts(); }, [loadHosts]);

  const goToList = useCallback(() => {
    setForm({ ...emptyForm });
    setEditingId(null);
    setView("list");
  }, []);

  const goToForm = useCallback(async (host?: Host) => {
    if (host) {
      let password = "";
      if (host.has_password) {
        try {
          const pw = await invoke<string | null>("get_host_password", { id: host.id });
          password = pw ?? "";
        } catch (e) {
          console.error("Failed to load password:", e);
        }
      }
      setForm({
        label: host.label,
        hostname: host.hostname,
        port: String(host.port),
        username: host.username,
        password,
        group: host.group === "default" ? "" : host.group,
        jumpPath: host.jump_path ?? [],
      });
      setEditingId(host.id);
    } else {
      setForm({ ...emptyForm });
      setEditingId(null);
    }
    setView("form");
  }, []);

  const onSave = useCallback(async () => {
    if (!form.hostname.trim()) return;

    try {
      await invoke("save_host", {
        payload: {
          id: editingId,
          label: form.label.trim(),
          hostname: form.hostname.trim(),
          port: parseInt(form.port) || 22,
          username: form.username.trim(),
          password: form.password || null,
          group: form.group.trim(),
          jump_path: form.jumpPath.length > 0 ? form.jumpPath : null,
        },
      });
      await loadHosts();
      goToList();
    } catch (e) {
      console.error("Failed to save host:", e);
    }
  }, [form, editingId, goToList, loadHosts]);

  const onDelete = useCallback(async (id: number) => {
    try {
      await invoke("delete_host", { id });
      await loadHosts();
    } catch (e) {
      console.error("Failed to delete host:", e);
    }
  }, [loadHosts]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", userSelect: "none", WebkitUserSelect: "none", cursor: "default" }}>
      <div style={{ height: 36, flexShrink: 0, borderBottom: "1px solid #161925", background: "#080a0f", display: "flex", alignItems: "center", position: "relative" }}>
        <div data-tauri-drag-region style={{ position: "absolute", inset: 0 }} />
        <WindowControls />
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
        <div style={{ maxWidth: 520, margin: "0 auto" }}>
          {view === "list" ? (
            <HostListView
              hosts={hosts}
              onAdd={() => goToForm()}
              onEdit={goToForm}
              onDelete={onDelete}
              onConnect={onConnect}
            />
          ) : (
            <HostFormView
              form={form}
              setForm={setForm}
              editingId={editingId}
              hosts={hosts}
              onSave={onSave}
              onCancel={goToList}
            />
          )}
        </div>
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

function HostListView({ hosts, onAdd, onEdit, onDelete, onConnect }: {
  hosts: Host[];
  onAdd: () => void;
  onEdit: (h: Host) => void;
  onDelete: (id: number) => void;
  onConnect?: (h: Host) => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? hosts.filter(h => {
        const q = search.toLowerCase();
        return h.label.toLowerCase().includes(q)
          || h.hostname.toLowerCase().includes(q);
      })
    : hosts;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <IconHosts color="#667eea" />
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#e2e8f0" }}>Saved Hosts</h2>
          <span style={{ fontSize: 11, color: "#4a5568", fontWeight: 500 }}>{hosts.length}</span>
        </div>
        <button onClick={onAdd} style={{ ...btnPrimary, display: "flex", alignItems: "center", gap: 5 }}>
          <IconPlus /> Add Host
        </button>
      </div>

      {hosts.length > 0 && (
        <input
          style={{ ...inputStyle, marginBottom: 16 }}
          placeholder="Search by name or hostname..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      )}

      {hosts.length === 0 ? (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: "60px 0", gap: 12, color: "#2a3050",
        }}>
          <IconHosts color="#2a3050" />
          <p style={{ fontSize: 13, margin: 0 }}>No saved hosts</p>
          <p style={{ fontSize: 11, margin: 0, color: "#1e2330" }}>Add a host to get started</p>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: "#4a5568", fontSize: 12 }}>
          No hosts matching "{search}"
        </div>
      ) : (
        <HostList hosts={filtered} onEdit={onEdit} onDelete={onDelete} onConnect={onConnect} />
      )}
    </>
  );
}

function HostFormView({ form, setForm, editingId, hosts, onSave, onCancel }: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  editingId: number | null;
  hosts: Host[];
  onSave: () => void;
  onCancel: () => void;
}) {
  const [jumpExpanded, setJumpExpanded] = useState(form.jumpPath.length > 0);
  const [showPassword, setShowPassword] = useState(false);
  const availableHops = hosts.filter(h => h.id !== editingId);

  const addHop = useCallback((hostId: number) => {
    setForm(f => ({ ...f, jumpPath: [...f.jumpPath, hostId] }));
  }, [setForm]);

  const removeHop = useCallback((index: number) => {
    setForm(f => ({ ...f, jumpPath: f.jumpPath.filter((_, i) => i !== index) }));
  }, [setForm]);

  const moveHop = useCallback((index: number, direction: "up" | "down") => {
    setForm(f => {
      const path = [...f.jumpPath];
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= path.length) return f;
      [path[index], path[target]] = [path[target], path[index]];
      return { ...f, jumpPath: path };
    });
  }, [setForm]);

  const getHostLabel = useCallback((id: number) => {
    const host = hosts.find(h => h.id === id);
    return host ? host.label : `Host #${id}`;
  }, [hosts]);

  const getHostDetail = useCallback((id: number) => {
    const host = hosts.find(h => h.id === id);
    return host ? `${host.username ? host.username + "@" : ""}${host.hostname}:${host.port}` : "";
  }, [hosts]);

  return (
    <>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <button
          onClick={onCancel}
          style={{
            ...btnSecondary, padding: "5px 8px", fontSize: 14, lineHeight: 1,
            color: "#667eea", borderColor: "transparent",
          }}
        >
          ←
        </button>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#e2e8f0" }}>
          {editingId !== null ? "Edit Host" : "New Host"}
        </h2>
      </div>

      {/* Basic fields */}
      <div style={{
        background: "#0d1017", border: "1px solid #1e2330", borderRadius: 10, padding: 16, marginBottom: 12,
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#667eea", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Connection
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div style={labelStyle}>Label (optional)</div>
            <input style={inputStyle} placeholder="My Server" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={labelStyle}>Hostname / IP</div>
              <input style={inputStyle} placeholder="192.168.1.100" value={form.hostname} onChange={e => setForm(f => ({ ...f, hostname: e.target.value }))} />
            </div>
            <div style={{ width: 80 }}>
              <div style={labelStyle}>Port</div>
              <input style={inputStyle} placeholder="22" value={form.port} onChange={e => setForm(f => ({ ...f, port: e.target.value }))} />
            </div>
          </div>
          <div>
            <div style={labelStyle}>Username</div>
            <input style={inputStyle} placeholder="root" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
          </div>
          <div>
            <div style={labelStyle}>Password</div>
            <div style={{ position: "relative" }}>
              <input
                type={showPassword ? "text" : "password"}
                style={{ ...inputStyle, paddingRight: 34 }}
                placeholder="••••••••"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                style={{
                  position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", cursor: "pointer", padding: 4,
                  color: showPassword ? "#7b93db" : "#4a5568", fontSize: 14, lineHeight: 1,
                }}
                title={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                )}
              </button>
            </div>
          </div>
          <div>
            <div style={labelStyle}>Group (optional)</div>
            <GroupComboBox
              value={form.group}
              onChange={v => setForm(f => ({ ...f, group: v }))}
              groups={[...new Set(hosts.map(h => h.group).filter(g => g !== "default"))]}
            />
          </div>
        </div>
      </div>

      {/* Jump Path section */}
      <div style={{
        background: "#0d1017", border: "1px solid #1e2330", borderRadius: 10, padding: 16, marginBottom: 16,
      }}>
        <button
          onClick={() => setJumpExpanded(!jumpExpanded)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            width: "100%", background: "none", border: "none", cursor: "pointer",
            padding: 0, color: "#667eea",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Jump Path
            </span>
            {form.jumpPath.length > 0 && (
              <span style={{
                fontSize: 9, background: "#667eea22", color: "#667eea",
                padding: "2px 6px", borderRadius: 4, fontWeight: 600,
              }}>
                {form.jumpPath.length} hop{form.jumpPath.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <span style={{ fontSize: 12, transition: "transform 0.2s", transform: jumpExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>
            ▾
          </span>
        </button>

        {jumpExpanded && (
          <div style={{ marginTop: 14 }}>
            {form.jumpPath.length === 0 && availableHops.length === 0 && (
              <div style={{ fontSize: 11, color: "#4a5568", textAlign: "center", padding: "12px 0" }}>
                Save other hosts first to create a jump path
              </div>
            )}

            {/* Hop tree visualization */}
            {form.jumpPath.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                {form.jumpPath.map((hopId, index) => (
                  <div key={`${hopId}-${index}`} style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 2 }}>
                    {/* Tree connector */}
                    <div style={{ width: 24, display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                      {index > 0 && (
                        <div style={{ width: 1, height: 8, background: "#1e2330" }} />
                      )}
                      <div style={{
                        width: 8, height: 8, borderRadius: "50%",
                        background: "#667eea33", border: "1.5px solid #667eea",
                        flexShrink: 0,
                      }} />
                      {index < form.jumpPath.length - 1 && (
                        <div style={{ width: 1, height: 8, background: "#1e2330" }} />
                      )}
                    </div>

                    {/* Hop card */}
                    <div style={{
                      flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "6px 10px", borderRadius: 6,
                      background: "#111522", border: "1px solid #1e2330",
                    }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "#e2e8f0" }}>
                          <span style={{ color: "#4a5568", marginRight: 6, fontSize: 9 }}>HOP {index + 1}</span>
                          {getHostLabel(hopId)}
                        </div>
                        <div style={{ fontSize: 9, color: "#4a5568", marginTop: 1 }}>
                          {getHostDetail(hopId)}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 2 }}>
                        <button
                          onClick={() => moveHop(index, "up")}
                          disabled={index === 0}
                          style={{
                            ...btnSecondary, padding: "2px 5px", fontSize: 9,
                            opacity: index === 0 ? 0.3 : 1,
                          }}
                        >↑</button>
                        <button
                          onClick={() => moveHop(index, "down")}
                          disabled={index === form.jumpPath.length - 1}
                          style={{
                            ...btnSecondary, padding: "2px 5px", fontSize: 9,
                            opacity: index === form.jumpPath.length - 1 ? 0.3 : 1,
                          }}
                        >↓</button>
                        <button
                          onClick={() => removeHop(index)}
                          style={{ ...btnSecondary, padding: "2px 5px", fontSize: 9, color: "#e53e3e" }}
                        >✕</button>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Arrow to destination */}
                <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
                  <div style={{ width: 24, display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{ width: 1, height: 8, background: "#1e2330" }} />
                    <div style={{ fontSize: 8, color: "#667eea" }}>▼</div>
                  </div>
                  <div style={{
                    fontSize: 10, color: "#667eea", fontWeight: 600, padding: "4px 10px",
                  }}>
                    {form.label.trim() || form.hostname.trim() || "This host"}
                  </div>
                </div>
              </div>
            )}

            {/* Add hop */}
            {availableHops.length > 0 && (
              <AddHopPicker hosts={availableHops} onAdd={addHop} />
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button onClick={onCancel} style={{ ...btnSecondary, padding: "6px 14px", fontSize: 11, fontWeight: 600 }}>
          Cancel
        </button>
        <button
          onClick={onSave}
          style={{ ...btnPrimary, opacity: form.hostname.trim() ? 1 : 0.5 }}
        >
          {editingId !== null ? "Save Changes" : "Add Host"}
        </button>
      </div>
    </>
  );
}

function GroupComboBox({ value, onChange, groups }: {
  value: string;
  onChange: (v: string) => void;
  groups: string[];
}) {
  const [open, setOpen] = useState(false);
  const filtered = groups.filter(g =>
    !value || g.toLowerCase().includes(value.toLowerCase())
  );

  return (
    <div style={{ position: "relative" }}>
      <input
        style={inputStyle}
        placeholder="default"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => { if (groups.length > 0) setOpen(true); }}
      />
      {open && filtered.length > 0 && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 99 }}
            onClick={() => setOpen(false)}
          />
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
            zIndex: 100, borderRadius: 8, overflow: "hidden",
            border: "1px solid #1e2330", background: "#0d1017",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            maxHeight: 160, overflowY: "auto",
          }}>
            {filtered.map(g => (
              <button
                key={g}
                onClick={() => { onChange(g); setOpen(false); }}
                style={{
                  display: "block", width: "100%", padding: "8px 12px",
                  background: "transparent", border: "none", cursor: "pointer",
                  textAlign: "left", fontFamily: "inherit",
                  borderBottom: "1px solid #111522",
                  fontSize: 11, color: "#e2e8f0",
                  transition: "background 0.1s",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "#111522"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              >
                {g}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AddHopPicker({ hosts, onAdd }: { hosts: Host[]; onAdd: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? hosts.filter(h => {
        const q = search.toLowerCase();
        return h.label.toLowerCase().includes(q)
          || h.hostname.toLowerCase().includes(q);
      })
    : hosts;

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => { setOpen(!open); setSearch(""); }}
        style={{
          display: "flex", alignItems: "center", gap: 6, width: "100%",
          padding: "8px 10px", borderRadius: 7,
          border: "1px dashed #1e2330", background: "transparent",
          color: "#4a5568", fontSize: 11, cursor: "pointer", fontFamily: "inherit",
          transition: "all 0.15s ease",
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = "#667eea55";
          e.currentTarget.style.color = "#667eea";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = "#1e2330";
          e.currentTarget.style.color = "#4a5568";
        }}
      >
        <span style={{ fontSize: 13, lineHeight: 1 }}>+</span>
        Add hop
      </button>

      {open && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 99 }}
            onClick={() => setOpen(false)}
          />
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
            zIndex: 100, borderRadius: 8, overflow: "hidden",
            border: "1px solid #1e2330", background: "#0d1017",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            maxHeight: 240, display: "flex", flexDirection: "column",
          }}>
            <div style={{ padding: 8, borderBottom: "1px solid #1e2330", flexShrink: 0 }}>
              <input
                style={inputStyle}
                placeholder="Search host..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: "12px 0", textAlign: "center", fontSize: 11, color: "#4a5568" }}>
                No hosts found
              </div>
            ) : filtered.map(h => (
              <button
                key={h.id}
                onClick={() => { onAdd(h.id); setOpen(false); }}
                style={{
                  display: "block", width: "100%", padding: "8px 12px",
                  background: "transparent", border: "none", cursor: "pointer",
                  textAlign: "left", fontFamily: "inherit",
                  borderBottom: "1px solid #111522",
                  transition: "background 0.1s",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "#111522"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{ fontSize: 11, fontWeight: 600, color: "#e2e8f0" }}>
                  {h.label}
                </div>
                <div style={{ fontSize: 9, color: "#4a5568", marginTop: 1 }}>
                  {h.username ? `${h.username}@` : ""}{h.hostname}:{h.port}
                </div>
              </button>
            ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function HostList({ hosts, onEdit, onDelete, onConnect }: {
  hosts: Host[];
  onEdit: (h: Host) => void;
  onDelete: (id: number) => void;
  onConnect?: (h: Host) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = new Map<string, Host[]>();
  for (const host of hosts) {
    const g = host.group;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(host);
  }

  const sortedGroups = Array.from(groups.entries()).sort(([a], [b]) => {
    if (a === "default") return -1;
    if (b === "default") return 1;
    return a.localeCompare(b);
  });

  const toggleGroup = (group: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(group) ? next.delete(group) : next.add(group);
      return next;
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {sortedGroups.map(([group, groupHosts]) => (
        <div key={group}>
          <div
            onClick={() => toggleGroup(group)}
            style={{
              fontSize: 9, color: "#4a5568", fontWeight: 700,
              letterSpacing: "0.08em", textTransform: "uppercase",
              padding: "0 4px 6px", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            <span style={{
              fontSize: 8, transition: "transform 0.2s",
              transform: collapsed.has(group) ? "rotate(-90deg)" : "rotate(0deg)",
              display: "inline-block",
            }}>▾</span>
            {group} · {groupHosts.length}
          </div>
          {!collapsed.has(group) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {groupHosts.map(host => (
                <HostRow key={host.id} host={host} onEdit={onEdit} onDelete={onDelete} onConnect={onConnect} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function HostRow({ host, onEdit, onDelete, onConnect }: {
  host: Host;
  onEdit: (h: Host) => void;
  onDelete: (id: number) => void;
  onConnect?: (h: Host) => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 12px", borderRadius: 8,
        background: hovered ? "#111522" : "#0b0d12",
        border: "1px solid", borderColor: hovered ? "#1e2330" : "transparent",
        transition: "all 0.15s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 7,
          background: "#111522", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <IconHosts color="#667eea" />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {host.label}
            </span>
            {host.jump_path && host.jump_path.length > 0 && (
              <span style={{
                fontSize: 8, background: "#667eea22", color: "#667eea",
                padding: "1px 5px", borderRadius: 3, fontWeight: 600,
              }}>
                {host.jump_path.length} hop{host.jump_path.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div style={{ fontSize: 10, color: "#4a5568", marginTop: 1 }}>
            {host.username ? `${host.username}@` : ""}{host.hostname}:{host.port}
          </div>
        </div>
      </div>

      {hovered && (
        <div style={{ display: "flex", gap: 4, flexShrink: 0, marginLeft: 8 }}>
          {onConnect && (
            <button
              onClick={() => onConnect(host)}
              style={{
                padding: "4px 10px", borderRadius: 5, border: "none", cursor: "pointer",
                background: "linear-gradient(135deg,#667eea,#764ba2)",
                color: "#fff", fontSize: 10, fontWeight: 600, fontFamily: "inherit",
              }}
            >
              Connect
            </button>
          )}
          <button onClick={() => onEdit(host)} style={btnSecondary}>Edit</button>
          <button onClick={() => onDelete(host.id)} style={{ ...btnSecondary, color: "#e53e3e" }}>Del</button>
        </div>
      )}
    </div>
  );
}

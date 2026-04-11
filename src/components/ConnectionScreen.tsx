import { invoke } from "@tauri-apps/api/core";

export interface ConnectionStage {
  stage: string;
  message: string;
  fingerprint?: string;
  expected_fingerprint?: string;
  hop_current?: number;
  hop_total?: number;
  hop_label?: string;
}

interface Props {
  sessionId: number;
  stages: ConnectionStage[];
  onClose: () => void;
  onReconnect: () => void;
  autoReconnect?: boolean;
  onAutoReconnectChange?: (enabled: boolean) => void;
  countdown?: number | null;
  retryAttempt?: number;
  retryLimit?: number;
  onCancelCountdown?: () => void;
}

const terminalStages = ["connecting", "handshake", "host_verified", "authenticating", "channel", "connected", "hop_connected"];

function stageIcon(stage: string, isLatest: boolean): string {
  if (stage === "error" || stage === "disconnected") return "\u2718";
  if (stage === "host_verify" || stage === "host_changed") return "\u26a0";
  if (stage === "hop_connected") return "\u2714";
  if (isLatest) return "\u23f3";
  return "\u2714";
}

function stageColor(stage: string, isLatest: boolean): string {
  if (stage === "error" || stage === "disconnected") return "#ff6b6b";
  if (stage === "host_changed") return "#ff6b6b";
  if (stage === "host_verify") return "#ffd93d";
  if (stage === "hop_connected") return "#4ecdc4";
  if (isLatest) return "#667eea";
  return "#4ecdc4";
}

export default function ConnectionScreen({ sessionId, stages, onClose, onReconnect, autoReconnect, onAutoReconnectChange, countdown, retryAttempt, retryLimit, onCancelCountdown }: Props) {
  const latest = stages[stages.length - 1];
  const isError = latest?.stage === "error";
  const isDisconnected = latest?.stage === "disconnected";
  const needsVerify = latest?.stage === "host_verify";
  const hostChanged = latest?.stage === "host_changed";

  const respondKey = (accept: boolean) => {
    invoke("respond_host_key", { sessionId, accept }).catch(console.error);
  };

  const containerStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: "#0b0d12",
    color: "#e2e8f0",
    fontFamily: "'JetBrainsMono Nerd Font', 'JetBrains Mono', monospace",
    fontSize: 13,
    padding: 40,
  };

  const stageListStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minWidth: 350,
    maxWidth: 500,
  };

  const stageRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
  };

  const btnBase: React.CSSProperties = {
    padding: "8px 20px",
    borderRadius: 6,
    border: "none",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: 500,
  };

  const displayStages: ConnectionStage[] = [];
  const seen = new Set<string>();
  for (const s of stages) {
    const key = terminalStages.includes(s.stage) ? s.stage + (s.hop_current ?? "") : s.stage + s.message;
    if (seen.has(key)) {
      const idx = displayStages.findIndex(d => {
        const dKey = terminalStages.includes(d.stage) ? d.stage + (d.hop_current ?? "") : d.stage + d.message;
        return dKey === key;
      });
      if (idx >= 0) displayStages[idx] = s;
    } else {
      seen.add(key);
      displayStages.push(s);
    }
  }

  const hasHops = displayStages.some(s => s.hop_current != null);

  return (
    <div style={containerStyle}>
      <div style={stageListStyle}>
        {hasHops && (
          <div style={{ fontSize: 10, color: "#4a5568", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
            Jump Path Connection
          </div>
        )}

        {displayStages.map((s, i) => {
          const isLast = i === displayStages.length - 1;
          const prevStage = i > 0 ? displayStages[i - 1] : null;
          const isNewHop = s.hop_current != null && prevStage?.hop_current !== s.hop_current;
          const isDestination = s.hop_current == null && prevStage?.hop_current != null;

          return (
            <div key={i}>
              {/* Hop separator */}
              {hasHops && isNewHop && s.hop_current != null && (
                <div style={{
                  fontSize: 9, color: "#667eea", fontWeight: 700, marginTop: i > 0 ? 10 : 0, marginBottom: 4,
                  textTransform: "uppercase", letterSpacing: "0.06em",
                  display: "flex", alignItems: "center", gap: 8,
                }}>
                  <span style={{ width: 18, height: 1, background: "#667eea33" }} />
                  Hop {s.hop_current}/{s.hop_total}: {s.hop_label}
                </div>
              )}

              {/* Destination separator */}
              {hasHops && isDestination && (
                <div style={{
                  fontSize: 9, color: "#4ecdc4", fontWeight: 700, marginTop: 10, marginBottom: 4,
                  textTransform: "uppercase", letterSpacing: "0.06em",
                  display: "flex", alignItems: "center", gap: 8,
                }}>
                  <span style={{ width: 18, height: 1, background: "#4ecdc433" }} />
                  Destination
                </div>
              )}

              <div style={stageRowStyle}>
                <span style={{
                  color: stageColor(s.stage, isLast),
                  minWidth: 18, textAlign: "center",
                  fontSize: s.stage === "hop_connected" ? 11 : 13,
                }}>
                  {stageIcon(s.stage, isLast)}
                </span>
                <span style={{
                  color: isLast && !isError && s.stage !== "hop_connected" ? "#e2e8f0" : stageColor(s.stage, isLast),
                  fontSize: s.stage === "hop_connected" ? 12 : 13,
                }}>
                  {s.message}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {needsVerify && (
        <div style={{ marginTop: 24, padding: 20, background: "#1a1d27", borderRadius: 8, border: "1px solid #ffd93d33", maxWidth: 500 }}>
          <div style={{ color: "#ffd93d", marginBottom: 12, fontWeight: 600 }}>
            Unknown host key
            {latest.hop_current != null && (
              <span style={{ fontWeight: 400, fontSize: 12 }}> (Hop {latest.hop_current}/{latest.hop_total}: {latest.hop_label})</span>
            )}
          </div>
          <div style={{ color: "#8892b0", fontSize: 12, marginBottom: 8 }}>Fingerprint:</div>
          <div style={{ color: "#e2e8f0", fontSize: 12, fontFamily: "monospace", background: "#0b0d12", padding: "8px 12px", borderRadius: 4, marginBottom: 16, wordBreak: "break-all" }}>
            {latest.fingerprint}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => respondKey(true)} style={{ ...btnBase, background: "#4ecdc4", color: "#0b0d12" }}>
              Trust &amp; Save
            </button>
            <button onClick={() => respondKey(false)} style={{ ...btnBase, background: "#3a4560", color: "#e2e8f0" }}>
              Reject
            </button>
          </div>
        </div>
      )}

      {hostChanged && (
        <div style={{ marginTop: 24, padding: 20, background: "#1a1d27", borderRadius: 8, border: "1px solid #ff6b6b55", maxWidth: 500 }}>
          <div style={{ color: "#ff6b6b", marginBottom: 12, fontWeight: 600, fontSize: 14 }}>
            HOST KEY CHANGED
            {latest.hop_current != null && (
              <span style={{ fontWeight: 400, fontSize: 12 }}> (Hop {latest.hop_current}/{latest.hop_total}: {latest.hop_label})</span>
            )}
          </div>
          <div style={{ color: "#8892b0", fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>
            The host key for this server has changed since last connection!<br />
            This could mean:<br />
            &bull; The server was reinstalled<br />
            &bull; Someone is intercepting traffic (MITM)
          </div>
          <div style={{ color: "#8892b0", fontSize: 12, marginBottom: 4 }}>Expected:</div>
          <div style={{ color: "#ff8e8e", fontSize: 12, fontFamily: "monospace", background: "#0b0d12", padding: "6px 12px", borderRadius: 4, marginBottom: 8, wordBreak: "break-all" }}>
            {latest.expected_fingerprint}
          </div>
          <div style={{ color: "#8892b0", fontSize: 12, marginBottom: 4 }}>Received:</div>
          <div style={{ color: "#ffd93d", fontSize: 12, fontFamily: "monospace", background: "#0b0d12", padding: "6px 12px", borderRadius: 4, marginBottom: 16, wordBreak: "break-all" }}>
            {latest.fingerprint}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => respondKey(true)} style={{ ...btnBase, background: "#ff6b6b", color: "#fff" }}>
              Remove Old Key &amp; Reconnect
            </button>
            <button onClick={() => respondKey(false)} style={{ ...btnBase, background: "#3a4560", color: "#e2e8f0" }}>
              Reject
            </button>
          </div>
        </div>
      )}

      {(isError || isDisconnected) && (
        <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 12 }}>
          {(isDisconnected || isError) && onAutoReconnectChange && (
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <label
                onClick={(e) => { e.preventDefault(); onAutoReconnectChange!(!autoReconnect); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                  userSelect: "none", WebkitUserSelect: "none",
                }}
              >
                <span style={{
                  fontSize: 11, fontWeight: 500,
                  color: autoReconnect ? "#8b9df0" : "#4a5568",
                  transition: "color 0.2s ease",
                }}>
                  Auto-reconnect
                </span>
                <div style={{
                  width: 28, height: 14, borderRadius: 7,
                  background: autoReconnect ? "#667eea" : "#2a3050",
                  position: "relative", transition: "background 0.2s ease",
                  flexShrink: 0,
                }}>
                  <div style={{
                    width: 10, height: 10, borderRadius: "50%",
                    background: autoReconnect ? "#fff" : "#4a5568",
                    position: "absolute", top: 2,
                    left: autoReconnect ? 16 : 2,
                    transition: "left 0.2s ease, background 0.2s ease",
                  }} />
                </div>
              </label>
            </div>
          )}

          {countdown != null && countdown > 0 ? (
            <>
              <div style={{ fontSize: 13, color: "#8892b0", textAlign: "center" }}>
                Reconnecting in <span style={{ color: "#667eea", fontWeight: 700 }}>{countdown}</span>s...
                {retryAttempt != null && (
                  <span style={{ color: "#475569", fontSize: 11, marginLeft: 8 }}>
                    attempt {retryAttempt}{retryLimit ? `/${retryLimit}` : ""}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button onClick={onReconnect} style={{ ...btnBase, background: "#667eea", color: "#fff" }}>
                  Reconnect now
                </button>
                <button onClick={onCancelCountdown} style={{ ...btnBase, background: "#3a4560", color: "#e2e8f0" }}>
                  Cancel
                </button>
                <button onClick={onClose} style={{ ...btnBase, background: "#3a4560", color: "#e2e8f0" }}>
                  Close
                </button>
              </div>
            </>
          ) : (
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={onReconnect} style={{ ...btnBase, background: "#667eea", color: "#fff" }}>
                Reconnect
              </button>
              <button onClick={onClose} style={{ ...btnBase, background: "#3a4560", color: "#e2e8f0" }}>
                Close
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

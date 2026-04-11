import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  onUnlock: () => void;
}

export default function VaultUnlock({ onUnlock }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const onSubmit = useCallback(async () => {
    if (!password) return;

    setError("");
    setLoading(true);

    try {
      await invoke("unlock_vault", { password });
      onUnlock();
    } catch (e) {
      setError("Wrong password. Please try again.");
      setPassword("");
    } finally {
      setLoading(false);
    }
  }, [password, onUnlock]);

  return (
    <div style={containerStyle}>
      <div data-tauri-drag-region style={dragRegionStyle} />
      <div style={cardStyle}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={lockIconStyle}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#667eea" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, marginTop: 16, color: "#e2e8f0" }}>
            Vault locked
          </h1>
          <p style={{ fontSize: 13, color: "#64748b", marginTop: 6 }}>
            Enter your master password to unlock.
          </p>
        </div>

        <div style={{ position: "relative" }}>
          <input
            type={showPassword ? "text" : "password"}
            placeholder="Master password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && onSubmit()}
            style={{ ...inputStyle, width: "100%", boxSizing: "border-box", paddingRight: 38 }}
            autoFocus
          />
          <button type="button" onClick={() => setShowPassword(v => !v)} style={eyeButtonStyle}>
            {showPassword ? eyeOffIcon : eyeIcon}
          </button>
        </div>

        {error && (
          <div style={errorStyle}>{error}</div>
        )}

        <button
          onClick={onSubmit}
          disabled={loading || !password}
          style={{
            ...btnPrimary,
            marginTop: 16,
            opacity: loading || !password ? 0.5 : 1,
            cursor: loading || !password ? "default" : "pointer",
          }}
        >
          {loading ? "Unlocking..." : "Unlock"}
        </button>

        <p style={{ fontSize: 11, color: "#475569", marginTop: 16, textAlign: "center", lineHeight: 1.5 }}>
          Forgot your password? Encrypted data cannot be recovered without it.
        </p>
      </div>
    </div>
  );
}

const dragRegionStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  height: 36,
};

const containerStyle: React.CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100vh",
  width: "100%",
  background: "#0b0d12",
  fontFamily: "'Inter', system-ui, sans-serif",
};

const cardStyle: React.CSSProperties = {
  width: 380,
  padding: 32,
  background: "#0d1017",
  border: "1px solid #1e2330",
  borderRadius: 16,
  display: "flex",
  flexDirection: "column",
};

const lockIconStyle: React.CSSProperties = {
  width: 56,
  height: 56,
  borderRadius: "50%",
  background: "rgba(102,126,234,0.1)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  margin: "0 auto",
};

const inputStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 10,
  border: "1px solid #1e2330",
  background: "#111522",
  color: "#e2e8f0",
  fontSize: 14,
  outline: "none",
  fontFamily: "inherit",
};

const btnPrimary: React.CSSProperties = {
  padding: "12px 0",
  borderRadius: 10,
  border: "none",
  background: "linear-gradient(135deg,#667eea,#764ba2)",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};

const errorStyle: React.CSSProperties = {
  marginTop: 10,
  padding: "8px 12px",
  borderRadius: 8,
  background: "rgba(239,68,68,0.1)",
  border: "1px solid rgba(239,68,68,0.3)",
  color: "#ef4444",
  fontSize: 12,
  textAlign: "center",
};

const eyeButtonStyle: React.CSSProperties = {
  position: "absolute",
  right: 8,
  top: "50%",
  transform: "translateY(-50%)",
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: 4,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#64748b",
};

const eyeIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const eyeOffIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

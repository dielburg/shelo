import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

interface Props {
  onComplete: () => void;
}

type Mode = "encrypted" | "plaintext" | "import";

export default function VaultSetup({ onComplete }: Props) {
  const [mode, setMode] = useState<Mode>("encrypted");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [importPath, setImportPath] = useState("");
  const [importPassword, setImportPassword] = useState("");
  const [importNeedsPassword, setImportNeedsPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onBrowse = useCallback(async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "Shelo Files", extensions: ["vault", "json"] }],
      });
      if (path) {
        const p = typeof path === "string" ? path : path;
        setImportPath(p);
        setImportNeedsPassword(p.endsWith(".vault"));
        setError("");
      }
    } catch (e) {
      console.error("Browse failed:", e);
    }
  }, []);

  const onSubmit = useCallback(async () => {
    setError("");
    setLoading(true);

    try {
      if (mode === "encrypted") {
        if (!password) {
          setError("Password is required");
          setLoading(false);
          return;
        }
        if (password !== confirmPassword) {
          setError("Passwords do not match");
          setLoading(false);
          return;
        }
        if (password.length < 4) {
          setError("Password must be at least 4 characters");
          setLoading(false);
          return;
        }
        await invoke("setup_vault", { mode: "encrypted", password });
      } else if (mode === "plaintext") {
        await invoke("setup_vault", { mode: "plaintext", password: null });
      } else if (mode === "import") {
        if (!importPath) {
          setError("Please select a file to import");
          setLoading(false);
          return;
        }
        if (importNeedsPassword && !importPassword) {
          setError("Password is required for encrypted vault");
          setLoading(false);
          return;
        }
        await invoke("import_vault", {
          path: importPath,
          password: importNeedsPassword ? importPassword : null,
        });
      }
      onComplete();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [mode, password, confirmPassword, importPath, importPassword, importNeedsPassword, onComplete]);

  return (
    <div style={containerStyle}>
      <div data-tauri-drag-region style={dragRegionStyle} />
      <div style={cardStyle}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, color: "#e2e8f0" }}>
            Welcome to Shelo
          </h1>
          <p style={{ fontSize: 13, color: "#64748b", marginTop: 8 }}>
            How would you like to store your connection data?
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label
            style={optionStyle(mode === "encrypted")}
            onClick={() => setMode("encrypted")}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={radioStyle(mode === "encrypted")} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: "#e2e8f0" }}>
                  Encrypted vault
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                  AES-256-GCM encryption with master password. Recommended.
                </div>
              </div>
            </div>
          </label>

          {mode === "encrypted" && (
            <div style={{ padding: "0 12px", display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                type="password"
                placeholder="Master password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={inputStyle}
                autoFocus
              />
              <input
                type="password"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={inputStyle}
                onKeyDown={(e) => e.key === "Enter" && onSubmit()}
              />
            </div>
          )}

          <label
            style={optionStyle(mode === "import")}
            onClick={() => setMode("import")}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={radioStyle(mode === "import")} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: "#e2e8f0" }}>
                  Import existing vault
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                  Import a .vault or .json file from another device.
                </div>
              </div>
            </div>
          </label>

          {mode === "import" && (
            <div style={{ padding: "0 12px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  placeholder="No file selected"
                  value={importPath}
                  readOnly
                  style={{ ...inputStyle, flex: 1, cursor: "default" }}
                />
                <button onClick={onBrowse} style={browseButtonStyle}>
                  Browse
                </button>
              </div>
              {importNeedsPassword && (
                <input
                  type="password"
                  placeholder="Vault password"
                  value={importPassword}
                  onChange={(e) => setImportPassword(e.target.value)}
                  style={inputStyle}
                  onKeyDown={(e) => e.key === "Enter" && onSubmit()}
                />
              )}
            </div>
          )}

          <label
            style={optionStyle(mode === "plaintext")}
            onClick={() => setMode("plaintext")}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={radioStyle(mode === "plaintext")} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: "#e2e8f0" }}>
                  Unencrypted file
                </div>
                <div style={{ fontSize: 11, color: "#ef4444", marginTop: 2, fontWeight: 500 }}>
                  NOT RECOMMENDED — passwords stored in plain text.
                </div>
              </div>
            </div>
          </label>
        </div>

        {error && (
          <div style={errorStyle}>{error}</div>
        )}

        <button
          onClick={onSubmit}
          disabled={loading}
          style={{
            ...btnPrimary,
            marginTop: 24,
            opacity: loading ? 0.6 : 1,
            cursor: loading ? "default" : "pointer",
          }}
        >
          {loading ? "Setting up..." : "Continue"}
        </button>
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
  width: 420,
  padding: 32,
  background: "#0d1017",
  border: "1px solid #1e2330",
  borderRadius: 16,
  display: "flex",
  flexDirection: "column",
};

const optionStyle = (selected: boolean): React.CSSProperties => ({
  padding: 14,
  borderRadius: 10,
  border: `1px solid ${selected ? "#667eea" : "#1e2330"}`,
  background: selected ? "rgba(102,126,234,0.05)" : "transparent",
  cursor: "pointer",
  transition: "all 0.15s",
});

const radioStyle = (selected: boolean): React.CSSProperties => ({
  width: 16,
  height: 16,
  borderRadius: "50%",
  border: `2px solid ${selected ? "#667eea" : "#334155"}`,
  background: selected ? "#667eea" : "transparent",
  flexShrink: 0,
  transition: "all 0.15s",
  boxShadow: selected ? "inset 0 0 0 3px #0d1017" : "none",
});

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #1e2330",
  background: "#111522",
  color: "#e2e8f0",
  fontSize: 13,
  outline: "none",
  fontFamily: "inherit",
};

const browseButtonStyle: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 8,
  border: "1px solid #1e2330",
  background: "#111522",
  color: "#e2e8f0",
  fontSize: 13,
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
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
  marginTop: 12,
  padding: "8px 12px",
  borderRadius: 8,
  background: "rgba(239,68,68,0.1)",
  border: "1px solid rgba(239,68,68,0.3)",
  color: "#ef4444",
  fontSize: 12,
};

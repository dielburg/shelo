import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import WindowControls from "./WindowControls";
import {
  checkForUpdate,
  downloadAndInstall,
  getAutoCheckEnabled,
  setAutoCheckEnabled,
  DownloadProgress,
  UpdateInfo,
} from "../lib/updater";

type Category = "general" | "vault";

interface VaultInfo {
  status: string;
}

interface Props {
  updateInfo: UpdateInfo | null;
  onUpdateChecked?: (info: UpdateInfo | null) => void;
}

export default function SettingsPanel({ updateInfo, onUpdateChecked }: Props) {
  const [category, setCategory] = useState<Category>("general");

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
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      <div style={{
        width: 180, borderRight: "1px solid #161925",
        padding: "16px 0", flexShrink: 0,
        display: "flex", flexDirection: "column",
      }}>
        <div style={{
          padding: "0 16px 12px", fontSize: 11, fontWeight: 700,
          color: "#2a3050", letterSpacing: "0.08em", textTransform: "uppercase",
        }}>
          Settings
        </div>
        <CategoryButton
          label="General"
          active={category === "general"}
          onClick={() => setCategory("general")}
        />
        <CategoryButton
          label="Vault"
          active={category === "vault"}
          onClick={() => setCategory("vault")}
        />
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "20px 28px" }}>
        {category === "general" && (
          <GeneralSettings updateInfo={updateInfo} onUpdateChecked={onUpdateChecked} />
        )}
        {category === "vault" && <VaultSettings />}
      </div>
      </div>
    </div>
  );
}

function CategoryButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%", padding: "8px 16px", border: "none",
        background: active ? "rgba(102,126,234,0.10)" : "transparent",
        color: active ? "#667eea" : "#64748b",
        fontSize: 12, fontWeight: active ? 600 : 400,
        textAlign: "left", cursor: "pointer",
        fontFamily: "inherit",
        borderLeft: active ? "2px solid #667eea" : "2px solid transparent",
        transition: "all 0.15s ease",
      }}
    >
      {label}
    </button>
  );
}

function GeneralSettings({ updateInfo, onUpdateChecked }: {
  updateInfo: UpdateInfo | null;
  onUpdateChecked?: (info: UpdateInfo | null) => void;
}) {
  const [version, setVersion] = useState("");
  const [autoCheck, setAutoCheck] = useState(getAutoCheckEnabled);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<UpdateInfo | null>(updateInfo);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useState(() => {
    getVersion().then(setVersion).catch(() => setVersion("unknown"));
  });

  const handleToggleAutoCheck = useCallback((enabled: boolean) => {
    setAutoCheck(enabled);
    setAutoCheckEnabled(enabled);
  }, []);

  const handleCheckNow = useCallback(async () => {
    setChecking(true);
    setError(null);
    setCheckResult(null);
    try {
      const info = await checkForUpdate();
      setCheckResult(info);
      onUpdateChecked?.(info.available ? info : null);
    } catch (e) {
      setError(`${e}`);
    } finally {
      setChecking(false);
    }
  }, [onUpdateChecked]);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    setError(null);
    try {
      await downloadAndInstall((p) => setProgress(p));
    } catch (e) {
      setError(`Update failed: ${e}`);
      setDownloading(false);
    }
  }, []);

  const hasUpdate = checkResult?.available || updateInfo?.available;
  const updateVersion = checkResult?.version || updateInfo?.version || "";
  const updateNotes = checkResult?.notes || updateInfo?.notes || "";

  const btnPrimary: React.CSSProperties = {
    padding: "8px 16px", borderRadius: 6, border: "none",
    background: "linear-gradient(135deg,#667eea,#764ba2)",
    color: "#fff", fontSize: 12, fontWeight: 600,
    cursor: "pointer", fontFamily: "inherit",
  };

  const btnSecondary: React.CSSProperties = {
    padding: "8px 16px", borderRadius: 6,
    border: "1px solid #1e2330", background: "transparent",
    color: "#64748b", fontSize: 12, fontWeight: 500,
    cursor: "pointer", fontFamily: "inherit",
  };

  return (
    <div style={{ maxWidth: 480 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>
        General
      </div>
      <div style={{ fontSize: 12, color: "#475569", marginBottom: 20 }}>
        Application info and update preferences.
      </div>

      <SettingsRow label="Version">
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "4px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600,
          background: "rgba(102,126,234,0.10)", color: "#667eea",
        }}>
          Shelo v{version}
        </div>
      </SettingsRow>

      <SettingsRow
        label="Automatic updates"
        description="Periodically check for new versions in the background."
      >
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={autoCheck}
            onChange={e => handleToggleAutoCheck(e.target.checked)}
            style={{ accentColor: "#667eea", width: 14, height: 14 }}
          />
          <span style={{ fontSize: 12, color: "#cbd5e1" }}>Check for updates automatically</span>
        </label>
      </SettingsRow>

      <SettingsRow
        label="Check for updates"
        description="Manually check if a new version is available."
      >
        {!hasUpdate ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={handleCheckNow} disabled={checking} style={btnPrimary}>
              {checking ? "Checking..." : "Check now"}
            </button>
            {checkResult && !checkResult.available && (
              <span style={{ fontSize: 11, color: "#22c55e" }}>You're up to date.</span>
            )}
            {error && (
              <span style={{ fontSize: 11, color: "#ef4444" }}>{error}</span>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{
              padding: "10px 12px", borderRadius: 6,
              background: "rgba(102,126,234,0.08)", border: "1px solid rgba(102,126,234,0.2)",
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#667eea", marginBottom: 4 }}>
                Update available: v{updateVersion}
              </div>
              {updateNotes && (
                <div style={{
                  fontSize: 11, color: "#94a3b8", lineHeight: 1.5,
                  maxHeight: 200, overflowY: "auto",
                  marginTop: 4, paddingRight: 4,
                }}>
                  {renderChangelogNotes(updateNotes)}
                </div>
              )}
            </div>

            {!downloading ? (
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={handleDownload} style={btnPrimary}>
                  Download & Install
                </button>
                <button onClick={handleCheckNow} style={btnSecondary}>
                  Re-check
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>
                  Downloading update...
                </div>
                <div style={{
                  height: 4, borderRadius: 2, background: "#1e2330", overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%", borderRadius: 2,
                    background: "linear-gradient(90deg, #667eea, #764ba2)",
                    width: progress?.total
                      ? `${Math.round((progress.downloaded / progress.total) * 100)}%`
                      : "50%",
                    transition: "width 0.3s ease",
                    animation: progress?.total ? undefined : "pulse 1.5s ease-in-out infinite",
                  }} />
                </div>
                {progress && (
                  <div style={{ fontSize: 10, color: "#475569" }}>
                    {formatBytes(progress.downloaded)}
                    {progress.total ? ` / ${formatBytes(progress.total)}` : ""}
                  </div>
                )}
              </div>
            )}
            {error && (
              <span style={{ fontSize: 11, color: "#ef4444" }}>{error}</span>
            )}
          </div>
        )}
      </SettingsRow>
    </div>
  );
}

function renderChangelogNotes(notes: string) {
  const lines = notes.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];
  let key = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={key++} style={{ margin: "4px 0", paddingLeft: 18 }}>
          {listItems.map((item, i) => (
            <li key={i} style={{ marginBottom: 2 }}>{item}</li>
          ))}
        </ul>
      );
      listItems = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }
    if (trimmed.startsWith("### ")) {
      flushList();
      elements.push(
        <div key={key++} style={{ fontSize: 11, fontWeight: 600, color: "#cbd5e1", marginTop: elements.length > 0 ? 8 : 0, marginBottom: 2 }}>
          {trimmed.slice(4)}
        </div>
      );
    } else if (trimmed.startsWith("- ")) {
      listItems.push(trimmed.slice(2));
    } else {
      flushList();
      elements.push(
        <div key={key++} style={{ marginBottom: 4 }}>{trimmed}</div>
      );
    }
  }
  flushList();
  return elements;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function VaultSettings() {
  const [vaultInfo, setVaultInfo] = useState<VaultInfo | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const [changingPw, setChangingPw] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwMsg, setPwMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [pwLoading, setPwLoading] = useState(false);

  const [migrating, setMigrating] = useState(false);
  const [migratePw, setMigratePw] = useState("");
  const [migrateConfirm, setMigrateConfirm] = useState("");
  const [migrateMsg, setMigrateMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [migrateLoading, setMigrateLoading] = useState(false);

  const loadVaultInfo = useCallback(async () => {
    try {
      const result = await invoke<VaultInfo>("get_vault_status");
      setVaultInfo(result);
    } catch { }
  }, []);

  useState(() => { loadVaultInfo(); });

  const isEncrypted = vaultInfo?.status === "unlocked";
  const isPlaintext = vaultInfo?.status === "plaintext";

  const handleExport = useCallback(async () => {
    const defaultName = isEncrypted ? "hosts.vault" : "hosts.json";
    const ext = isEncrypted ? "vault" : "json";

    const dest = await save({
      defaultPath: defaultName,
      filters: [{ name: "Shelo Files", extensions: [ext] }],
    });

    if (!dest) return;

    setExporting(true);
    setExportMsg(null);
    try {
      await invoke("export_vault", { destPath: dest });
      setExportMsg("Exported successfully.");
    } catch (e) {
      setExportMsg(`Export failed: ${e}`);
    } finally {
      setExporting(false);
    }
  }, [isEncrypted]);

  const handleChangePassword = useCallback(async () => {
    setPwMsg(null);
    if (newPw !== confirmPw) {
      setPwMsg({ type: "err", text: "Passwords do not match." });
      return;
    }
    if (newPw.length < 1) {
      setPwMsg({ type: "err", text: "New password cannot be empty." });
      return;
    }
    setPwLoading(true);
    try {
      await invoke("change_master_password", {
        currentPassword: currentPw,
        newPassword: newPw,
      });
      setPwMsg({ type: "ok", text: "Master password changed successfully." });
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      setChangingPw(false);
    } catch (e) {
      setPwMsg({ type: "err", text: `${e}` });
    } finally {
      setPwLoading(false);
    }
  }, [currentPw, newPw, confirmPw]);

  const handleMigrate = useCallback(async () => {
    setMigrateMsg(null);
    if (migratePw !== migrateConfirm) {
      setMigrateMsg({ type: "err", text: "Passwords do not match." });
      return;
    }
    if (migratePw.length < 1) {
      setMigrateMsg({ type: "err", text: "Password cannot be empty." });
      return;
    }
    setMigrateLoading(true);
    try {
      await invoke("migrate_to_encrypted", { password: migratePw });
      setMigrateMsg({ type: "ok", text: "Migrated to encrypted vault successfully." });
      setMigrating(false);
      setMigratePw("");
      setMigrateConfirm("");
      loadVaultInfo();
    } catch (e) {
      setMigrateMsg({ type: "err", text: `${e}` });
    } finally {
      setMigrateLoading(false);
    }
  }, [migratePw, migrateConfirm, loadVaultInfo]);

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 10px", borderRadius: 6,
    border: "1px solid #1e2330", background: "#0d1017",
    color: "#e2e8f0", fontSize: 12, fontFamily: "inherit",
    outline: "none", boxSizing: "border-box",
  };

  const btnPrimary: React.CSSProperties = {
    padding: "8px 16px", borderRadius: 6, border: "none",
    background: "linear-gradient(135deg,#667eea,#764ba2)",
    color: "#fff", fontSize: 12, fontWeight: 600,
    cursor: "pointer", fontFamily: "inherit",
  };

  const btnSecondary: React.CSSProperties = {
    padding: "8px 16px", borderRadius: 6,
    border: "1px solid #1e2330", background: "transparent",
    color: "#64748b", fontSize: 12, fontWeight: 500,
    cursor: "pointer", fontFamily: "inherit",
  };

  return (
    <div style={{ maxWidth: 480 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>
        Vault
      </div>
      <div style={{ fontSize: 12, color: "#475569", marginBottom: 20 }}>
        Manage your host database encryption and storage.
      </div>

      <SettingsRow label="Storage mode">
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "4px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600,
          background: isEncrypted ? "rgba(34,197,94,0.10)" : "rgba(251,191,36,0.10)",
          color: isEncrypted ? "#22c55e" : "#fbbf24",
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: isEncrypted ? "#22c55e" : "#fbbf24",
          }} />
          {isEncrypted ? "Encrypted" : isPlaintext ? "Unencrypted" : "..."}
        </div>
      </SettingsRow>

      <SettingsRow label="Export" description="Save a copy of your vault file to another location.">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={handleExport} disabled={exporting} style={btnPrimary}>
            {exporting ? "Exporting..." : "Export vault"}
          </button>
          {exportMsg && (
            <span style={{ fontSize: 11, color: exportMsg.includes("failed") ? "#ef4444" : "#22c55e" }}>
              {exportMsg}
            </span>
          )}
        </div>
      </SettingsRow>

      {isEncrypted && (
        <SettingsRow label="Master password" description="Change the master password used to encrypt your vault.">
          {!changingPw ? (
            <button onClick={() => { setChangingPw(true); setPwMsg(null); }} style={btnSecondary}>
              Change password
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
              <input
                type="password"
                placeholder="Current password"
                value={currentPw}
                onChange={e => setCurrentPw(e.target.value)}
                style={inputStyle}
              />
              <input
                type="password"
                placeholder="New password"
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                style={inputStyle}
              />
              <input
                type="password"
                placeholder="Confirm new password"
                value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)}
                style={inputStyle}
                onKeyDown={e => { if (e.key === "Enter") handleChangePassword(); }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={handleChangePassword} disabled={pwLoading} style={btnPrimary}>
                  {pwLoading ? "Changing..." : "Confirm"}
                </button>
                <button onClick={() => { setChangingPw(false); setPwMsg(null); }} style={btnSecondary}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {pwMsg && (
            <span style={{ fontSize: 11, color: pwMsg.type === "err" ? "#ef4444" : "#22c55e", marginTop: 4 }}>
              {pwMsg.text}
            </span>
          )}
        </SettingsRow>
      )}

      {isPlaintext && (
        <SettingsRow
          label="Upgrade to encrypted"
          description="Your hosts are stored without encryption. Migrate to a password-protected vault."
        >
          {!migrating ? (
            <button onClick={() => { setMigrating(true); setMigrateMsg(null); }} style={{
              ...btnPrimary,
              background: "linear-gradient(135deg,#f59e0b,#ef4444)",
            }}>
              Encrypt vault
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
              <input
                type="password"
                placeholder="Set master password"
                value={migratePw}
                onChange={e => setMigratePw(e.target.value)}
                style={inputStyle}
              />
              <input
                type="password"
                placeholder="Confirm password"
                value={migrateConfirm}
                onChange={e => setMigrateConfirm(e.target.value)}
                style={inputStyle}
                onKeyDown={e => { if (e.key === "Enter") handleMigrate(); }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={handleMigrate} disabled={migrateLoading} style={btnPrimary}>
                  {migrateLoading ? "Migrating..." : "Encrypt"}
                </button>
                <button onClick={() => { setMigrating(false); setMigrateMsg(null); }} style={btnSecondary}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {migrateMsg && (
            <span style={{ fontSize: 11, color: migrateMsg.type === "err" ? "#ef4444" : "#22c55e", marginTop: 4 }}>
              {migrateMsg.text}
            </span>
          )}
        </SettingsRow>
      )}
    </div>
  );
}

function SettingsRow({ label, description, children }: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      padding: "14px 0",
      borderBottom: "1px solid #161925",
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#cbd5e1" }}>{label}</div>
        {description && (
          <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>{description}</div>
        )}
      </div>
      {children}
    </div>
  );
}

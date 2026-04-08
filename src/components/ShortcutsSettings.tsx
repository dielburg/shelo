import { useState, useEffect, useCallback, useRef } from "react";
import { ShortcutsAPI } from "../hooks/useShortcuts";
import {
  ShortcutAction,
  ShortcutContext,
  SHORTCUT_METAS,
  formatBinding,
  bindingFromEvent,
  findConflicts,
} from "../lib/shortcuts";

function InfoIcon({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  return (
    <span
      ref={ref}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      style={{
        position: "relative",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 14, height: 14, borderRadius: "50%",
        border: "1px solid #2a3050", color: "#475569",
        fontSize: 9, fontWeight: 700, cursor: "default",
        flexShrink: 0, lineHeight: 1,
      }}
    >
      i
      {show && (
        <span style={{
          position: "absolute", left: 20, top: "50%", transform: "translateY(-50%)",
          background: "#1e2330", border: "1px solid #2a3050", borderRadius: 6,
          padding: "6px 10px", fontSize: 11, color: "#94a3b8",
          whiteSpace: "nowrap", zIndex: 100,
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          pointerEvents: "none",
        }}>
          {text}
        </span>
      )}
    </span>
  );
}

interface Props {
  shortcuts: ShortcutsAPI;
}

export default function ShortcutsSettings({ shortcuts }: Props) {
  const { bindings, platform, updateBinding, resetDefaults } = shortcuts;
  const [capturing, setCapturing] = useState<ShortcutAction | null>(null);
  const [conflict, setConflict] = useState<{ action: ShortcutAction; conflictWith: string } | null>(null);

  useEffect(() => {
    if (!capturing) return;

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setCapturing(null);
        setConflict(null);
        return;
      }

      const newBinding = bindingFromEvent(e);
      if (!newBinding) return;

      const testBindings = { ...bindings, [capturing]: newBinding };
      const conflicts = findConflicts(testBindings);
      const conflictPair = conflicts.find(([a, b]) => a === capturing || b === capturing);

      if (conflictPair) {
        const otherAction = conflictPair[0] === capturing ? conflictPair[1] : conflictPair[0];
        const otherMeta = SHORTCUT_METAS.find(m => m.action === otherAction);
        setConflict({ action: capturing, conflictWith: otherMeta?.label ?? otherAction });
        updateBinding(capturing, newBinding);
        setCapturing(null);
        setTimeout(() => setConflict(null), 3000);
      } else {
        updateBinding(capturing, newBinding);
        setCapturing(null);
        setConflict(null);
      }
    };

    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [capturing, bindings, updateBinding]);

  const renderSection = useCallback((context: ShortcutContext, label: string) => {
    const metas = SHORTCUT_METAS.filter(m => m.context === context);

    return (
      <div style={{ marginBottom: 24 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: "#e2e8f0",
          marginBottom: 12, paddingBottom: 8,
          borderBottom: "1px solid #1e2330",
        }}>
          {label}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {metas.map(meta => {
            const binding = bindings[meta.action];
            const isCapturing = capturing === meta.action;
            const hasConflict = conflict?.action === meta.action;

            return (
              <div
                key={meta.action}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "8px 12px", borderRadius: 6,
                  background: isCapturing ? "rgba(102,126,234,0.12)" : "transparent",
                  border: isCapturing ? "1px solid rgba(102,126,234,0.3)" : "1px solid transparent",
                  transition: "all 0.15s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "#cbd5e1" }}>{meta.label}</span>
                  <InfoIcon text={meta.description} />
                  {hasConflict && (
                    <span style={{ fontSize: 10, color: "#f59e0b" }}>
                      Conflicts with "{conflict.conflictWith}"
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {isCapturing ? (
                    <span style={{
                      fontSize: 11, color: "#667eea", fontStyle: "italic",
                      animation: "pulse 1.5s ease-in-out infinite",
                    }}>
                      Press new shortcut...
                    </span>
                  ) : (
                    <kbd style={{
                      padding: "3px 8px", borderRadius: 4,
                      background: "#161925", border: "1px solid #1e2330",
                      fontSize: 11, color: "#94a3b8", fontFamily: "inherit",
                      letterSpacing: "0.02em",
                    }}>
                      {formatBinding(binding, platform)}
                    </kbd>
                  )}
                  <button
                    onClick={() => {
                      if (isCapturing) {
                        setCapturing(null);
                      } else {
                        setCapturing(meta.action);
                        setConflict(null);
                      }
                    }}
                    style={{
                      padding: "4px 10px", borderRadius: 4, border: "none",
                      background: isCapturing ? "rgba(239,68,68,0.15)" : "rgba(102,126,234,0.1)",
                      color: isCapturing ? "#ef4444" : "#667eea",
                      fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                      fontWeight: 500,
                    }}
                  >
                    {isCapturing ? "Cancel" : "Rebind"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }, [bindings, platform, capturing, conflict, updateBinding]);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0" }}>Shortcuts</div>
        <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>
          Customize keyboard shortcuts. Profile: {platform === "macos" ? "macOS" : "Windows / Linux"}
        </div>
      </div>

      {renderSection("global", "Global")}
      {renderSection("terminal", "Terminal")}

      <div style={{ paddingTop: 8, borderTop: "1px solid #1e2330" }}>
        <button
          onClick={resetDefaults}
          style={{
            padding: "6px 14px", borderRadius: 6, border: "none",
            background: "rgba(239,68,68,0.1)", color: "#ef4444",
            fontSize: 11, cursor: "pointer", fontFamily: "inherit", fontWeight: 500,
          }}
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}

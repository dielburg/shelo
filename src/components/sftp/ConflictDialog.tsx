import { useRef, useEffect } from "react";
import { ConflictState } from "./types";
import { modalOverlay, modalBox, btnCancel, btnPrimary, inputStyle } from "./styles";

interface Props {
  conflict: ConflictState;
  onAction: (action: "overwrite" | "skip" | "rename" | "overwrite-all" | "skip-all") => void;
  onRenameConfirm: () => void;
  onConflictChange: (updater: (prev: ConflictState | null) => ConflictState | null) => void;
}

export default function ConflictDialog({ conflict, onAction, onRenameConfirm, onConflictChange }: Props) {
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (conflict.renaming) {
      setTimeout(() => renameRef.current?.focus(), 0);
    }
  }, [conflict.renaming]);

  return (
    <div style={modalOverlay}>
      <div onClick={e => e.stopPropagation()} style={{ ...modalBox, width: 360 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8, color: "#f59e0b" }}>
          {conflict.renaming ? "Rename file" : "File already exists"}
        </div>
        {conflict.renaming ? (
          <>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>
              Enter a new name for <span style={{ color: "#e2e8f0", fontWeight: 500 }}>{conflict.fileName}</span>:
            </div>
            <input
              ref={renameRef}
              value={conflict.renameValue || ""}
              onChange={e => onConflictChange(prev => prev ? { ...prev, renameValue: e.target.value } : null)}
              onKeyDown={e => {
                e.stopPropagation();
                if (e.key === "Enter") onRenameConfirm();
                if (e.key === "Escape") onConflictChange(prev => prev ? { ...prev, renaming: false, renameValue: undefined } : null);
              }}
              style={inputStyle}
            />
            <div style={{ display: "flex", gap: 6, marginTop: 12, justifyContent: "flex-end" }}>
              <button onClick={() => onConflictChange(prev => prev ? { ...prev, renaming: false, renameValue: undefined } : null)} style={{
                ...btnCancel, padding: "7px 14px",
              }}>Back</button>
              <button onClick={onRenameConfirm} style={{
                ...btnPrimary, padding: "7px 14px", background: "#a78bfa", color: "#000",
              }}>Confirm</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>
              <span style={{ color: "#e2e8f0", fontWeight: 500 }}>{conflict.fileName}</span> already exists in this directory.
            </div>
            {conflict.remaining.length > 1 && (
              <div style={{ fontSize: 11, color: "#4a5568", marginBottom: 12 }}>
                +{conflict.remaining.length - 1} more conflict{conflict.remaining.length - 1 > 1 ? "s" : ""}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => onAction("overwrite")} style={{
                  flex: 1, padding: "7px 10px", borderRadius: 6, border: "none",
                  background: "#f59e0b", color: "#000", fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}>Overwrite</button>
                <button onClick={() => onAction("skip")} style={{
                  flex: 1, padding: "7px 10px", borderRadius: 6, border: "1px solid #2a3050",
                  background: "transparent", color: "#94a3b8", fontSize: 12, cursor: "pointer",
                }}>Skip</button>
                <button onClick={() => onAction("rename")} style={{
                  flex: 1, padding: "7px 10px", borderRadius: 6, border: "1px solid #2a3050",
                  background: "transparent", color: "#a78bfa", fontSize: 12, cursor: "pointer",
                }}>Rename</button>
              </div>
              {conflict.remaining.length > 1 && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => onAction("overwrite-all")} style={{
                    flex: 1, padding: "7px 10px", borderRadius: 6, border: "1px solid #f59e0b",
                    background: "transparent", color: "#f59e0b", fontSize: 11, cursor: "pointer",
                  }}>Overwrite All</button>
                  <button onClick={() => onAction("skip-all")} style={{
                    flex: 1, padding: "7px 10px", borderRadius: 6, border: "1px solid #2a3050",
                    background: "transparent", color: "#64748b", fontSize: 11, cursor: "pointer",
                  }}>Skip All</button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

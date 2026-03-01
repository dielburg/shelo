import { useState, useRef, useCallback } from "react";
import { Tab } from "../types";
import { IconTerminal, IconWorkspace, IconHosts, IconSftp } from "./icons";

interface Props {
  tab: Tab;
  isActive: boolean;
  label: { name: string; isWs: boolean; kind: "terminal" | "ssh" | "sftp" };
  isDragSource: boolean;
  showIndicatorBefore: boolean;
  showIndicatorAfter: boolean;
  onMouseDown: (e: React.MouseEvent, tabId: number) => void;
  onClose: (e: React.MouseEvent, tabId: number) => void;
  onRename: (paneId: number, name: string) => void;
  itemRef: (el: HTMLDivElement | null) => void;
}

const indicator: React.CSSProperties = {
  height: 2,
  margin: "1px 8px",
  background: "#4ecdc4",
  borderRadius: 1,
  boxShadow: "0 0 6px #4ecdc488",
};

export default function TabItem({
  tab, isActive, label, isDragSource,
  showIndicatorBefore, showIndicatorAfter,
  onMouseDown, onClose, onRename, itemRef,
}: Props) {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditName(label.name);
    setEditing(true);
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 0);
  }, [label.name]);

  const commit = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed && tab.layout.type === "leaf") {
      onRename(tab.layout.paneId, trimmed);
    }
    setEditing(false);
  }, [editName, tab, onRename]);

  const cancel = useCallback(() => setEditing(false), []);

  return (
    <div>
      {showIndicatorBefore && <div style={indicator} />}

      <div
        ref={itemRef}
        onMouseDown={e => onMouseDown(e, tab.id)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onDoubleClick={startEdit}
      >
        <div style={{
          display: "flex", alignItems: "center", gap: 9,
          padding: "8px 8px", borderRadius: 9, marginBottom: 2,
          cursor: isDragSource ? "grabbing" : "grab",
          background: isActive ? "#151a28" : hovered ? "#0f1117" : "transparent",
          outline: isActive ? "1px solid #1e2a45" : "1px solid transparent",
          transition: isDragSource ? "none" : "all 0.1s",
          opacity: isDragSource ? 0.35 : 1,
        }}>
          <div style={{
            width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
            background: isActive ? "#4ecdc4" : "#2a3050",
            boxShadow: isActive ? "0 0 6px #4ecdc488" : "none",
          }} />

          {label.isWs
            ? <IconWorkspace color={isActive ? "#6b7280" : "#2a3050"} />
            : label.kind === "ssh"
              ? <IconHosts color={isActive ? "#667eea" : "#2a3050"} />
              : label.kind === "sftp"
                ? <IconSftp color={isActive ? "#f59e0b" : "#2a3050"} />
                : <IconTerminal color={isActive ? "#6b7280" : "#2a3050"} />
          }

          {editing ? (
            <input
              ref={inputRef}
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onBlur={commit}
              onKeyDown={e => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") cancel();
              }}
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
              style={{
                flex: 1, minWidth: 0, background: "#1e2a45", border: "1px solid #3a4560",
                borderRadius: 4, color: "#f1f5f9", fontSize: 12, fontFamily: "inherit",
                padding: "1px 5px", outline: "none",
              }}
            />
          ) : (
            <span style={{
              fontSize: 12, fontWeight: isActive ? 500 : 400,
              color: isActive ? "#f1f5f9" : "#6b7280",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
            }}>{label.name}</span>
          )}

          <button
            onClick={e => onClose(e, tab.id)}
            style={{
              background: "none", border: "none", color: "#3a4560", cursor: "pointer",
              fontSize: 15, padding: 0, lineHeight: 1, flexShrink: 0,
              opacity: hovered || isActive ? 1 : 0, transition: "opacity 0.1s",
            }}
          >×</button>
        </div>
      </div>

      {showIndicatorAfter && <div style={indicator} />}
    </div>
  );
}
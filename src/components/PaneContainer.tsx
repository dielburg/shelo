import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Pane, DropZone } from "../types";
import { Bounds } from "../layoutTree";
import { KeyBinding } from "../lib/shortcuts";
import { IconSplitH, IconSplitV, IconSftp } from "./icons";
import DropOverlay from "./DropOverlay";
import TerminalPane from "./TerminalPane";
import FileBrowser from "./sftp/FileBrowser";

const DEFAULT_FONT_SIZE = 13;
const MIN_ZOOM = 50;
const MAX_ZOOM = 200;
const ZOOM_STEP = 10;

interface Props {
  pane: Pane;
  bounds: Bounds | undefined;
  isVisible: boolean;
  isFocused: boolean;
  showFocusOutline: boolean;
  isDragSource: boolean;
  dropZone: DropZone | null;
  blockPointer: boolean;
  canDrag: boolean;
  onFocus: () => void;
  onHeaderMouseDown: (e: React.MouseEvent, paneId: number) => void;
  onSplit: (paneId: number, dir: "horizontal" | "vertical") => void;
  onClose: (paneId: number) => void;
  onOpenSftp?: (paneId: number) => void;
  paneRef: (el: HTMLDivElement | null) => void;
  terminalBindings?: { copy: KeyBinding; paste: KeyBinding; selectAll: KeyBinding };
}

const btnStyle: React.CSSProperties = {
  background: "none", border: "none", color: "#3a4560",
  cursor: "pointer", padding: "2px 3px", lineHeight: 1,
  fontSize: 14, display: "flex", alignItems: "center", flexShrink: 0,
};

export default function PaneContainer({
  pane, bounds, isVisible, isFocused, showFocusOutline, isDragSource,
  dropZone, blockPointer, canDrag, onFocus, onHeaderMouseDown, onSplit, onClose, onOpenSftp, paneRef, terminalBindings,
}: Props) {
  const [zoom, setZoom] = useState(100);
  const [defaultFontSize, setDefaultFontSize] = useState(DEFAULT_FONT_SIZE);
  const [editingZoom, setEditingZoom] = useState(false);
  const [editValue, setEditValue] = useState("");
  const zoomInputRef = useRef<HTMLInputElement>(null);
  const settingsLoadedRef = useRef(false);

  useEffect(() => {
    if (settingsLoadedRef.current) return;
    settingsLoadedRef.current = true;
    invoke("get_settings").then((s: unknown) => {
      const settings = s as Record<string, unknown>;
      if (typeof settings.defaultTerminalFontSize === "number") {
        setDefaultFontSize(settings.defaultTerminalFontSize);
      }
    }).catch(() => {});
  }, []);

  const handleZoomChange = useCallback((newZoom: number) => {
    setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom)));
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoom(z => Math.min(MAX_ZOOM, z + ZOOM_STEP));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(z => Math.max(MIN_ZOOM, z - ZOOM_STEP));
  }, []);

  const handleZoomReset = useCallback(() => {
    setZoom(100);
  }, []);

  const startEditZoom = useCallback(() => {
    setEditValue(String(zoom));
    setEditingZoom(true);
    requestAnimationFrame(() => zoomInputRef.current?.select());
  }, [zoom]);

  const commitEditZoom = useCallback(() => {
    const num = parseInt(editValue);
    if (!isNaN(num)) {
      setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(num / ZOOM_STEP) * ZOOM_STEP)));
    }
    setEditingZoom(false);
  }, [editValue]);

  const fontSize = Math.round(defaultFontSize * zoom / 100);
  const isTerminal = pane.kind !== "sftp";

  return (
    <div
      ref={paneRef}
      onMouseDown={isVisible ? onFocus : undefined}
      style={{
        position: "absolute",
        display: isVisible ? "flex" : "none",
        left: bounds ? `${bounds.x * 100}%` : 0,
        top: bounds ? `${bounds.y * 100}%` : 0,
        width: bounds ? `${bounds.w * 100}%` : "100%",
        height: bounds ? `${bounds.h * 100}%` : "100%",
        flexDirection: "column",
        overflow: "hidden",
        outline: showFocusOutline ? "1px solid #1e3a4a" : "none",
        opacity: isDragSource ? 0.4 : 1,
        transition: isDragSource ? "none" : "opacity 0.15s",
      }}
    >
      <div
        onMouseDown={e => onHeaderMouseDown(e, pane.id)}
        style={{
          height: 28, display: "flex", alignItems: "center", gap: 6,
          padding: "0 8px", background: "#080a0f",
          borderBottom: "1px solid #161925", flexShrink: 0,
          fontSize: 11, color: "#4a5568",
          cursor: canDrag ? "grab" : "default",
          userSelect: "none", WebkitUserSelect: "none",
        }}
      >
        <div style={{
          width: 6, height: 6, borderRadius: "50%",
          background: isFocused ? "#4ecdc4" : "#2a3050",
          boxShadow: isFocused ? "0 0 5px #4ecdc488" : "none",
        }} />
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {pane.name}
        </span>

        {isTerminal && (
          <div
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}
          >
            <button onClick={handleZoomOut} title="Zoom Out" style={btnStyle}>
              <svg width="10" height="10" viewBox="0 0 10 10"><line x1="2" y1="5" x2="8" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
            {editingZoom ? (
              <input
                ref={zoomInputRef}
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onBlur={commitEditZoom}
                onKeyDown={e => { if (e.key === "Enter") commitEditZoom(); if (e.key === "Escape") setEditingZoom(false); }}
                style={{
                  width: 36, height: 16, fontSize: 9, fontFamily: "inherit",
                  background: "#161925", border: "1px solid #2a3050", borderRadius: 3,
                  color: "#e2e8f0", textAlign: "center", outline: "none",
                  padding: 0,
                }}
              />
            ) : (
              <span
                onClick={startEditZoom}
                title="Click to edit zoom"
                style={{
                  fontSize: 9, color: zoom !== 100 ? "#667eea" : "#4a5568",
                  cursor: "pointer", minWidth: 30, textAlign: "center",
                  fontWeight: zoom !== 100 ? 600 : 400,
                }}
              >
                {zoom}%
              </span>
            )}
            <button onClick={handleZoomIn} title="Zoom In" style={btnStyle}>
              <svg width="10" height="10" viewBox="0 0 10 10"><line x1="2" y1="5" x2="8" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><line x1="5" y1="2" x2="5" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </div>
        )}

        {pane.kind !== "sftp" && onOpenSftp && (
          <button onClick={e => { e.stopPropagation(); onOpenSftp(pane.id); }} title="Open SFTP" style={btnStyle}>
            <IconSftp color="#4a5568" />
          </button>
        )}
        <button onClick={e => { e.stopPropagation(); onSplit(pane.id, "horizontal"); }} title="Split Right" style={btnStyle}>
          <IconSplitH />
        </button>
        <button onClick={e => { e.stopPropagation(); onSplit(pane.id, "vertical"); }} title="Split Down" style={btnStyle}>
          <IconSplitV />
        </button>
        <button onClick={e => { e.stopPropagation(); onClose(pane.id); }} title="Close Pane" style={btnStyle}>
          ×
        </button>
      </div>

      <div style={{ flex: 1, overflow: "hidden", pointerEvents: blockPointer ? "none" : "auto", position: "relative" }}>
        {pane.kind === "sftp"
          ? <FileBrowser pane={pane} />
          : <TerminalPane
              sessionId={pane.sessionId} isFocused={isFocused} isVisible={isVisible}
              kind={pane.kind} hostId={pane.hostId} onClose={() => onClose(pane.id)}
              terminalBindings={terminalBindings}
              fontSize={fontSize}
              onZoomIn={handleZoomIn}
              onZoomOut={handleZoomOut}
              onZoomReset={handleZoomReset}
              onZoomChange={handleZoomChange}
              zoom={zoom}
            />
        }
        <DropOverlay zone={dropZone} />
      </div>
    </div>
  );
}
import { Pane, DropZone } from "../types";
import { Bounds } from "../layoutTree";
import { IconSplitH, IconSplitV, IconSftp } from "./icons";
import DropOverlay from "./DropOverlay";
import TerminalPane from "./TerminalPane";
import FileBrowser from "./sftp/FileBrowser";

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
}

const btnStyle: React.CSSProperties = {
  background: "none", border: "none", color: "#3a4560",
  cursor: "pointer", padding: "2px 3px", lineHeight: 1,
  fontSize: 14, display: "flex", alignItems: "center", flexShrink: 0,
};

export default function PaneContainer({
  pane, bounds, isVisible, isFocused, showFocusOutline, isDragSource,
  dropZone, blockPointer, canDrag, onFocus, onHeaderMouseDown, onSplit, onClose, onOpenSftp, paneRef,
}: Props) {
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
          : <TerminalPane sessionId={pane.sessionId} isFocused={isFocused} kind={pane.kind} hostId={pane.hostId} onClose={() => onClose(pane.id)} />
        }
        <DropOverlay zone={dropZone} />
      </div>
    </div>
  );
}
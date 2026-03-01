import { FileEntry } from "./types";
import { ctxItemStyle } from "./styles";
import { getClipboard } from "./clipboard";

interface Props {
  x: number;
  y: number;
  entry: FileEntry | null;
  isRemote: boolean;
  selectedPaths: Set<string>;
  entries: FileEntry[];
  onNavigate: (path: string) => void;
  onDownload: (entry: FileEntry) => void;
  onCopy: (files: FileEntry[]) => void;
  onCut: (files: FileEntry[]) => void;
  onPaste: () => void;
  onRename: (entry: FileEntry) => void;
  onDelete: (targets: FileEntry[]) => void;
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onRefresh: () => void;
  onPermissions: (entry: FileEntry) => void;
  canChmod: boolean;
  onClose: () => void;
}

export default function ContextMenu({
  x, y, entry, isRemote, selectedPaths, entries,
  onNavigate, onDownload, onCopy, onCut, onPaste, onRename, onDelete,
  onCreateFile, onCreateFolder, onRefresh, onPermissions, canChmod, onClose,
}: Props) {
  const clipboard = getClipboard();
  const separator = <div style={{ height: 1, background: "#2a3050", margin: "4px 0" }} />;

  const getTargets = (): FileEntry[] => {
    if (entry && selectedPaths.has(entry.path) && selectedPaths.size > 1) {
      return entries.filter(e => selectedPaths.has(e.path));
    }
    return entry ? [entry] : [];
  };

  const multiLabel = entry && selectedPaths.has(entry.path) && selectedPaths.size > 1
    ? ` (${selectedPaths.size})` : "";

  return (
    <div style={{
      position: "fixed", left: x, top: y,
      background: "#1a1f2e", border: "1px solid #2a3050", borderRadius: 6,
      padding: "4px 0", zIndex: 9999, minWidth: 160, boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
    }}>
      {entry ? (<>
        {entry.is_dir && (
          <div onClick={() => { onNavigate(entry.path); onClose(); }}
               style={ctxItemStyle}>Open</div>
        )}
        {isRemote && (
          <div onClick={() => { onDownload(entry); onClose(); }}
               style={{ ...ctxItemStyle, color: "#667eea" }}>Download</div>
        )}
        {separator}
        <div onClick={() => { onCopy(getTargets()); onClose(); }} style={ctxItemStyle}>
          Copy{multiLabel}
        </div>
        <div onClick={() => { onCut(getTargets()); onClose(); }} style={ctxItemStyle}>
          Cut{multiLabel}
        </div>
        {clipboard && clipboard.files.length > 0 && (
          <div onClick={() => { onPaste(); onClose(); }}
               style={{ ...ctxItemStyle, color: "#a78bfa" }}>
            Paste ({clipboard.files.length})
          </div>
        )}
        {separator}
        <div onClick={() => { onRename(entry); onClose(); }}
             style={ctxItemStyle}>Rename</div>
        <div onClick={() => { onDelete(getTargets()); onClose(); }}
             style={{ ...ctxItemStyle, color: "#ef4444" }}>
          {selectedPaths.has(entry.path) && selectedPaths.size > 1
            ? `Delete (${selectedPaths.size})`
            : "Delete"}
        </div>
        {separator}
        <div onClick={() => { navigator.clipboard.writeText(entry.path); onClose(); }}
             style={ctxItemStyle}>Copy Path</div>
        {entry.permissions !== null && canChmod && (
          <div onClick={() => { onPermissions(entry); onClose(); }}
               style={ctxItemStyle}>Permissions</div>
        )}
      </>) : (<>
        <div onClick={() => { onCreateFile(); onClose(); }}
             style={ctxItemStyle}>New File</div>
        <div onClick={() => { onCreateFolder(); onClose(); }}
             style={ctxItemStyle}>New Folder</div>
        {clipboard && clipboard.files.length > 0 && (<>
          {separator}
          <div onClick={() => { onPaste(); onClose(); }}
               style={{ ...ctxItemStyle, color: "#a78bfa" }}>
            Paste ({clipboard.files.length} {clipboard.mode === "cut" ? "· move" : ""})
          </div>
        </>)}
        {separator}
        <div onClick={() => { onRefresh(); onClose(); }}
             style={ctxItemStyle}>Refresh</div>
      </>)}
    </div>
  );
}

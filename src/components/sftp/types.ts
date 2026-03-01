export interface TransferProgress {
  transfer_id: string;
  file_name: string;
  bytes_transferred: number;
  total_bytes: number;
  files_done: number;
  files_total: number;
  speed_bps: number;
  status: string;
}

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_symlink: boolean;
  symlink_target: string | null;
  size: number;
  modified: number | null;
  permissions: number | null;
}

export interface DragPayload {
  sourcePaneId: number;
  sourceType: "local" | "remote";
  sshSessionId: number | null;
  files: { path: string; name: string; is_dir: boolean }[];
  isMove?: boolean;
}

export interface PanelRegistration {
  containerRef: React.RefObject<HTMLDivElement | null>;
  handleDrop: (payload: DragPayload) => Promise<void>;
  handleSystemDrop: (paths: string[]) => Promise<void>;
  setOverlay: (v: boolean) => void;
  setSystemDragOver: (v: boolean) => void;
}

export interface ClipboardData {
  mode: "copy" | "cut";
  sourceType: "local" | "remote";
  sshSessionId: number | null;
  files: { path: string; name: string; is_dir: boolean }[];
}

export type SortKey = "name" | "size" | "modified";
export type SortDir = "asc" | "desc";

export interface ConflictState {
  fileName: string;
  remaining: { path: string; name: string; is_dir: boolean }[];
  resolved: { path: string; name: string; is_dir: boolean }[];
  onDone: (files: { path: string; name: string; is_dir: boolean }[]) => void;
  renaming?: boolean;
  renameValue?: string;
}

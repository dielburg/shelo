import { invoke } from "@tauri-apps/api/core";
import { TransferProgress } from "./types";
import { formatSize } from "./utils";

interface Props {
  transfer: TransferProgress;
}

export default function TransferBar({ transfer }: Props) {
  if (transfer.status === "done") {
    return (
      <div style={{
        padding: "4px 12px", borderTop: "1px solid #161925", background: "#0e1220",
        fontSize: 11, color: "#4ecdc4", flexShrink: 0,
      }}>
        Transfer complete: {transfer.files_total} file{transfer.files_total > 1 ? "s" : ""}
      </div>
    );
  }

  if (transfer.status === "cancelled") {
    return (
      <div style={{
        padding: "4px 12px", borderTop: "1px solid #161925", background: "#0e1220",
        fontSize: 11, color: "#f59e0b", flexShrink: 0,
      }}>
        Transfer cancelled
      </div>
    );
  }

  return (
    <div style={{
      padding: "6px 12px", borderTop: "1px solid #161925", background: "#0e1220",
      fontSize: 11, flexShrink: 0,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, color: "#94a3b8" }}>
        <span>
          {transfer.status === "uploading" ? "Uploading"
            : transfer.status === "downloading" ? "Downloading"
            : transfer.status === "reading" ? "Reading from source"
            : transfer.status === "writing" ? "Writing to destination"
            : transfer.status === "transferring" ? "Transferring"
            : transfer.status === "copying" ? "Copying"
            : transfer.status}: {transfer.file_name}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>
            {transfer.files_total > 1 && `${transfer.files_done + 1}/${transfer.files_total} files · `}
            {formatSize(transfer.bytes_transferred)} / {formatSize(transfer.total_bytes)}
            {transfer.speed_bps > 0 && ` · ${formatSize(transfer.speed_bps)}/s`}
          </span>
          <button
            onClick={() => invoke("sftp_cancel_transfer", { transferId: transfer.transfer_id })}
            style={{
              background: "none", border: "1px solid #ef4444", borderRadius: 3,
              color: "#ef4444", fontSize: 10, padding: "1px 6px", cursor: "pointer",
              lineHeight: "14px",
            }}
          >✕</button>
        </span>
      </div>
      <div style={{ height: 3, background: "#1e2330", borderRadius: 2, overflow: "hidden" }}>
        <div style={{
          height: "100%", borderRadius: 2,
          background: transfer.status === "uploading" ? "#667eea"
            : transfer.status === "reading" ? "#f59e0b"
            : transfer.status === "writing" ? "#a78bfa"
            : transfer.status === "transferring" ? "#f59e0b"
            : transfer.status === "copying" ? "#a78bfa"
            : "#4ecdc4",
          width: transfer.total_bytes > 0 ? `${(transfer.bytes_transferred / transfer.total_bytes) * 100}%` : "0%",
          transition: "width 0.2s",
        }} />
      </div>
    </div>
  );
}

import { modalOverlay, modalBox, btnCancel, btnPrimary } from "./styles";

interface Props {
  name: string;
  permValue: string;
  onPermValueChange: (v: string) => void;
  onApply: () => void;
  onClose: () => void;
}

export default function PermissionsDialog({ name, permValue, onPermValueChange, onApply, onClose }: Props) {
  return (
    <div style={modalOverlay} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ ...modalBox, width: 340 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8, color: "#e2e8f0" }}>
          Permissions
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12, wordBreak: "break-all" }}>
          {name}
        </div>
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          {(["Owner", "Group", "Others"] as const).map((label, gi) => {
            const octal = parseInt(permValue, 8) || 0;
            const shift = (2 - gi) * 3;
            const bits = (octal >> shift) & 7;
            return (
              <div key={label} style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6, textAlign: "center" }}>{label}</div>
                {(["Read", "Write", "Exec"] as const).map((perm, pi) => {
                  const bit = 1 << (2 - pi);
                  const checked = !!(bits & bit);
                  return (
                    <label key={perm} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#cbd5e1", marginBottom: 4, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const newBits = checked ? bits & ~bit : bits | bit;
                          const newOctal = (octal & ~(7 << shift)) | (newBits << shift);
                          onPermValueChange(newOctal.toString(8).padStart(3, "0"));
                        }}
                        style={{ accentColor: "#4ecdc4" }}
                      />
                      {perm}
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Octal</div>
          <input
            value={permValue}
            onChange={e => {
              const v = e.target.value.replace(/[^0-7]/g, "").slice(0, 3);
              onPermValueChange(v);
            }}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === "Enter") onApply();
              if (e.key === "Escape") onClose();
            }}
            maxLength={3}
            style={{
              width: 80, padding: "6px 10px", borderRadius: 7,
              border: "1px solid #2a3050", background: "#0e1018", color: "#f1f5f9",
              fontSize: 14, fontFamily: "monospace", outline: "none", textAlign: "center",
            }}
          />
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={btnCancel}>Cancel</button>
          <button onClick={onApply} style={{ ...btnPrimary, background: "#4ecdc4", color: "#0b0d12" }}>Apply</button>
        </div>
      </div>
    </div>
  );
}

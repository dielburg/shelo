import React from "react";

export const headerStyle: React.CSSProperties = {
  padding: "8px 12px",
  display: "flex",
  alignItems: "center",
  gap: 8,
  borderBottom: "1px solid #161925",
  background: "#0a0c11",
  flexShrink: 0,
};

export const breadcrumbBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#94a3b8",
  cursor: "pointer",
  padding: "2px 4px",
  fontSize: 12,
  borderRadius: 3,
};

export const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "6px 12px",
  fontSize: 12,
  cursor: "pointer",
  gap: 8,
  borderBottom: "1px solid #0e1018",
};

export const colName: React.CSSProperties = { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
export const colSize: React.CSSProperties = { width: 80, textAlign: "right", color: "#64748b", fontSize: 11, flexShrink: 0 };
export const colDate: React.CSSProperties = { width: 130, textAlign: "right", color: "#64748b", fontSize: 11, flexShrink: 0 };
export const colPerm: React.CSSProperties = { width: 80, textAlign: "right", color: "#4a5568", fontSize: 11, fontFamily: "monospace", flexShrink: 0 };

export const ctxItemStyle: React.CSSProperties = {
  padding: "6px 14px",
  fontSize: 12,
  cursor: "pointer",
  color: "#e2e8f0",
};

export const modalOverlay: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0,0,0,0.6)",
  zIndex: 9999,
};

export const modalBox: React.CSSProperties = {
  background: "#1a1f2e",
  border: "1px solid #2a3050",
  borderRadius: 10,
  padding: 20,
  boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
};

export const btnCancel: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 6,
  border: "1px solid #2a3050",
  background: "transparent",
  color: "#94a3b8",
  fontSize: 12,
  cursor: "pointer",
};

export const btnPrimary: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 6,
  border: "none",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

export const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 7,
  border: "1px solid #2a3050",
  background: "#0e1018",
  color: "#f1f5f9",
  fontSize: 12,
  outline: "none",
  boxSizing: "border-box",
};

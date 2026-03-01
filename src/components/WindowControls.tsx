import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";

export default function WindowControls() {
  const [platform, setPlatform] = useState<string>("");
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    invoke<string>("get_platform").then(setPlatform).catch(() => {});
  }, []);

  if (platform === "macos" || platform === "") return null;

  const appWindow = getCurrentWindow();

  const btnBase: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 46, height: 36, border: "none", background: "transparent",
    color: "#8892a4", cursor: "pointer", padding: 0,
    transition: "background 0.1s",
  };

  return (
    <div style={{ display: "flex", marginLeft: "auto", flexShrink: 0, position: "relative", zIndex: 1 }}>
      <button
        style={{ ...btnBase, background: hovered === "min" ? "rgba(255,255,255,0.08)" : "transparent" }}
        onMouseEnter={() => setHovered("min")}
        onMouseLeave={() => setHovered(null)}
        onClick={() => appWindow.minimize()}
      >
        <svg width="10" height="1" viewBox="0 0 10 1"><rect fill="currentColor" width="10" height="1" /></svg>
      </button>
      <button
        style={{ ...btnBase, background: hovered === "max" ? "rgba(255,255,255,0.08)" : "transparent" }}
        onMouseEnter={() => setHovered("max")}
        onMouseLeave={() => setHovered(null)}
        onClick={() => appWindow.toggleMaximize()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
          <rect x="0.5" y="0.5" width="9" height="9" />
        </svg>
      </button>
      <button
        style={{
          ...btnBase,
          background: hovered === "close" ? "#e81123" : "transparent",
          color: hovered === "close" ? "#fff" : "#8892a4",
        }}
        onMouseEnter={() => setHovered("close")}
        onMouseLeave={() => setHovered(null)}
        onClick={() => appWindow.close()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2">
          <line x1="0" y1="0" x2="10" y2="10" /><line x1="10" y1="0" x2="0" y2="10" />
        </svg>
      </button>
    </div>
  );
}

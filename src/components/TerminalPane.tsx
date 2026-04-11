import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { KeyBinding, matchesBinding } from "../lib/shortcuts";
import ConnectionScreen, { ConnectionStage } from "./ConnectionScreen";
import "@xterm/xterm/css/xterm.css";

interface Props {
  sessionId: number;
  isFocused: boolean;
  isVisible: boolean;
  kind: "terminal" | "ssh";
  hostId?: number;
  onClose?: () => void;
  terminalBindings?: { copy: KeyBinding; paste: KeyBinding; selectAll: KeyBinding };
}

interface PtyOutput {
  session_id: number;
  data: string;
}

interface SshStatusEvent {
  session_id: number;
  stage: string;
  message: string;
  fingerprint?: string;
  expected_fingerprint?: string;
  hop_current?: number;
  hop_total?: number;
  hop_label?: string;
}

export default function TerminalPane({ sessionId, isFocused, isVisible, kind, hostId, onClose, terminalBindings }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [sshConnected, setSshConnected] = useState(kind !== "ssh");
  const [sshDisconnected, setSshDisconnected] = useState(false);
  const [sshStages, setSshStages] = useState<ConnectionStage[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 1500);
  }, []);

  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  const bindingsRef = useRef(terminalBindings);
  bindingsRef.current = terminalBindings;

  const handleCtxCopy = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    const sel = term.getSelection();
    if (sel) {
      navigator.clipboard.writeText(sel).catch(console.error);
      showToast("Copied");
    }
    setCtxMenu(null);
  }, [showToast]);

  const handleCtxPaste = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    readText().then(text => {
      if (text) {
        term.paste(text);
        showToast("Pasted");
      }
    }).catch(console.error);
    setCtxMenu(null);
  }, [showToast]);

  const handleCtxSelectAll = useCallback(() => {
    const term = termRef.current;
    if (term) term.selectAll();
    setCtxMenu(null);
  }, []);

  const startConnection = useCallback(() => {
    setSshStages([]);
    setSshConnected(false);
    setSshDisconnected(false);

    const term = termRef.current;
    if (!term) return;

    const fitAddon = fitAddonRef.current;
    try { fitAddon?.fit(); } catch {}

    const createArgs: Record<string, unknown> = {
      sessionId,
      rows: term.rows,
      cols: term.cols,
    };
    if (hostId != null) {
      createArgs.hostId = hostId;
    }

    invoke("create_ssh_session", createArgs).catch((err) => {
      setSshStages(prev => [...prev, { stage: "error", message: String(err) }]);
    });
  }, [sessionId, hostId]);

  const handleReconnect = useCallback(() => {
    const term = termRef.current;
    if (term) {
      term.clear();
    }
    startConnection();
  }, [startConnection]);

  const handleClose = useCallback(() => {
    invoke("close_ssh_session", { sessionId }).catch(console.error);
    onClose?.();
  }, [sessionId, onClose]);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: {
        background: "#0b0d12",
        foreground: "#e2e8f0",
        cursor: "#e2e8f0",
        selectionBackground: "#3a4560",
        black: "#1a1d27",
        brightBlack: "#3a4560",
        red: "#ff6b6b",
        brightRed: "#ff8e8e",
        green: "#4ecdc4",
        brightGreen: "#6eddd6",
        yellow: "#ffd93d",
        brightYellow: "#ffe066",
        blue: "#667eea",
        brightBlue: "#8b9df0",
        magenta: "#764ba2",
        brightMagenta: "#9b6fc4",
        cyan: "#4ecdc4",
        brightCyan: "#6eddd6",
        white: "#e2e8f0",
        brightWhite: "#f8fafc",
      },
      fontFamily: "'JetBrainsMono Nerd Font', 'JetBrains Mono', monospace",
      fontWeight: 400,
      fontWeightBold: 700,
      fontSize: 13,
      lineHeight: 1.5,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    const writeCmd = kind === "ssh" ? "write_to_ssh" : "write_to_pty";
    const resizeCmd = kind === "ssh" ? "resize_ssh" : "resize_pty";
    const closeCmd = kind === "ssh" ? "close_ssh_session" : "close_pty_session";

    let initTimer: ReturnType<typeof setTimeout> | null = null;

    if (kind === "ssh") {
      initTimer = setTimeout(() => {
        startConnection();
      }, 150);
    } else {
      initTimer = setTimeout(() => {
        try { fitAddon.fit(); } catch {}
        invoke("create_pty_session", {
          sessionId,
          rows: term.rows,
          cols: term.cols,
        }).catch((err) => {
          term.write(`\r\n\x1b[31mFailed to create session: ${err}\x1b[0m\r\n`);
        });
      }, 150);
    }

    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== "keydown") return true;
      const b = bindingsRef.current;
      if (!b) return true;

      if (matchesBinding(e, b.copy)) {
        e.preventDefault();
        const sel = term.getSelection();
        if (sel) {
          navigator.clipboard.writeText(sel).catch(console.error);
          showToastRef.current("Copied");
        }
        return false;
      }
      if (matchesBinding(e, b.paste)) {
        e.preventDefault();
        readText().then(text => {
          if (text) {
            term.paste(text);
            showToastRef.current("Pasted");
          }
        }).catch(console.error);
        return false;
      }
      if (matchesBinding(e, b.selectAll)) {
        e.preventDefault();
        term.selectAll();
        return false;
      }
      return true;
    });

    term.onData((data) => {
      invoke(writeCmd, { sessionId, data }).catch(console.error);
    });

    const unlistenOutput = listen<PtyOutput>("pty-output", (event) => {
      if (event.payload.session_id === sessionId) {
        term.write(event.payload.data);
      }
    });

    const unlistenSshStatus = kind === "ssh"
      ? listen<SshStatusEvent>("ssh-status", (event) => {
          if (event.payload.session_id === sessionId) {
            const stage: ConnectionStage = {
              stage: event.payload.stage,
              message: event.payload.message,
              fingerprint: event.payload.fingerprint,
              expected_fingerprint: event.payload.expected_fingerprint,
              hop_current: event.payload.hop_current,
              hop_total: event.payload.hop_total,
              hop_label: event.payload.hop_label,
            };
            setSshStages(prev => [...prev, stage]);

            if (event.payload.stage === "connected") {
              setSshConnected(true);
              setSshDisconnected(false);
              requestAnimationFrame(() => {
                try { fitAddon.fit(); } catch {}
                term.focus();
              });
            } else if (event.payload.stage === "disconnected") {
              setSshDisconnected(true);
            }
          }
        })
      : null;

    const ro = new ResizeObserver(() => {
      if (!fitAddonRef.current || !termRef.current) return;
      if (!containerRef.current || containerRef.current.offsetParent === null) return;
      try {
        fitAddonRef.current.fit();
        invoke(resizeCmd, {
          sessionId,
          rows: termRef.current.rows,
          cols: termRef.current.cols,
        }).catch(console.error);
      } catch {}
    });
    ro.observe(containerRef.current);

    return () => {
      if (initTimer) clearTimeout(initTimer);
      unlistenOutput.then(fn => fn());
      unlistenSshStatus?.then(fn => fn());
      ro.disconnect();
      invoke(closeCmd, { sessionId }).catch(console.error);
      term.dispose();
    };
  }, [sessionId, kind, hostId, startConnection]);

  useEffect(() => {
    if (isFocused && fitAddonRef.current && termRef.current) {
      const resizeCmd = kind === "ssh" ? "resize_ssh" : "resize_pty";
      requestAnimationFrame(() => {
        try { fitAddonRef.current?.fit(); } catch {}
        invoke(resizeCmd, {
          sessionId,
          rows: termRef.current?.rows,
          cols: termRef.current?.cols,
        }).catch(console.error);
        termRef.current?.focus();
      });
    }
  }, [isFocused, sessionId, kind]);

  useEffect(() => {
    if (isVisible && fitAddonRef.current && termRef.current) {
      const resizeCmd = kind === "ssh" ? "resize_ssh" : "resize_pty";
      requestAnimationFrame(() => {
        try { fitAddonRef.current?.fit(); } catch {}
        invoke(resizeCmd, {
          sessionId,
          rows: termRef.current?.rows,
          cols: termRef.current?.cols,
        }).catch(console.error);
      });
    }
  }, [isVisible, sessionId, kind]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* Terminal is always mounted but hidden during SSH connection */}
      <div
        ref={containerRef}
        onContextMenu={(e) => {
          e.preventDefault();
          setCtxMenu({ x: e.clientX, y: e.clientY });
        }}
        style={{
          width: "100%",
          height: "100%",
          padding: "4px",
          boxSizing: "border-box",
          visibility: sshConnected ? "visible" : (kind === "ssh" ? "hidden" : "visible"),
          position: sshConnected ? "relative" : (kind === "ssh" ? "absolute" : "relative"),
        }}
      />
      {ctxMenu && (<>
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9998 }}
          onClick={() => setCtxMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}
        />
        <div style={{
          position: "fixed", left: ctxMenu.x, top: ctxMenu.y,
          background: "#1a1f2e", border: "1px solid #2a3050", borderRadius: 6,
          padding: "4px 0", zIndex: 9999, minWidth: 160,
          boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
        }}>
          <div
            onClick={handleCtxCopy}
            onMouseEnter={e => (e.currentTarget.style.background = "#2a3050")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            style={{ padding: "6px 14px", fontSize: 12, cursor: "pointer", color: "#e2e8f0" }}
          >Copy</div>
          <div
            onClick={handleCtxPaste}
            onMouseEnter={e => (e.currentTarget.style.background = "#2a3050")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            style={{ padding: "6px 14px", fontSize: 12, cursor: "pointer", color: "#e2e8f0" }}
          >Paste</div>
          <div style={{ height: 1, background: "#2a3050", margin: "4px 0" }} />
          <div
            onClick={handleCtxSelectAll}
            onMouseEnter={e => (e.currentTarget.style.background = "#2a3050")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            style={{ padding: "6px 14px", fontSize: 12, cursor: "pointer", color: "#e2e8f0" }}
          >Select All</div>
        </div>
      </>)}
      {toast && (
        <div style={{
          position: "absolute", bottom: 12, right: 12,
          background: "rgba(30, 35, 48, 0.9)", color: "#e2e8f0",
          fontSize: 11, padding: "4px 10px", borderRadius: 4,
          pointerEvents: "none", zIndex: 10,
          animation: "toast-fade 1.5s ease-in-out",
        }}>{toast}</div>
      )}
      {kind === "ssh" && (!sshConnected || sshDisconnected) && (
        <div style={{ position: "absolute", inset: 0, background: sshDisconnected ? "rgba(11, 13, 18, 0.85)" : undefined }}>
          <ConnectionScreen
            sessionId={sessionId}
            stages={sshDisconnected ? sshStages.filter(s => s.stage === "disconnected") : sshStages}
            onClose={handleClose}
            onReconnect={handleReconnect}
          />
        </div>
      )}
    </div>
  );
}

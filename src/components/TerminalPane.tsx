import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import ConnectionScreen, { ConnectionStage } from "./ConnectionScreen";
import "@xterm/xterm/css/xterm.css";

interface Props {
  sessionId: number;
  isFocused: boolean;
  kind: "terminal" | "ssh";
  hostId?: number;
  onClose?: () => void;
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

export default function TerminalPane({ sessionId, isFocused, kind, hostId, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [sshConnected, setSshConnected] = useState(kind !== "ssh");
  const [sshDisconnected, setSshDisconnected] = useState(false);
  const [sshStages, setSshStages] = useState<ConnectionStage[]>([]);

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

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* Terminal is always mounted but hidden during SSH connection */}
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          padding: "4px",
          boxSizing: "border-box",
          visibility: sshConnected ? "visible" : (kind === "ssh" ? "hidden" : "visible"),
          position: sshConnected ? "relative" : (kind === "ssh" ? "absolute" : "relative"),
        }}
      />
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

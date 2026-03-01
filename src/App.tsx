import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useWorkspace, genPaneId, genTabId } from "./hooks/useWorkspace";
import { useTabDrag } from "./hooks/useTabDrag";
import { usePaneDrag } from "./hooks/usePaneDrag";
import { useSeparatorDrag } from "./hooks/useSeparatorDrag";
import Sidebar, { View } from "./components/Sidebar";
import WorkspacePanel from "./components/WorkspacePanel";
import HostsPanel, { Host } from "./components/HostsPanel";
import VaultSetup from "./components/VaultSetup";
import VaultUnlock from "./components/VaultUnlock";
import SettingsPanel from "./components/SettingsPanel";
import { UpdateInfo, startAutoCheck, stopAutoCheck } from "./lib/updater";

type AppState = "loading" | "first_run" | "locked" | "unlocked";

export default function App() {
  const [appState, setAppState] = useState<AppState>("loading");

  const mainPanelRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const paneRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const tabItemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const [activeView, setActiveView] = useState<View>("terminals");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  const workspace = useWorkspace();
  const tabDrag = useTabDrag(workspace, { mainPanelRef, paneRefs, tabItemRefs });
  const paneDrag = usePaneDrag(workspace, { mainPanelRef, sidebarRef, paneRefs, tabItemRefs });
  const sepDrag = useSeparatorDrag(workspace, mainPanelRef);

  const checkVaultStatus = useCallback(async () => {
    try {
      const result = await invoke<{ status: string }>("get_vault_status");
      switch (result.status) {
        case "first_run":
          setAppState("first_run");
          break;
        case "locked":
          setAppState("locked");
          break;
        case "unlocked":
        case "plaintext":
          setAppState("unlocked");
          break;
        default:
          setAppState("first_run");
      }
    } catch (e) {
      console.error("Failed to get vault status:", e);
      setAppState("first_run");
    }
  }, []);

  useEffect(() => {
    checkVaultStatus();
  }, [checkVaultStatus]);

  useEffect(() => {
    startAutoCheck((info) => setUpdateInfo(info));
    return () => stopAutoCheck();
  }, []);

  useEffect(() => {
    const unlisten = listen<number>("pty-closed", (event) => {
      workspace.dispatch({ type: "REMOVE_SESSION", sessionId: event.payload });
    });
    return () => { unlisten.then(fn => fn()); };
  }, [workspace.dispatch]);

  const onViewChange = useCallback((view: View) => setActiveView(view), []);

  const onConnectHost = useCallback((host: Host) => {
    workspace.dispatch({
      type: "NEW_SSH",
      paneId: genPaneId(),
      tabId: genTabId(),
      hostId: host.id,
      hostLabel: host.label,
    });
    setActiveView("terminals");
  }, [workspace.dispatch]);

  const onOpenSftp = useCallback((paneId: number) => {
    const pane = workspace.state.panes.get(paneId);
    if (!pane) return;

    const isRemote = pane.kind === "ssh";
    const source = isRemote
      ? { type: "remote" as const, sshSessionId: pane.sessionId }
      : { type: "local" as const };
    const label = isRemote ? `SFTP: ${pane.name}` : "Files";

    workspace.dispatch({
      type: "NEW_SFTP",
      paneId: genPaneId(),
      tabId: genTabId(),
      source,
      label,
    });
  }, [workspace.state.panes, workspace.dispatch]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      e.preventDefault();
    };
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  const anyDragging = tabDrag.isActive || paneDrag.isActive;

  if (appState === "loading") {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", width: "100%", background: "#0b0d12",
        color: "#64748b", fontFamily: "'Inter', system-ui, sans-serif",
      }}>
        <div style={{ fontSize: 14 }}>Loading...</div>
      </div>
    );
  }

  if (appState === "first_run") {
    return <VaultSetup onComplete={checkVaultStatus} />;
  }

  if (appState === "locked") {
    return <VaultUnlock onUnlock={checkVaultStatus} />;
  }

  return (
    <div style={{
      display: "flex", height: "100vh", width: "100%",
      background: "#0b0d12", color: "#e2e8f0",
      fontFamily: "'Inter', system-ui, sans-serif", overflow: "hidden",
      userSelect: "none", WebkitUserSelect: "none",
    }}>
      <style>{`
        ::-webkit-scrollbar { width: 3px }
        ::-webkit-scrollbar-track { background: transparent }
        ::-webkit-scrollbar-thumb { background: #1e2330; border-radius: 4px }
        .xterm-viewport::-webkit-scrollbar { width: 3px }
        .xterm-viewport::-webkit-scrollbar-thumb { background: #1e2330; border-radius: 4px }
      `}</style>

      <Sidebar
        workspace={workspace}
        tabDrag={tabDrag}
        paneDrag={paneDrag}
        sidebarRef={sidebarRef}
        tabItemRefs={tabItemRefs}
        activeView={activeView}
        onViewChange={onViewChange}
        updateInfo={updateInfo}
      />
      <div style={{ flex: 1, display: activeView === "terminals" ? "flex" : "none", flexDirection: "column", overflow: "hidden" }}>
        <WorkspacePanel
          workspace={workspace}
          tabDrag={tabDrag}
          paneDrag={paneDrag}
          sepDrag={sepDrag}
          mainPanelRef={mainPanelRef}
          paneRefs={paneRefs}
          onOpenSftp={onOpenSftp}
        />
      </div>
      <div style={{ flex: 1, display: activeView === "hosts" ? "flex" : "none", flexDirection: "column", overflow: "hidden" }}>
        <HostsPanel onConnect={onConnectHost} />
      </div>
      <div style={{ flex: 1, display: activeView === "settings" ? "flex" : "none", flexDirection: "column", overflow: "hidden" }}>
        <SettingsPanel updateInfo={updateInfo} onUpdateChecked={setUpdateInfo} />
      </div>
    </div>
  );
}

import { useCallback } from "react";
import { WorkspaceAPI, genPaneId, genTabId } from "../hooks/useWorkspace";
import { TabDragAPI } from "../hooks/useTabDrag";
import { PaneDragAPI } from "../hooks/usePaneDrag";
import { IconSettings, IconTerminal, IconPlus, IconHosts } from "./icons";
import TabItem from "./TabItem";
import { UpdateInfo } from "../lib/updater";

export type View = "terminals" | "hosts" | "settings";

interface Props {
  workspace: WorkspaceAPI;
  tabDrag: TabDragAPI;
  paneDrag: PaneDragAPI;
  sidebarRef: React.RefObject<HTMLDivElement | null>;
  tabItemRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  activeView: View;
  onViewChange: (view: View) => void;
  updateInfo?: UpdateInfo | null;
}

export default function Sidebar({ workspace, tabDrag, paneDrag, sidebarRef, tabItemRefs, activeView, onViewChange, updateInfo }: Props) {
  const { state, dispatch, getTabLabel } = workspace;
  const { tabs, activeTabId } = state;

  const onNew = useCallback(() => {
    dispatch({ type: "NEW_TERMINAL", paneId: genPaneId(), tabId: genTabId() });
    onViewChange("terminals");
  }, [dispatch, onViewChange]);

  const onClose = useCallback(
    (e: React.MouseEvent, tabId: number) => {
      e.stopPropagation();
      dispatch({ type: "CLOSE_TAB", tabId });
    },
    [dispatch]
  );

  const onRename = useCallback(
    (paneId: number, name: string) => dispatch({ type: "RENAME_PANE", paneId, name }),
    [dispatch]
  );

  const onTabMouseDown = useCallback(
    (e: React.MouseEvent, tabId: number) => {
      onViewChange("terminals");
      tabDrag.onTabMouseDown(e, tabId);
    },
    [onViewChange, tabDrag]
  );

  return (
    <div
      ref={sidebarRef}
      style={{
        width: 220, background: "#080a0f", borderRight: "1px solid #161925",
        display: "flex", flexDirection: "column", flexShrink: 0,
        userSelect: "none", WebkitUserSelect: "none", cursor: "default",
      }}
    >
      <div data-tauri-drag-region style={{ height: 36, flexShrink: 0, borderBottom: "1px solid #161925" }} />

      <div style={{ padding: "10px 8px 8px", borderBottom: "1px solid #161925", flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <button
          onClick={() => onViewChange(activeView === "hosts" ? "terminals" : "hosts")}
          style={{
            width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            padding: "7px 0", borderRadius: 9, border: "1px solid",
            borderColor: activeView === "hosts" ? "#667eea" : "#1e2330",
            cursor: "pointer",
            background: activeView === "hosts" ? "rgba(102,126,234,0.12)" : "transparent",
            color: activeView === "hosts" ? "#667eea" : "#4a5568",
            fontSize: 12, fontWeight: 600, fontFamily: "inherit",
            transition: "all 0.15s ease",
          }}
        >
          <IconHosts color={activeView === "hosts" ? "#667eea" : "#4a5568"} /> Hosts
        </button>
        <button onClick={onNew} style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
          padding: "8px 0", borderRadius: 9, border: "none", cursor: "pointer",
          background: "linear-gradient(135deg,#667eea,#764ba2)",
          color: "#fff", fontSize: 12, fontWeight: 600, fontFamily: "inherit",
        }}>
          <IconPlus /> New Terminal
        </button>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{
          padding: "10px 14px 6px", fontSize: 9, color: "#2a3050", fontWeight: 700,
          letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0,
        }}>
          Tabs · {tabs.length}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 6px" }}>
          {tabs.length === 0 ? (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", height: "100%", gap: 10, color: "#2a3050",
            }}>
              <IconTerminal color="#2a3050" />
              <span style={{ fontSize: 11 }}>No sessions</span>
            </div>
          ) : (
            tabs.map((tab, index) => {
              const isActive = tab.id === activeTabId;
              const label = getTabLabel(tab);
              const fromIdx = tabs.findIndex(t => t.id === tabDrag.dragTabId);

              const isDragSource = tabDrag.dragTabId === tab.id && tabDrag.isActive;

              const showReorderBefore =
                tabDrag.isActive && !tabDrag.splitMode &&
                tabDrag.dropIndex === index &&
                fromIdx !== index && fromIdx !== index - 1;

              const showReorderAfter =
                index === tabs.length - 1 &&
                tabDrag.isActive && !tabDrag.splitMode &&
                tabDrag.dropIndex === tabs.length &&
                fromIdx !== tabs.length - 1;

              const showPaneBefore =
                paneDrag.tabMode && paneDrag.isActive && paneDrag.tabDropIndex === index;

              const showPaneAfter =
                index === tabs.length - 1 &&
                paneDrag.tabMode && paneDrag.isActive && paneDrag.tabDropIndex === tabs.length;

              return (
                <TabItem
                  key={tab.id}
                  tab={tab}
                  isActive={isActive}
                  label={label}
                  isDragSource={isDragSource}
                  showIndicatorBefore={showReorderBefore || showPaneBefore}
                  showIndicatorAfter={showReorderAfter || showPaneAfter}
                  onMouseDown={onTabMouseDown}
                  onClose={onClose}
                  onRename={onRename}
                  itemRef={el => {
                    if (el) tabItemRefs.current.set(tab.id, el);
                    else tabItemRefs.current.delete(tab.id);
                  }}
                />
              );
            })
          )}
        </div>
      </div>

      <div style={{ padding: "8px 8px 10px", borderTop: "1px solid #161925", flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {updateInfo?.available && (
          <button
            onClick={() => onViewChange("settings")}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 7,
              padding: "7px 10px", borderRadius: 8,
              border: "1px solid rgba(102,126,234,0.3)",
              background: "rgba(102,126,234,0.08)",
              color: "#667eea", cursor: "pointer",
              fontSize: 11, fontWeight: 600, fontFamily: "inherit",
              transition: "all 0.15s ease",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
            Update v{updateInfo.version}
          </button>
        )}
        <button
          onClick={() => onViewChange(activeView === "settings" ? "terminals" : "settings")}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 7,
            padding: "7px 8px", borderRadius: 8, border: "none",
            background: activeView === "settings" ? "rgba(102,126,234,0.12)" : "transparent",
            color: activeView === "settings" ? "#667eea" : "#4a5568",
            cursor: "pointer", fontSize: 12, fontFamily: "inherit",
            transition: "all 0.15s ease",
          }}
        >
          <IconSettings /> Settings
        </button>
      </div>
    </div>
  );
}
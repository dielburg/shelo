import { useCallback } from "react";
import { getAllPaneIds } from "../layoutTree";
import { WorkspaceAPI, genPaneId, genTabId } from "../hooks/useWorkspace";
import { TabDragAPI } from "../hooks/useTabDrag";
import { PaneDragAPI } from "../hooks/usePaneDrag";
import { SeparatorDragAPI } from "../hooks/useSeparatorDrag";
import { IconTerminalLarge } from "./icons";
import PaneContainer from "./PaneContainer";
import SeparatorHandle from "./SeparatorHandle";
import WindowControls from "./WindowControls";

interface Props {
  workspace: WorkspaceAPI;
  tabDrag: TabDragAPI;
  paneDrag: PaneDragAPI;
  sepDrag: SeparatorDragAPI;
  mainPanelRef: React.RefObject<HTMLDivElement | null>;
  paneRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  onOpenSftp?: (paneId: number) => void;
}

export default function WorkspacePanel({ workspace, tabDrag, paneDrag, sepDrag, mainPanelRef, paneRefs, onOpenSftp }: Props) {
  const { state, activePaneIds, boundsMap, separators, dispatch } = workspace;
  const { tabs, activeTabId, focusedPaneId } = state;

  const blockPointer = sepDrag.isDragging || paneDrag.isActive || tabDrag.splitMode;

  const onFocus = useCallback(
    (pid: number) => dispatch({ type: "FOCUS_PANE", paneId: pid }),
    [dispatch]
  );

  const onSplit = useCallback(
    (pid: number, dir: "horizontal" | "vertical") => dispatch({ type: "SPLIT_PANE", paneId: pid, direction: dir, newPaneId: genPaneId() }),
    [dispatch]
  );

  const onClosePane = useCallback(
    (pid: number) => dispatch({ type: "CLOSE_PANE", paneId: pid }),
    [dispatch]
  );

  const onNew = useCallback(() => dispatch({ type: "NEW_TERMINAL", paneId: genPaneId(), tabId: genTabId() }), [dispatch]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ height: 36, flexShrink: 0, borderBottom: "1px solid #161925", background: "#080a0f", display: "flex", alignItems: "center", position: "relative" }}>
        <div data-tauri-drag-region style={{ position: "absolute", inset: 0 }} />
        <WindowControls />
      </div>

      {tabs.length > 0 ? (
        <div ref={mainPanelRef} style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          {Array.from(state.panes.values()).map(pane => {
            const pid = pane.id;
            const ownerTab = tabs.find(t => getAllPaneIds(t.layout).includes(pid));
            if (!ownerTab) return null;

            const isActiveTab = ownerTab.id === activeTabId;
            const isFocused = isActiveTab && pid === focusedPaneId;

            const isPaneDragTarget = paneDrag.targetPaneId === pid && paneDrag.isActive && !paneDrag.tabMode;
            const isTabSplitTarget = tabDrag.splitTargetId === pid && tabDrag.splitMode;
            const dropZone = isPaneDragTarget ? paneDrag.dropZone : (isTabSplitTarget ? tabDrag.splitZone : null);

            return (
              <PaneContainer
                key={pid}
                pane={pane}
                bounds={isActiveTab ? boundsMap.get(pid) : undefined}
                isVisible={isActiveTab}
                isFocused={isFocused}
                showFocusOutline={isFocused && activePaneIds.length > 1}
                isDragSource={paneDrag.dragPaneId === pid && paneDrag.isActive}
                dropZone={dropZone}
                blockPointer={blockPointer}
                canDrag={activePaneIds.length > 1}
                onFocus={() => onFocus(pid)}
                onHeaderMouseDown={paneDrag.onPaneHeaderMouseDown}
                onSplit={onSplit}
                onClose={onClosePane}
                onOpenSftp={onOpenSftp}
                paneRef={el => {
                  if (el) paneRefs.current.set(pid, el);
                  else paneRefs.current.delete(pid);
                }}
              />
            );
          })}

          {separators.map((sep, i) => (
            <SeparatorHandle key={i} sep={sep} sepDrag={sepDrag} />
          ))}
        </div>
      ) : (
        <div data-tauri-drag-region style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 12, color: "#2a3050",
        }}>
          <IconTerminalLarge />
          <p style={{ fontSize: 13, margin: 0 }}>No active session</p>
          <button onClick={onNew} style={{
            padding: "7px 16px", borderRadius: 8, border: "none", cursor: "pointer",
            background: "linear-gradient(135deg,#667eea,#764ba2)",
            color: "#fff", fontSize: 12, fontWeight: 600, fontFamily: "inherit",
          }}>+ New Terminal</button>
        </div>
      )}
    </div>
  );
}
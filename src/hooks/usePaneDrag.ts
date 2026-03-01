import { useState, useEffect, useCallback, useRef } from "react";
import { DropZone, computeDropZone } from "../types";
import { WorkspaceAPI, genTabId } from "./useWorkspace";

export interface PaneDragRefs {
  mainPanelRef: React.RefObject<HTMLDivElement | null>;
  sidebarRef: React.RefObject<HTMLDivElement | null>;
  paneRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  tabItemRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
}

export interface PaneDragAPI {
  dragPaneId: number | null;
  isActive: boolean;
  targetPaneId: number | null;
  dropZone: DropZone | null;
  tabMode: boolean;
  tabDropIndex: number | null;
  onPaneHeaderMouseDown: (e: React.MouseEvent, paneId: number) => void;
}

const DRAG_THRESHOLD = 8;

export function usePaneDrag(workspace: WorkspaceAPI, refs: PaneDragRefs): PaneDragAPI {
  const { state, activeTab, activePaneIds, dispatch } = workspace;
  const { tabs } = state;

  const [dragPaneId, setDragPaneId] = useState<number | null>(null);
  const [targetPaneId, setTargetPaneId] = useState<number | null>(null);
  const [dropZone, setDropZone] = useState<DropZone | null>(null);
  const [tabMode, setTabMode] = useState(false);
  const [tabDropIndex, setTabDropIndex] = useState<number | null>(null);

  const startPos = useRef({ x: 0, y: 0 });
  const active = useRef(false);

  const onPaneHeaderMouseDown = useCallback((e: React.MouseEvent, paneId: number) => {
    if (!activeTab || activePaneIds.length < 2) return;
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    startPos.current = { x: e.clientX, y: e.clientY };
    active.current = false;
    setDragPaneId(paneId);
    setTabMode(false);
  }, [activeTab, activePaneIds]);

  useEffect(() => {
    if (dragPaneId === null) return;

    const onMove = (e: MouseEvent) => {
      if (!active.current) {
        const dx = e.clientX - startPos.current.x;
        const dy = e.clientY - startPos.current.y;
        if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
        active.current = true;
      }

      const sidebar = refs.sidebarRef.current;
      if (sidebar) {
        const r = sidebar.getBoundingClientRect();
        const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;

        if (over) {
          if (!tabMode) {
            setTabMode(true);
            setTargetPaneId(null);
            setDropZone(null);
          }

          let idx: number | null = null;
          for (let i = 0; i < tabs.length; i++) {
            const el = refs.tabItemRefs.current.get(tabs[i].id);
            if (!el) continue;
            const rect = el.getBoundingClientRect();
            if (e.clientY < rect.top + rect.height / 2) { idx = i; break; }
          }
          setTabDropIndex(idx ?? tabs.length);
          return;
        } else if (tabMode) {
          setTabMode(false);
          setTabDropIndex(null);
        }
      }

      let foundTarget: number | null = null;
      let foundZone: DropZone | null = null;
      for (const [pid, el] of refs.paneRefs.current) {
        if (pid === dragPaneId || !activePaneIds.includes(pid)) continue;
        const rect = el.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
          foundTarget = pid;
          foundZone = computeDropZone(e.clientX, e.clientY, rect);
          break;
        }
      }
      setTargetPaneId(foundTarget);
      setDropZone(foundZone);
    };

    const onUp = () => {
      if (active.current) {
        if (tabMode && tabDropIndex !== null) {
          dispatch({ type: "PANE_TO_TAB", sourcePaneId: dragPaneId!, insertIndex: tabDropIndex, newTabId: genTabId() });
        } else if (!tabMode && targetPaneId !== null && dropZone !== null) {
          dispatch({ type: "PANE_REARRANGE", sourcePaneId: dragPaneId!, targetPaneId, zone: dropZone });
        }
      }

      setDragPaneId(null);
      setTargetPaneId(null);
      setDropZone(null);
      active.current = false;
      setTabMode(false);
      setTabDropIndex(null);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [dragPaneId, targetPaneId, dropZone, tabMode, tabDropIndex, tabs, activeTab, activePaneIds, dispatch, refs]);

  return {
    dragPaneId,
    isActive: active.current && dragPaneId !== null,
    targetPaneId,
    dropZone,
    tabMode,
    tabDropIndex,
    onPaneHeaderMouseDown,
  };
}
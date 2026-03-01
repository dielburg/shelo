import { useState, useEffect, useCallback, useRef } from "react";
import { DropZone, computeDropZone } from "../types";
import { WorkspaceAPI } from "./useWorkspace";

export interface DragRefs {
  mainPanelRef: React.RefObject<HTMLDivElement | null>;
  paneRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  tabItemRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
}

export interface TabDragAPI {
  dragTabId: number | null;
  isActive: boolean;
  dropIndex: number | null;
  splitMode: boolean;
  splitTargetId: number | null;
  splitZone: DropZone | null;
  onTabMouseDown: (e: React.MouseEvent, tabId: number) => void;
}

const DRAG_THRESHOLD = 5;

export function useTabDrag(workspace: WorkspaceAPI, refs: DragRefs): TabDragAPI {
  const { state, activeTab, activePaneIds, dispatch } = workspace;
  const { tabs, activeTabId } = state;

  const [dragTabId, setDragTabId] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [splitMode, setSplitMode] = useState(false);
  const [splitTargetId, setSplitTargetId] = useState<number | null>(null);
  const [splitZone, setSplitZone] = useState<DropZone | null>(null);

  const startPos = useRef({ x: 0, y: 0 });
  const active = useRef(false);

  const onTabMouseDown = useCallback((e: React.MouseEvent, tabId: number) => {
    if ((e.target as HTMLElement).closest("button, input")) return;
    e.preventDefault();
    startPos.current = { x: e.clientX, y: e.clientY };
    active.current = false;
    setDragTabId(tabId);
    setSplitMode(false);
  }, []);

  useEffect(() => {
    if (dragTabId === null) return;

    const onMove = (e: MouseEvent) => {
      if (!active.current) {
        const dx = e.clientX - startPos.current.x;
        const dy = e.clientY - startPos.current.y;
        if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
        active.current = true;
      }

      const panel = refs.mainPanelRef.current;
      if (panel && activeTab && dragTabId !== activeTabId) {
        const r = panel.getBoundingClientRect();
        const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;

        if (over) {
          if (!splitMode) {
            setSplitMode(true);
            setDropIndex(null);
          }

          let foundTarget: number | null = null;
          let foundZone: DropZone | null = null;
          for (const [pid, el] of refs.paneRefs.current) {
            if (!activePaneIds.includes(pid)) continue;
            const rect = el.getBoundingClientRect();
            if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
              foundTarget = pid;
              foundZone = computeDropZone(e.clientX, e.clientY, rect);
              break;
            }
          }
          setSplitTargetId(foundTarget);
          setSplitZone(foundZone);
          return;
        } else if (splitMode) {
          setSplitMode(false);
          setSplitTargetId(null);
          setSplitZone(null);
        }
      }

      if (!splitMode) {
        let idx: number | null = null;
        for (let i = 0; i < tabs.length; i++) {
          const el = refs.tabItemRefs.current.get(tabs[i].id);
          if (!el) continue;
          const rect = el.getBoundingClientRect();
          if (e.clientY < rect.top + rect.height / 2) { idx = i; break; }
        }
        setDropIndex(idx ?? tabs.length);
      }
    };

    const onUp = () => {
      if (active.current) {
        if (splitMode && splitTargetId !== null && splitZone !== null && dragTabId !== activeTabId) {
          dispatch({ type: "TAB_TO_SPLIT", sourceTabId: dragTabId, targetPaneId: splitTargetId, zone: splitZone });
        } else if (!splitMode && dropIndex !== null) {
          const fromIndex = tabs.findIndex(t => t.id === dragTabId);
          if (fromIndex !== -1) {
            dispatch({ type: "REORDER_TABS", fromIndex, toIndex: dropIndex });
          }
        }
      } else {
        const tab = tabs.find(t => t.id === dragTabId);
        if (tab) dispatch({ type: "ACTIVATE_TAB", tabId: tab.id });
      }

      setDragTabId(null);
      setDropIndex(null);
      active.current = false;
      setSplitMode(false);
      setSplitTargetId(null);
      setSplitZone(null);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [dragTabId, dropIndex, splitMode, splitTargetId, splitZone, tabs, activeTab, activeTabId, activePaneIds, dispatch, refs]);

  return {
    dragTabId,
    isActive: active.current && dragTabId !== null,
    dropIndex,
    splitMode,
    splitTargetId,
    splitZone,
    onTabMouseDown,
  };
}
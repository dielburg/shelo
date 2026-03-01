import { useState, useEffect, useCallback } from "react";
import { SeparatorInfo, updateRatio } from "../layoutTree";
import { WorkspaceAPI } from "./useWorkspace";

export interface SeparatorDragAPI {
  isDragging: boolean;
  activePath: number[] | null;
  onMouseDown: (e: React.MouseEvent, sep: SeparatorInfo) => void;
  onDoubleClick: (sep: SeparatorInfo) => void;
}

export function useSeparatorDrag(
  workspace: WorkspaceAPI,
  mainPanelRef: React.RefObject<HTMLDivElement | null>
): SeparatorDragAPI {
  const [dragging, setDragging] = useState<SeparatorInfo | null>(null);
  const { activeTab, dispatch } = workspace;

  const onMouseDown = useCallback((e: React.MouseEvent, sep: SeparatorInfo) => {
    e.preventDefault();
    setDragging(sep);
  }, []);

  const onDoubleClick = useCallback((sep: SeparatorInfo) => {
    if (!activeTab) return;
    dispatch({ type: "UPDATE_LAYOUT", tabId: activeTab.id, layout: updateRatio(activeTab.layout, sep.path, 0.5) });
  }, [activeTab, dispatch]);

  useEffect(() => {
    if (!dragging || !activeTab || !mainPanelRef.current) return;

    const panel = mainPanelRef.current;
    const sep = dragging;

    const onMove = (e: MouseEvent) => {
      const rect = panel.getBoundingClientRect();
      const pb = sep.parentBounds;
      const ratio = sep.direction === "horizontal"
        ? ((e.clientX - rect.left) / rect.width - pb.x) / pb.w
        : ((e.clientY - rect.top) / rect.height - pb.y) / pb.h;
      dispatch({ type: "UPDATE_LAYOUT", tabId: activeTab.id, layout: updateRatio(activeTab.layout, sep.path, ratio) });
    };

    const onUp = () => setDragging(null);

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [dragging, activeTab, dispatch, mainPanelRef]);

  return {
    isDragging: dragging !== null,
    activePath: dragging?.path ?? null,
    onMouseDown,
    onDoubleClick,
  };
}
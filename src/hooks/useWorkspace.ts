import { useReducer, useCallback, useMemo } from "react";
import { Pane, Tab, DropZone, dropZoneToSplit } from "../types";
import {
  LayoutNode,
  splitLeaf,
  removeLeaf,
  getAllPaneIds,
  isWorkspace,
  calculateBounds,
  calculateSeparators,
  SeparatorInfo,
} from "../layoutTree";

let nextPaneId = 1;
let nextTabId = 1;

export function genPaneId() { return nextPaneId++; }
export function genTabId() { return nextTabId++; }

interface State {
  panes: Map<number, Pane>;
  tabs: Tab[];
  activeTabId: number | null;
  focusedPaneId: number | null;
}

type Action =
  | { type: "NEW_TERMINAL"; paneId: number; tabId: number }
  | { type: "NEW_SSH"; paneId: number; tabId: number; hostId: number; hostLabel: string }
  | { type: "NEW_SFTP"; paneId: number; tabId: number; source: Pane["sftpSource"]; initialPath?: string; label: string }
  | { type: "CLOSE_TAB"; tabId: number }
  | { type: "ACTIVATE_TAB"; tabId: number }
  | { type: "FOCUS_PANE"; paneId: number }
  | { type: "SPLIT_PANE"; paneId: number; direction: "horizontal" | "vertical"; newPaneId: number }
  | { type: "CLOSE_PANE"; paneId: number }
  | { type: "UPDATE_LAYOUT"; tabId: number; layout: LayoutNode }
  | { type: "RENAME_PANE"; paneId: number; name: string }
  | { type: "REORDER_TABS"; fromIndex: number; toIndex: number }
  | { type: "TAB_TO_SPLIT"; sourceTabId: number; targetPaneId: number; zone: DropZone }
  | { type: "PANE_REARRANGE"; sourcePaneId: number; targetPaneId: number; zone: DropZone }
  | { type: "PANE_TO_TAB"; sourcePaneId: number; insertIndex: number; newTabId: number }
  | { type: "REMOVE_SESSION"; sessionId: number };

function nextDuplicateName(baseName: string, panes: Map<number, Pane>): string {
  const existing = new Set<string>();
  for (const p of panes.values()) {
    existing.add(p.defaultName);
  }
  if (!existing.has(baseName)) return baseName;
  let n = 2;
  while (existing.has(`${baseName} (${n})`)) n++;
  return `${baseName} (${n})`;
}

function removePaneIds(panes: Map<number, Pane>, ids: number[]): Map<number, Pane> {
  const next = new Map(panes);
  ids.forEach(id => next.delete(id));
  return next;
}

function pickNextFocus(tabs: Tab[], excludeTabId?: number): { tabId: number | null; paneId: number | null } {
  const remaining = excludeTabId != null ? tabs.filter(t => t.id !== excludeTabId) : tabs;
  if (remaining.length === 0) return { tabId: null, paneId: null };
  const tab = remaining[remaining.length - 1];
  const pIds = getAllPaneIds(tab.layout);
  return { tabId: tab.id, paneId: pIds[0] ?? null };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "NEW_TERMINAL": {
      const defaultName = `Terminal ${action.paneId}`;
      const pane: Pane = { id: action.paneId, kind: "terminal", name: defaultName, defaultName, sessionId: action.paneId };
      const tab: Tab = { id: action.tabId, layout: { type: "leaf", paneId: pane.id } };
      return {
        panes: new Map(state.panes).set(pane.id, pane),
        tabs: [...state.tabs, tab],
        activeTabId: tab.id,
        focusedPaneId: pane.id,
      };
    }

    case "NEW_SSH": {
      const defaultName = nextDuplicateName(action.hostLabel, state.panes);
      const pane: Pane = {
        id: action.paneId, kind: "ssh", name: defaultName, defaultName,
        sessionId: action.paneId, hostId: action.hostId,
      };
      const tab: Tab = { id: action.tabId, layout: { type: "leaf", paneId: pane.id } };
      return {
        panes: new Map(state.panes).set(pane.id, pane),
        tabs: [...state.tabs, tab],
        activeTabId: tab.id,
        focusedPaneId: pane.id,
      };
    }

    case "NEW_SFTP": {
      const defaultName = nextDuplicateName(action.label, state.panes);
      const pane: Pane = {
        id: action.paneId, kind: "sftp", name: defaultName, defaultName,
        sessionId: action.paneId, sftpSource: action.source, sftpInitialPath: action.initialPath,
      };
      const tab: Tab = { id: action.tabId, layout: { type: "leaf", paneId: pane.id } };
      return {
        panes: new Map(state.panes).set(pane.id, pane),
        tabs: [...state.tabs, tab],
        activeTabId: tab.id,
        focusedPaneId: pane.id,
      };
    }

    case "CLOSE_TAB": {
      const tab = state.tabs.find(t => t.id === action.tabId);
      if (!tab) return state;
      const paneIds = getAllPaneIds(tab.layout);
      const tabs = state.tabs.filter(t => t.id !== action.tabId);
      const panes = removePaneIds(state.panes, paneIds);
      const isActive = state.activeTabId === action.tabId;
      const next = isActive ? pickNextFocus(tabs) : { tabId: state.activeTabId, paneId: state.focusedPaneId };
      return { panes, tabs, activeTabId: next.tabId, focusedPaneId: next.paneId };
    }

    case "ACTIVATE_TAB": {
      const tab = state.tabs.find(t => t.id === action.tabId);
      if (!tab) return state;
      const pIds = getAllPaneIds(tab.layout);
      return { ...state, activeTabId: tab.id, focusedPaneId: pIds[0] ?? null };
    }

    case "FOCUS_PANE":
      return { ...state, focusedPaneId: action.paneId };

    case "SPLIT_PANE": {
      const activeTab = state.tabs.find(t => t.id === state.activeTabId);
      if (!activeTab) return state;
      const defaultName = `Terminal ${action.newPaneId}`;
      const pane: Pane = { id: action.newPaneId, kind: "terminal", name: defaultName, defaultName, sessionId: action.newPaneId };
      const layout = splitLeaf(activeTab.layout, action.paneId, action.direction, pane.id, "after");
      if (!layout) return state;
      return {
        panes: new Map(state.panes).set(pane.id, pane),
        tabs: state.tabs.map(t => t.id === activeTab.id ? { ...t, layout } : t),
        activeTabId: state.activeTabId,
        focusedPaneId: pane.id,
      };
    }

    case "CLOSE_PANE": {
      const activeTab = state.tabs.find(t => t.id === state.activeTabId);
      if (!activeTab) return state;
      const panes = removePaneIds(state.panes, [action.paneId]);
      const result = removeLeaf(activeTab.layout, action.paneId);

      if (result === null || result === undefined) {
        const tabs = state.tabs.filter(t => t.id !== activeTab.id);
        const next = pickNextFocus(tabs);
        return { panes, tabs, activeTabId: next.tabId, focusedPaneId: next.paneId };
      }

      const tabs = state.tabs.map(t => t.id === activeTab.id ? { ...t, layout: result } : t);
      const focusedPaneId = state.focusedPaneId === action.paneId
        ? (getAllPaneIds(result).pop() ?? null)
        : state.focusedPaneId;
      return { panes, tabs, activeTabId: state.activeTabId, focusedPaneId };
    }

    case "UPDATE_LAYOUT":
      return {
        ...state,
        tabs: state.tabs.map(t => t.id === action.tabId ? { ...t, layout: action.layout } : t),
      };

    case "RENAME_PANE": {
      const pane = state.panes.get(action.paneId);
      if (!pane) return state;
      return { ...state, panes: new Map(state.panes).set(pane.id, { ...pane, name: action.name }) };
    }

    case "REORDER_TABS": {
      const { fromIndex, toIndex } = action;
      if (fromIndex === toIndex || toIndex === fromIndex + 1) return state;
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(fromIndex, 1);
      const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex;
      tabs.splice(insertAt, 0, moved);
      return { ...state, tabs };
    }

    case "TAB_TO_SPLIT": {
      const sourceTab = state.tabs.find(t => t.id === action.sourceTabId);
      const activeTab = state.tabs.find(t => t.id === state.activeTabId);
      if (!sourceTab || !activeTab || sourceTab.id === activeTab.id) return state;
      if (sourceTab.layout.type !== "leaf") return state;

      const sourcePaneId = sourceTab.layout.paneId;
      const { direction, position } = dropZoneToSplit(action.zone);
      const layout = splitLeaf(activeTab.layout, action.targetPaneId, direction, sourcePaneId, position);
      if (!layout) return state;

      const tabs = state.tabs
        .filter(t => t.id !== action.sourceTabId)
        .map(t => t.id === state.activeTabId ? { ...t, layout } : t);

      return { ...state, tabs, focusedPaneId: sourcePaneId };
    }

    case "PANE_REARRANGE": {
      const activeTab = state.tabs.find(t => t.id === state.activeTabId);
      if (!activeTab) return state;
      const { direction, position } = dropZoneToSplit(action.zone);

      const stripped = removeLeaf(activeTab.layout, action.sourcePaneId);
      if (stripped === null || stripped === undefined) return state;
      if (!getAllPaneIds(stripped).includes(action.targetPaneId)) return state;

      const layout = splitLeaf(stripped, action.targetPaneId, direction, action.sourcePaneId, position);
      if (!layout) return state;

      const original = getAllPaneIds(activeTab.layout).sort();
      const final_ = getAllPaneIds(layout).sort();
      if (original.length !== final_.length || !original.every((id, i) => id === final_[i])) return state;

      return {
        ...state,
        tabs: state.tabs.map(t => t.id === activeTab.id ? { ...t, layout } : t),
        focusedPaneId: action.sourcePaneId,
      };
    }

    case "PANE_TO_TAB": {
      const activeTab = state.tabs.find(t => t.id === state.activeTabId);
      if (!activeTab) return state;

      const stripped = removeLeaf(activeTab.layout, action.sourcePaneId);
      if (stripped === null || stripped === undefined) return state;

      const newTab: Tab = { id: action.newTabId, layout: { type: "leaf", paneId: action.sourcePaneId } };
      const tabs = state.tabs.map(t => t.id === activeTab.id ? { ...t, layout: stripped } : t);
      tabs.splice(action.insertIndex, 0, newTab);

      return { ...state, tabs, activeTabId: newTab.id, focusedPaneId: action.sourcePaneId };
    }

    case "REMOVE_SESSION": {
      let paneIdToRemove: number | null = null;
      for (const [id, pane] of state.panes) {
        if (pane.sessionId === action.sessionId) { paneIdToRemove = id; break; }
      }
      if (paneIdToRemove === null) return state;

      const panes = removePaneIds(state.panes, [paneIdToRemove]);
      let tabs = state.tabs;
      let activeTabId = state.activeTabId;
      let focusedPaneId = state.focusedPaneId;

      for (const tab of state.tabs) {
        const result = removeLeaf(tab.layout, paneIdToRemove);
        if (result === undefined) continue;
        if (result === null) {
          tabs = tabs.filter(t => t.id !== tab.id);
          if (activeTabId === tab.id) {
            const next = pickNextFocus(tabs);
            activeTabId = next.tabId;
            focusedPaneId = next.paneId;
          }
        } else {
          tabs = tabs.map(t => t.id === tab.id ? { ...t, layout: result } : t);
          if (focusedPaneId === paneIdToRemove) {
            focusedPaneId = getAllPaneIds(result).pop() ?? null;
          }
        }
        break;
      }

      return { panes, tabs, activeTabId, focusedPaneId };
    }

    default:
      return state;
  }
}

const initialState: State = {
  panes: new Map(),
  tabs: [],
  activeTabId: null,
  focusedPaneId: null,
};

export interface WorkspaceAPI {
  state: State;
  activeTab: Tab | null;
  activePaneIds: number[];
  boundsMap: Map<number, import("../layoutTree").Bounds>;
  separators: SeparatorInfo[];
  dispatch: React.Dispatch<Action>;
  getTabLabel: (tab: Tab) => { name: string; isWs: boolean; kind: "terminal" | "ssh" | "sftp" };
}

export function useWorkspace(): WorkspaceAPI {
  const [state, dispatch] = useReducer(reducer, initialState);

  const activeTab = state.tabs.find(t => t.id === state.activeTabId) ?? null;
  const activePaneIds = activeTab ? getAllPaneIds(activeTab.layout) : [];

  const boundsMap = useMemo(
    () => activeTab ? calculateBounds(activeTab.layout) : new Map(),
    [activeTab]
  );

  const separators = useMemo(
    () => activeTab ? calculateSeparators(activeTab.layout) : [],
    [activeTab]
  );

  const getTabLabel = useCallback(
    (tab: Tab): { name: string; isWs: boolean; kind: "terminal" | "ssh" | "sftp" } => {
      if (isWorkspace(tab.layout)) return { name: "Workspace", isWs: true, kind: "terminal" };
      const paneId = (tab.layout as { type: "leaf"; paneId: number }).paneId;
      const pane = state.panes.get(paneId);
      return { name: pane?.name ?? "Terminal", isWs: false, kind: pane?.kind ?? "terminal" };
    },
    [state.panes]
  );

  return { state, activeTab, activePaneIds, boundsMap, separators, dispatch, getTabLabel };
}
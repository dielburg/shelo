import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WorkspaceAPI, genPaneId, genTabId } from "./useWorkspace";
import { View } from "../components/Sidebar";
import {
  ShortcutAction,
  KeyBinding,
  SHORTCUT_METAS,
  getDefaultBindings,
  matchesBinding,
  mergeWithDefaults,
} from "../lib/shortcuts";

export interface ShortcutsAPI {
  bindings: Record<ShortcutAction, KeyBinding>;
  platform: string;
  ready: boolean;
  updateBinding: (action: ShortcutAction, binding: KeyBinding) => Promise<void>;
  resetDefaults: () => Promise<void>;
}

export function useShortcuts(
  workspace: WorkspaceAPI,
  onViewChange: (view: View) => void,
  activeView: View,
): ShortcutsAPI {
  const [platform, setPlatform] = useState("unknown");
  const [bindings, setBindings] = useState<Record<ShortcutAction, KeyBinding> | null>(null);
  const [ready, setReady] = useState(false);

  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  const activeViewRef = useRef(activeView);
  activeViewRef.current = activeView;

  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;

  useEffect(() => {
    (async () => {
      const plat = await invoke<string>("get_platform");
      setPlatform(plat);

      const defaults = getDefaultBindings(plat);
      try {
        const settings = await invoke<Record<string, unknown>>("get_settings");
        const saved = settings.shortcuts as Partial<Record<ShortcutAction, KeyBinding>> | undefined;
        const merged = mergeWithDefaults(saved, defaults);
        setBindings(merged);

        if (!saved) {
          await invoke("set_settings", { settings: { ...settings, shortcuts: merged } });
        }
      } catch {
        setBindings({ ...defaults });
        await invoke("set_settings", { settings: { shortcuts: defaults } }).catch(() => {});
      }
      setReady(true);
    })();
  }, []);

  const persist = useCallback(async (newBindings: Record<ShortcutAction, KeyBinding>) => {
    try {
      const settings = await invoke<Record<string, unknown>>("get_settings");
      await invoke("set_settings", { settings: { ...settings, shortcuts: newBindings } });
    } catch (e) {
      console.error("Failed to save shortcuts:", e);
    }
  }, []);

  const updateBinding = useCallback(async (action: ShortcutAction, binding: KeyBinding) => {
    setBindings(prev => {
      if (!prev) return prev;
      const next = { ...prev, [action]: binding };
      persist(next);
      return next;
    });
  }, [persist]);

  const resetDefaults = useCallback(async () => {
    const defaults = getDefaultBindings(platform);
    setBindings({ ...defaults });
    await persist(defaults);
  }, [platform, persist]);

  useEffect(() => {
    if (!ready) return;

    const handler = (e: KeyboardEvent) => {
      const b = bindingsRef.current;
      const ws = workspaceRef.current;
      if (!b) return;

      if (e.key === "Escape" && activeViewRef.current !== "terminals") {
        e.preventDefault();
        onViewChangeRef.current("terminals");
        return;
      }

      const globalMetas = SHORTCUT_METAS.filter(m => m.context === "global");

      for (const meta of globalMetas) {
        if (!matchesBinding(e, b[meta.action])) continue;

        e.preventDefault();
        e.stopPropagation();

        switch (meta.action) {
          case "newTab":
            onViewChangeRef.current("hosts");
            break;
          case "newTerminal":
            ws.dispatch({ type: "NEW_TERMINAL", paneId: genPaneId(), tabId: genTabId() });
            onViewChangeRef.current("terminals");
            break;
          case "closeTab":
            if (ws.state.activeTabId != null) {
              ws.dispatch({ type: "CLOSE_TAB", tabId: ws.state.activeTabId });
            }
            break;
          default: {
            const match = meta.action.match(/^jumpToTab(\d)$/);
            if (match) {
              const idx = parseInt(match[1], 10) - 1;
              const tab = ws.state.tabs[idx];
              if (tab) {
                ws.dispatch({ type: "ACTIVATE_TAB", tabId: tab.id });
                onViewChangeRef.current("terminals");
              }
            }
            break;
          }
        }
        return;
      }
    };

    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [ready]);

  const defaultBindings = getDefaultBindings(platform);

  return {
    bindings: bindings ?? defaultBindings,
    platform,
    ready,
    updateBinding,
    resetDefaults,
  };
}

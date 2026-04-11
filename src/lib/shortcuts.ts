export type ShortcutAction =
  | "newTab"
  | "newTerminal"
  | "closeTab"
  | "jumpToTab1"
  | "jumpToTab2"
  | "jumpToTab3"
  | "jumpToTab4"
  | "jumpToTab5"
  | "jumpToTab6"
  | "jumpToTab7"
  | "jumpToTab8"
  | "jumpToTab9"
  | "terminalCopy"
  | "terminalPaste"
  | "terminalSelectAll"
  | "terminalZoomIn"
  | "terminalZoomOut"
  | "terminalZoomReset";

export type ShortcutContext = "global" | "terminal";

export interface KeyBinding {
  key: string;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  alt: boolean;
}

export interface ShortcutMeta {
  action: ShortcutAction;
  label: string;
  description: string;
  context: ShortcutContext;
}

export const SHORTCUT_METAS: ShortcutMeta[] = [
  { action: "newTab", label: "New Tab", description: "Open the Hosts panel to start a new connection", context: "global" },
  { action: "newTerminal", label: "New Terminal", description: "Open a new local terminal session in a new tab", context: "global" },
  { action: "closeTab", label: "Close Tab", description: "Close the currently active tab", context: "global" },
  { action: "jumpToTab1", label: "Jump to Tab 1", description: "Switch to the first tab", context: "global" },
  { action: "jumpToTab2", label: "Jump to Tab 2", description: "Switch to the second tab", context: "global" },
  { action: "jumpToTab3", label: "Jump to Tab 3", description: "Switch to the third tab", context: "global" },
  { action: "jumpToTab4", label: "Jump to Tab 4", description: "Switch to the fourth tab", context: "global" },
  { action: "jumpToTab5", label: "Jump to Tab 5", description: "Switch to the fifth tab", context: "global" },
  { action: "jumpToTab6", label: "Jump to Tab 6", description: "Switch to the sixth tab", context: "global" },
  { action: "jumpToTab7", label: "Jump to Tab 7", description: "Switch to the seventh tab", context: "global" },
  { action: "jumpToTab8", label: "Jump to Tab 8", description: "Switch to the eighth tab", context: "global" },
  { action: "jumpToTab9", label: "Jump to Tab 9", description: "Switch to the ninth tab", context: "global" },
  { action: "terminalCopy", label: "Copy", description: "Copy selected text from the terminal to clipboard", context: "terminal" },
  { action: "terminalPaste", label: "Paste", description: "Paste text from clipboard into the terminal", context: "terminal" },
  { action: "terminalSelectAll", label: "Select All", description: "Select all text in the terminal buffer", context: "terminal" },
  { action: "terminalZoomIn", label: "Zoom In", description: "Increase terminal font size", context: "terminal" },
  { action: "terminalZoomOut", label: "Zoom Out", description: "Decrease terminal font size", context: "terminal" },
  { action: "terminalZoomReset", label: "Zoom Reset", description: "Reset terminal font size to default", context: "terminal" },
];

function macDefaults(): Record<ShortcutAction, KeyBinding> {
  const cmd = (key: string): KeyBinding => ({ key, ctrl: false, shift: false, meta: true, alt: false });
  return {
    newTab: cmd("t"),
    newTerminal: cmd("l"),
    closeTab: cmd("w"),
    jumpToTab1: cmd("1"),
    jumpToTab2: cmd("2"),
    jumpToTab3: cmd("3"),
    jumpToTab4: cmd("4"),
    jumpToTab5: cmd("5"),
    jumpToTab6: cmd("6"),
    jumpToTab7: cmd("7"),
    jumpToTab8: cmd("8"),
    jumpToTab9: cmd("9"),
    terminalCopy: cmd("c"),
    terminalPaste: cmd("v"),
    terminalSelectAll: cmd("a"),
    terminalZoomIn: cmd("="),
    terminalZoomOut: cmd("-"),
    terminalZoomReset: cmd("0"),
  };
}

function winLinuxDefaults(): Record<ShortcutAction, KeyBinding> {
  const ctrl = (key: string): KeyBinding => ({ key, ctrl: true, shift: false, meta: false, alt: false });
  const ctrlShift = (key: string): KeyBinding => ({ key, ctrl: true, shift: true, meta: false, alt: false });
  return {
    newTab: ctrl("t"),
    newTerminal: ctrl("l"),
    closeTab: ctrl("w"),
    jumpToTab1: ctrl("1"),
    jumpToTab2: ctrl("2"),
    jumpToTab3: ctrl("3"),
    jumpToTab4: ctrl("4"),
    jumpToTab5: ctrl("5"),
    jumpToTab6: ctrl("6"),
    jumpToTab7: ctrl("7"),
    jumpToTab8: ctrl("8"),
    jumpToTab9: ctrl("9"),
    terminalCopy: ctrlShift("c"),
    terminalPaste: ctrlShift("v"),
    terminalSelectAll: ctrlShift("a"),
    terminalZoomIn: ctrl("="),
    terminalZoomOut: ctrl("-"),
    terminalZoomReset: ctrl("0"),
  };
}

export function getDefaultBindings(platform: string): Record<ShortcutAction, KeyBinding> {
  return platform === "macos" ? macDefaults() : winLinuxDefaults();
}

export function matchesBinding(e: KeyboardEvent, binding: KeyBinding): boolean {
  return (
    e.key.toLowerCase() === binding.key.toLowerCase() &&
    e.ctrlKey === binding.ctrl &&
    e.shiftKey === binding.shift &&
    e.metaKey === binding.meta &&
    e.altKey === binding.alt
  );
}

function bindingToString(b: KeyBinding): string {
  const parts: string[] = [];
  if (b.ctrl) parts.push("ctrl");
  if (b.shift) parts.push("shift");
  if (b.meta) parts.push("meta");
  if (b.alt) parts.push("alt");
  parts.push(b.key.toLowerCase());
  return parts.join("+");
}

export function findConflicts(
  bindings: Record<ShortcutAction, KeyBinding>,
): [ShortcutAction, ShortcutAction][] {
  const seen = new Map<string, ShortcutAction>();
  const conflicts: [ShortcutAction, ShortcutAction][] = [];

  for (const [action, binding] of Object.entries(bindings) as [ShortcutAction, KeyBinding][]) {
    const key = bindingToString(binding);
    const existing = seen.get(key);
    if (existing) {
      conflicts.push([existing, action]);
    } else {
      seen.set(key, action);
    }
  }
  return conflicts;
}

export function formatBinding(b: KeyBinding, platform: string): string {
  const parts: string[] = [];
  if (b.ctrl) parts.push(platform === "macos" ? "Ctrl" : "Ctrl");
  if (b.meta) parts.push(platform === "macos" ? "\u2318" : "Win");
  if (b.alt) parts.push(platform === "macos" ? "\u2325" : "Alt");
  if (b.shift) parts.push(platform === "macos" ? "\u21E7" : "Shift");

  const keyLabel = b.key.length === 1 ? b.key.toUpperCase() : b.key;
  parts.push(keyLabel);

  return parts.join(" + ");
}

export function bindingFromEvent(e: KeyboardEvent): KeyBinding | null {
  const ignore = ["Control", "Shift", "Alt", "Meta"];
  if (ignore.includes(e.key)) return null;
  return {
    key: e.key.length === 1 ? e.key.toLowerCase() : e.key,
    ctrl: e.ctrlKey,
    shift: e.shiftKey,
    meta: e.metaKey,
    alt: e.altKey,
  };
}

export function mergeWithDefaults(
  saved: Partial<Record<ShortcutAction, KeyBinding>> | undefined,
  defaults: Record<ShortcutAction, KeyBinding>,
): Record<ShortcutAction, KeyBinding> {
  if (!saved) return { ...defaults };
  return { ...defaults, ...saved };
}

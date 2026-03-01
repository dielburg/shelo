import { listen } from "@tauri-apps/api/event";
import { DragPayload, PanelRegistration } from "./types";

export const panels = new Map<number, PanelRegistration>();

let _fileDrag: DragPayload | null = null;
let _fileDragActive = false;
let _dragStartX = 0;
let _dragStartY = 0;
let _currentTargetPaneId: number | null = null;
let _dragGhost: HTMLDivElement | null = null;
let _dragModeLabel: HTMLSpanElement | null = null;
let _isShiftHeld = false;
const DRAG_THRESHOLD = 5;

export let transferOwnerPaneId: number | null = null;
export function setTransferOwnerPaneId(id: number | null) {
  transferOwnerPaneId = id;
}

let _systemDragTargetPaneId: number | null = null;
let _systemDragListenersSetup = false;

function findPanelAtPointScaled(posX: number, posY: number): number | null {
  const scale = window.devicePixelRatio || 1;
  const attempts = scale !== 1 ? [1, scale] : [1];

  for (const s of attempts) {
    const x = posX / s;
    const y = posY / s;
    for (const [paneId, reg] of panels) {
      const rect = reg.containerRef.current?.getBoundingClientRect();
      if (rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return paneId;
      }
    }
  }
  return null;
}

function findPanelAtPoint(x: number, y: number, excludePaneId?: number): number | null {
  for (const [paneId, reg] of panels) {
    if (paneId === excludePaneId) continue;
    const rect = reg.containerRef.current?.getBoundingClientRect();
    if (rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return paneId;
    }
  }
  return null;
}

function updateDragModeLabel(label: HTMLSpanElement, isMove: boolean) {
  if (isMove) {
    label.textContent = "MOVE";
    label.style.background = "#f59e0b";
    label.style.color = "#000";
  } else {
    label.textContent = "COPY";
    label.style.background = "#4ecdc4";
    label.style.color = "#000";
  }
}

function createDragGhost(files: { name: string; is_dir: boolean }[]): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;z-index:99999;pointer-events:none;padding:6px 12px;border-radius:8px;" +
    "background:rgba(30,42,69,0.92);border:1px solid #3a4560;color:#e2e8f0;font-size:12px;" +
    "font-family:Inter,system-ui,sans-serif;white-space:nowrap;display:flex;flex-direction:column;gap:3px;" +
    "box-shadow:0 4px 16px rgba(0,0,0,0.5);backdrop-filter:blur(8px);";

  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:center;gap:6px;";

  const label = document.createElement("span");
  label.style.cssText = "font-size:10px;padding:1px 5px;border-radius:3px;font-weight:600;";
  updateDragModeLabel(label, false);
  _dragModeLabel = label;

  if (files.length === 1) {
    const f = files[0];
    row.innerHTML = `<span style="font-size:13px">${f.is_dir ? "\u{1F4C1}" : "\u{1F4C4}"}</span><span>${f.name}</span>`;
  } else {
    row.innerHTML = `<span style="font-size:13px">\u{1F4E6}</span><span>${files.length} items</span>`;
  }
  row.appendChild(label);
  el.appendChild(row);

  const hint = document.createElement("div");
  hint.style.cssText = "font-size:9px;color:#8892a4;text-align:center;";
  hint.textContent = "\u21E7 Shift = Move";
  el.appendChild(hint);

  document.body.appendChild(el);
  return el;
}

function positionGhost(x: number, y: number) {
  if (_dragGhost) {
    _dragGhost.style.left = `${x + 12}px`;
    _dragGhost.style.top = `${y + 12}px`;
  }
}

function removeDragGhost() {
  if (_dragGhost) {
    _dragGhost.remove();
    _dragGhost = null;
  }
}

function handleGlobalKeyChange(e: KeyboardEvent) {
  if (!_fileDragActive || !_dragModeLabel) return;
  const shift = e.shiftKey;
  if (shift !== _isShiftHeld) {
    _isShiftHeld = shift;
    updateDragModeLabel(_dragModeLabel, shift);
    if (_dragGhost) void _dragGhost.offsetHeight;
  }
}

function handleGlobalMouseMove(e: MouseEvent) {
  if (!_fileDrag) return;

  e.preventDefault();

  if (!_fileDragActive) {
    const dx = e.clientX - _dragStartX;
    const dy = e.clientY - _dragStartY;
    if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
    _fileDragActive = true;
    _isShiftHeld = e.shiftKey;

    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";

    window.getSelection()?.removeAllRanges();

    _dragGhost = createDragGhost(_fileDrag.files);
    positionGhost(e.clientX, e.clientY);

    document.addEventListener("keydown", handleGlobalKeyChange, true);
    document.addEventListener("keyup", handleGlobalKeyChange, true);
  }

  if (e.shiftKey !== _isShiftHeld) {
    _isShiftHeld = e.shiftKey;
    if (_dragModeLabel) updateDragModeLabel(_dragModeLabel, _isShiftHeld);
  }

  positionGhost(e.clientX, e.clientY);

  const targetId = findPanelAtPoint(e.clientX, e.clientY, _fileDrag.sourcePaneId);
  if (targetId !== _currentTargetPaneId) {
    if (_currentTargetPaneId !== null) {
      panels.get(_currentTargetPaneId)?.setOverlay(false);
    }
    if (targetId !== null) {
      panels.get(targetId)?.setOverlay(true);
    }
    _currentTargetPaneId = targetId;
  }
}

function handleGlobalMouseUp(e: MouseEvent) {
  if (!_fileDrag || !_fileDragActive) {
    cleanupDrag();
    return;
  }

  if (_dragModeLabel && e.shiftKey !== _isShiftHeld) {
    _isShiftHeld = e.shiftKey;
    updateDragModeLabel(_dragModeLabel, e.shiftKey);
  }

  const targetId = findPanelAtPoint(e.clientX, e.clientY, _fileDrag.sourcePaneId);
  if (targetId !== null) {
    const reg = panels.get(targetId);
    if (reg) {
      _fileDrag.isMove = e.shiftKey;
      reg.handleDrop(_fileDrag);
    }
  }

  if (_currentTargetPaneId !== null) {
    panels.get(_currentTargetPaneId)?.setOverlay(false);
  }

  cleanupDrag();
}

function cleanupDrag() {
  _fileDrag = null;
  _fileDragActive = false;
  _currentTargetPaneId = null;
  _dragModeLabel = null;
  _isShiftHeld = false;
  removeDragGhost();
  window.removeEventListener("mousemove", handleGlobalMouseMove);
  window.removeEventListener("mouseup", handleGlobalMouseUp);
  document.removeEventListener("keydown", handleGlobalKeyChange, true);
  document.removeEventListener("keyup", handleGlobalKeyChange, true);
  document.body.style.userSelect = "";
  document.body.style.cursor = "";
}

export function setupSystemDragListeners() {
  if (_systemDragListenersSetup) return;
  _systemDragListenersSetup = true;

  listen<{ position: { x: number; y: number } }>("tauri://drag-over", (event) => {
    const pos = event.payload?.position;
    if (!pos) return;

    const targetId = findPanelAtPointScaled(pos.x, pos.y);

    if (targetId !== _systemDragTargetPaneId) {
      if (_systemDragTargetPaneId !== null) {
        panels.get(_systemDragTargetPaneId)?.setSystemDragOver(false);
      }
      if (targetId !== null) {
        panels.get(targetId)?.setSystemDragOver(true);
      }
      _systemDragTargetPaneId = targetId;
    }
  });

  listen<{ paths: string[]; position: { x: number; y: number } }>("tauri://drag-drop", (event) => {
    const { paths, position } = event.payload;

    for (const [, reg] of panels) {
      reg.setSystemDragOver(false);
    }

    let targetId = position ? findPanelAtPointScaled(position.x, position.y) : null;
    if (targetId === null) targetId = _systemDragTargetPaneId;
    _systemDragTargetPaneId = null;

    if (targetId !== null && paths && paths.length > 0) {
      const reg = panels.get(targetId);
      if (reg) {
        reg.handleSystemDrop(paths);
      }
    }
  });

  listen("tauri://drag-leave", () => {
    for (const [, reg] of panels) {
      reg.setSystemDragOver(false);
    }
    _systemDragTargetPaneId = null;
  });
}

export function startDrag(payload: DragPayload, startX: number, startY: number) {
  _fileDrag = payload;
  _dragStartX = startX;
  _dragStartY = startY;
  _fileDragActive = false;

  window.addEventListener("mousemove", handleGlobalMouseMove);
  window.addEventListener("mouseup", handleGlobalMouseUp);
}

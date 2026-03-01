import { ClipboardData } from "./types";

let _clipboard: ClipboardData | null = null;

export function getClipboard(): ClipboardData | null {
  return _clipboard;
}

export function setClipboard(data: ClipboardData | null) {
  _clipboard = data;
}

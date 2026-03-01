export interface Pane {
  id: number;
  kind: "terminal" | "ssh" | "sftp";
  name: string;
  defaultName: string;
  sessionId: number;
  hostId?: number;
  sftpSource?: { type: "local" } | { type: "remote"; sshSessionId: number };
  sftpInitialPath?: string;
}

export interface Tab {
  id: number;
  layout: import("./layoutTree").LayoutNode;
}

export type DropZone = "left" | "right" | "top" | "bottom";

export function dropZoneToSplit(zone: DropZone): {
  direction: "horizontal" | "vertical";
  position: "before" | "after";
} {
  switch (zone) {
    case "left":   return { direction: "horizontal", position: "before" };
    case "right":  return { direction: "horizontal", position: "after" };
    case "top":    return { direction: "vertical",   position: "before" };
    case "bottom": return { direction: "vertical",   position: "after" };
  }
}

export function computeDropZone(
  mouseX: number,
  mouseY: number,
  rect: DOMRect
): DropZone {
  const relX = (mouseX - rect.left) / rect.width;
  const relY = (mouseY - rect.top) / rect.height;
  const d = { left: relX, right: 1 - relX, top: relY, bottom: 1 - relY };
  const min = Math.min(d.left, d.right, d.top, d.bottom);
  if (min === d.left) return "left";
  if (min === d.right) return "right";
  if (min === d.top) return "top";
  return "bottom";
}

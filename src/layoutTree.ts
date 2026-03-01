export type LayoutNode =
  | { type: "leaf"; paneId: number }
  | {
      type: "split";
      direction: "horizontal" | "vertical";
      children: [LayoutNode, LayoutNode];
      ratio: number;
    };

export type SplitDirection = "horizontal" | "vertical";

export interface Bounds {
  x: number; y: number; w: number; h: number;
}

export interface SeparatorInfo {
  x: number; y: number; w: number; h: number;
  direction: SplitDirection;
  path: number[];
  parentBounds: Bounds;
}

export function splitLeaf(
  tree: LayoutNode,
  targetPaneId: number,
  direction: SplitDirection,
  newPaneId: number,
  position: "before" | "after"
): LayoutNode | null {
  if (tree.type === "leaf") {
    if (tree.paneId !== targetPaneId) return null;
    const orig: LayoutNode = { type: "leaf", paneId: targetPaneId };
    const added: LayoutNode = { type: "leaf", paneId: newPaneId };
    return {
      type: "split", direction,
      children: position === "before" ? [added, orig] : [orig, added],
      ratio: 0.5,
    };
  }
  const l = splitLeaf(tree.children[0], targetPaneId, direction, newPaneId, position);
  if (l) return { ...tree, children: [l, tree.children[1]] };
  const r = splitLeaf(tree.children[1], targetPaneId, direction, newPaneId, position);
  if (r) return { ...tree, children: [tree.children[0], r] };
  return null;
}

export function removeLeaf(
  tree: LayoutNode, paneId: number
): LayoutNode | null | undefined {
  if (tree.type === "leaf") {
    return tree.paneId === paneId ? null : undefined;
  }
  const l = removeLeaf(tree.children[0], paneId);
  if (l === null) return tree.children[1];
  if (l !== undefined) return { ...tree, children: [l, tree.children[1]] };
  const r = removeLeaf(tree.children[1], paneId);
  if (r === null) return tree.children[0];
  if (r !== undefined) return { ...tree, children: [tree.children[0], r] };
  return undefined;
}

export function updateRatio(
  tree: LayoutNode, path: number[], ratio: number
): LayoutNode {
  const clamped = Math.min(0.85, Math.max(0.15, ratio));
  if (path.length === 0) {
    return tree.type === "split" ? { ...tree, ratio: clamped } : tree;
  }
  if (tree.type === "leaf") return tree;
  const [head, ...rest] = path;
  const children: [LayoutNode, LayoutNode] = [...tree.children];
  children[head] = updateRatio(tree.children[head], rest, ratio);
  return { ...tree, children };
}

export function getAllPaneIds(tree: LayoutNode): number[] {
  if (tree.type === "leaf") return [tree.paneId];
  return [...getAllPaneIds(tree.children[0]), ...getAllPaneIds(tree.children[1])];
}

export function isWorkspace(tree: LayoutNode): boolean {
  return tree.type === "split";
}

const SEP = 0.001;

export function calculateBounds(
  node: LayoutNode,
  bounds: Bounds = { x: 0, y: 0, w: 1, h: 1 }
): Map<number, Bounds> {
  if (node.type === "leaf") {
    return new Map([[node.paneId, bounds]]);
  }
  const { direction: dir, ratio, children } = node;
  const gap = SEP;
  const first = dir === "horizontal"
    ? { x: bounds.x, y: bounds.y, w: bounds.w * ratio - gap / 2, h: bounds.h }
    : { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h * ratio - gap / 2 };
  const second = dir === "horizontal"
    ? { x: bounds.x + bounds.w * ratio + gap / 2, y: bounds.y, w: bounds.w * (1 - ratio) - gap / 2, h: bounds.h }
    : { x: bounds.x, y: bounds.y + bounds.h * ratio + gap / 2, w: bounds.w, h: bounds.h * (1 - ratio) - gap / 2 };

  const a = calculateBounds(children[0], first);
  const b = calculateBounds(children[1], second);
  return new Map([...a, ...b]);
}

export function calculateSeparators(
  node: LayoutNode,
  bounds: Bounds = { x: 0, y: 0, w: 1, h: 1 },
  path: number[] = []
): SeparatorInfo[] {
  if (node.type === "leaf") return [];
  const { direction: dir, ratio, children } = node;
  const gap = SEP;

  const sep: SeparatorInfo = dir === "horizontal"
    ? { x: bounds.x + bounds.w * ratio - gap / 2, y: bounds.y, w: gap, h: bounds.h, direction: dir, path, parentBounds: bounds }
    : { x: bounds.x, y: bounds.y + bounds.h * ratio - gap / 2, w: bounds.w, h: gap, direction: dir, path, parentBounds: bounds };

  const firstBounds = dir === "horizontal"
    ? { x: bounds.x, y: bounds.y, w: bounds.w * ratio - gap / 2, h: bounds.h }
    : { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h * ratio - gap / 2 };
  const secondBounds = dir === "horizontal"
    ? { x: bounds.x + bounds.w * ratio + gap / 2, y: bounds.y, w: bounds.w * (1 - ratio) - gap / 2, h: bounds.h }
    : { x: bounds.x, y: bounds.y + bounds.h * ratio + gap / 2, w: bounds.w, h: bounds.h * (1 - ratio) - gap / 2 };

  return [
    sep,
    ...calculateSeparators(children[0], firstBounds, [...path, 0]),
    ...calculateSeparators(children[1], secondBounds, [...path, 1]),
  ];
}
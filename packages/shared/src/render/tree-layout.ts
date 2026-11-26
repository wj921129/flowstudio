import { ANNOT_GAP, TREE_GAP, TREE_VGAP } from './constants.js';
import { analyzeGraphTopology } from './topology.js';
import type { RenderFixed } from './types.js';
import type { XYPosition } from '../types.js';

export interface TreeLayoutInputNode {
  id: string;
  width: number;
  height: number;
  role?: string;
  attachTo?: string;
  fixed?: RenderFixed;
}

export interface TreeLayoutInputEdge {
  from: string;
  to: string;
  kind?: string;
}

export interface TreeLayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TreeLayoutResult {
  positions: Map<string, TreeLayoutBox>;
  depths: Map<string, number>;
  backEdgeKeys: Set<string>;
  warnings: string[];
}

export function layoutTreeGraph(
  nodes: readonly TreeLayoutInputNode[],
  edges: readonly TreeLayoutInputEdge[],
  opts?: { origin?: XYPosition; hGap?: number; vGap?: number; annotGap?: number },
): TreeLayoutResult {
  const origin = opts?.origin ?? { x: 50, y: 50 };
  const hGap = opts?.hGap ?? TREE_GAP;
  const vGap = opts?.vGap ?? TREE_VGAP;
  const annotGap = opts?.annotGap ?? TREE_GAP;
  const warnings: string[] = [];

  const topo = analyzeGraphTopology(nodes, edges);
  const { bizNodes, annotNodes, backEdgeKeys, adj, parents, layerOf: depths } = topo;
  const bizById = new Map(bizNodes.map((n) => [n.id, n]));
  if (backEdgeKeys.size > 0) {
    warnings.push(`tree 检测到 ${backEdgeKeys.size} 条环回边，已破环分层并保留连线`);
  }

  const sharedIds = new Set(bizNodes.filter((n) => (parents.get(n.id)?.length ?? 0) > 1).map((n) => n.id));
  const treeChildren = new Map<string, string[]>();
  for (const n of bizNodes) {
    treeChildren.set(
      n.id,
      (adj.get(n.id) ?? []).map((item) => item.to).filter((c) => !sharedIds.has(c)),
    );
  }

  const subMemo = new Map<string, number>();
  const subW = (id: string): number => {
    const hit = subMemo.get(id);
    if (hit !== undefined) return hit;
    const kids = treeChildren.get(id) ?? [];
    const kidsW = kids.length > 0 ? kids.reduce((acc, k) => acc + subW(k), 0) + hGap * (kids.length - 1) : 0;
    const node = bizById.get(id)!;
    const w = node.fixed ? node.fixed.width : node.width;
    const res = Math.max(w, kidsW);
    subMemo.set(id, res);
    return res;
  };

  const positions = new Map<string, TreeLayoutBox>();
  const placeSubtree = (id: string, left: number) => {
    const node = bizById.get(id)!;
    const sw = subW(id);
    const f = node.fixed;
    positions.set(
      id,
      f
        ? { x: f.position.x, y: f.position.y, width: f.width, height: f.height }
        : { x: left + (sw - node.width) / 2, y: 0, width: node.width, height: node.height },
    );
    let cl = left;
    for (const kid of treeChildren.get(id) ?? []) {
      placeSubtree(kid, cl);
      cl += subW(kid) + hGap;
    }
  };

  let left = origin.x;
  for (const root of bizNodes.filter((n) => (parents.get(n.id)?.length ?? 0) === 0)) {
    placeSubtree(root.id, left);
    left += subW(root.id) + hGap;
  }

  const shiftSubtree = (id: string, dx: number) => {
    if (Math.abs(dx) < 0.01) return;
    const node = bizById.get(id);
    const box = positions.get(id);
    if (node && box && !node.fixed) {
      box.x += dx;
    }
    for (const kid of treeChildren.get(id) ?? []) {
      shiftSubtree(kid, dx);
    }
  };

  const recenterShared = (sNodeId: string) => {
    const sNode = bizById.get(sNodeId)!;
    const parentCenters = (parents.get(sNodeId) ?? [])
      .map((pid) => positions.get(pid))
      .filter((b): b is TreeLayoutBox => Boolean(b))
      .map((b) => b.x + b.width / 2);
    const idealCx =
      parentCenters.length > 0
        ? parentCenters.reduce((acc, c) => acc + c, 0) / parentCenters.length
        : origin.x + sNode.width / 2;
    placeSubtree(sNodeId, idealCx - subW(sNodeId) / 2);
  };

  for (const sNode of bizNodes.filter((n) => sharedIds.has(n.id)).sort((a, b) => (depths.get(a.id) ?? 0) - (depths.get(b.id) ?? 0))) {
    recenterShared(sNode.id);
  }

  const maxDepth = bizNodes.reduce((m, n) => Math.max(m, depths.get(n.id) ?? 0), 0);
  for (let d = 0; d <= maxDepth; d++) {
    for (const sNode of bizNodes.filter((n) => depths.get(n.id) === d && sharedIds.has(n.id))) {
      recenterShared(sNode.id);
    }
    const rowIds = bizNodes
      .filter((n) => depths.get(n.id) === d && positions.has(n.id))
      .map((n) => n.id)
      .sort((a, b) => positions.get(a)!.x - positions.get(b)!.x);
    const fixedOnRow = rowIds.filter((id) => Boolean(bizById.get(id)?.fixed)).map((id) => positions.get(id)!);
    let cursorX = -Infinity;
    for (const currId of rowIds) {
      const curr = positions.get(currId)!;
      if (bizById.get(currId)?.fixed) {
        cursorX = Math.max(cursorX, curr.x + curr.width + hGap);
        continue;
      }
      let nextX = Math.max(curr.x, cursorX);
      let guard = 0;
      while (guard++ < 100) {
        const hit = fixedOnRow.find((fb) => nextX < fb.x + fb.width + hGap && fb.x < nextX + curr.width + hGap);
        if (!hit) break;
        nextX = hit.x + hit.width + hGap;
      }
      if (nextX > curr.x) shiftSubtree(currId, nextX - curr.x);
      cursorX = Math.max(cursorX, positions.get(currId)!.x + curr.width + hGap);
    }
  }

  const rowH = new Map<number, number>();
  for (const n of bizNodes) {
    const d = depths.get(n.id) ?? 0;
    const b = positions.get(n.id);
    if (b) rowH.set(d, Math.max(rowH.get(d) ?? 0, b.height));
  }
  const rowY = new Map<number, number>();
  let cursor = origin.y;
  for (let d = 0; d <= maxDepth; d++) {
    rowY.set(d, cursor);
    cursor += (rowH.get(d) ?? 0) + vGap;
  }
  for (const n of bizNodes) {
    if (n.fixed) continue;
    const b = positions.get(n.id);
    if (b) b.y = rowY.get(depths.get(n.id) ?? 0) ?? origin.y;
  }

  const taken: TreeLayoutBox[] = [...positions.values()];
  const overlaps = (a: TreeLayoutBox, b: TreeLayoutBox) =>
    a.x < b.x + b.width + ANNOT_GAP &&
    b.x < a.x + a.width + ANNOT_GAP &&
    a.y < b.y + b.height + ANNOT_GAP &&
    b.y < a.y + a.height + ANNOT_GAP;

  const sortedAnnots = [...annotNodes].sort((a, b) => {
    const ha = positions.get(a.attachTo!);
    const hb = positions.get(b.attachTo!);
    return (ha?.y ?? 0) - (hb?.y ?? 0) || (ha?.x ?? 0) - (hb?.x ?? 0);
  });

  for (const a of sortedAnnots) {
    if (a.fixed) {
      const box = { x: a.fixed.position.x, y: a.fixed.position.y, width: a.fixed.width, height: a.fixed.height };
      positions.set(a.id, box);
      taken.push(box);
      continue;
    }
    const host = positions.get(a.attachTo!)!;
    const rightX = host.x + host.width + annotGap;
    const leftX = host.x - annotGap - a.width;
    let x = rightX;
    let y = host.y;
    if (taken.some((b) => overlaps({ x: rightX, y, width: a.width, height: a.height }, b)) && leftX >= origin.x) {
      if (!taken.some((b) => overlaps({ x: leftX, y, width: a.width, height: a.height }, b))) {
        x = leftX;
      }
    }
    let guard = 0;
    while (taken.some((b) => overlaps({ x, y, width: a.width, height: a.height }, b)) && guard++ < 200) {
      y += a.height + ANNOT_GAP;
    }
    const box = { x, y, width: a.width, height: a.height };
    positions.set(a.id, box);
    taken.push(box);
  }

  return { positions, depths, backEdgeKeys, warnings };
}

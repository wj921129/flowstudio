import { getDefaultNodeSize } from '../node-registry.js';
import type { NormalizedSpec } from '../spec/normalize.js';
import type { FlowEdge, FlowNode, FlowNodeType } from '../types.js';
import { TREE_GAP, TREE_VGAP } from './constants.js';
import type { RenderContext, RenderResult } from './types.js';

export function renderTree(n: NormalizedSpec, ctx: RenderContext): RenderResult {
  const warnings = [...n.warnings];
  if (ctx.fixed.size > 0) warnings.push('tree 暂不支持 fixed 让位，锁节点保持原坐标');
  const eid = (id: string) => ctx.idPrefix + id;
  const nodeOf = (id: string) => n.nodes.find((x) => x.id === id)!;
  const sizeOf = (id: string) => getDefaultNodeSize(nodeOf(id).type ?? 'process');
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const e of n.edges) {
    children.set(e.from, [...(children.get(e.from) ?? []), e.to]);
    hasParent.add(e.to);
  }
  const subMemo = new Map<string, number>();
  const subW = (id: string): number => {
    const hit = subMemo.get(id);
    if (hit !== undefined) return hit;
    const kids = children.get(id) ?? [];
    const w = kids.length > 0 ? kids.reduce((acc, k) => acc + subW(k), 0) + TREE_GAP * (kids.length - 1) : 0;
    const res = Math.max(sizeOf(id).width, w);
    subMemo.set(id, res);
    return res;
  };
  const pos = new Map<string, { x: number; y: number; width: number; height: number }>();
  const depthOf = new Map<string, number>();
  const place = (id: string, left: number, depth: number) => {
    const sw = subW(id);
    const s = sizeOf(id);
    const f = ctx.fixed.get(id);
    pos.set(id, f ? { x: f.position.x, y: f.position.y, width: f.width, height: f.height } : { x: left + (sw - s.width) / 2, y: 0, width: s.width, height: s.height });
    depthOf.set(id, depth);
    let cl = left;
    for (const kid of children.get(id) ?? []) {
      place(kid, cl, depth + 1);
      cl += subW(kid) + TREE_GAP;
    }
  };
  let left = ctx.origin.x;
  for (const root of n.nodes.filter((x) => !hasParent.has(x.id))) {
    place(root.id, left, 0);
    left += subW(root.id) + TREE_GAP;
  }
  const rowH = new Map<number, number>();
  for (const [id, d] of depthOf) rowH.set(d, Math.max(rowH.get(d) ?? 0, pos.get(id)!.height));
  const rowY = new Map<number, number>();
  let cursor = ctx.origin.y;
  for (const d of [...rowH.keys()].sort((a, b) => a - b)) {
    rowY.set(d, cursor);
    cursor += rowH.get(d)! + TREE_VGAP;
  }
  const nodes: FlowNode[] = [];
  for (const [id, p] of pos) {
    const src = nodeOf(id);
    const type: FlowNodeType = src.type ?? 'process';
    nodes.push({ id: eid(id), type, position: { x: p.x, y: rowY.get(depthOf.get(id)!)! }, width: p.width, height: p.height, data: { label: src.label, type, role: src.role } });
  }
  const edges: FlowEdge[] = n.edges.map((e) => ({
    id: `${ctx.idPrefix}e-${e.from}-${e.to}-${e.kind}`,
    source: eid(e.from),
    target: eid(e.to),
    type: 'orthogonal',
    sourceHandle: 'bottom',
    targetHandle: 'top',
    data: { kind: e.kind, ...(e.label ? { label: e.label } : {}) },
  }));
  return { nodes, edges, warnings };
}
import { getDefaultNodeSize } from '../node-registry.js';
import type { NormalizedSpec } from '../spec/normalize.js';
import type { FlowEdge, FlowNode, FlowNodeType } from '../types.js';
import { TIER_GAP, TIER_VGAP } from './constants.js';
import type { RenderContext, RenderResult } from './types.js';

export function renderTiered(n: NormalizedSpec, ctx: RenderContext): RenderResult {
  const warnings = [...n.warnings];
  if (ctx.fixed.size > 0) warnings.push('tiered-dag 暂不支持 fixed 让位，锁节点保持原坐标');
  const eid = (id: string) => ctx.idPrefix + id;
  const nodeOf = (id: string) => n.nodes.find((x) => x.id === id)!;
  const sizeOf = (id: string) => getDefaultNodeSize(nodeOf(id).type ?? 'process');
  const incoming = new Map<string, string[]>();
  for (const e of n.edges) {
    const list = incoming.get(e.to) ?? [];
    list.push(e.from);
    incoming.set(e.to, list);
  }
  const memo = new Map<string, number>();
  const layer = (id: string): number => {
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
    const ins = incoming.get(id) ?? [];
    const l = ins.length > 0 ? Math.max(...ins.map(layer)) + 1 : 0;
    memo.set(id, l);
    return l;
  };
  for (const x of n.nodes) layer(x.id);
  const rows = new Map<number, string[]>();
  for (const x of n.nodes) {
    const l = memo.get(x.id)!;
    rows.set(l, [...(rows.get(l) ?? []), x.id]);
  }
  const rowWidth = (ids: string[]) => ids.reduce((acc, id) => acc + sizeOf(id).width, 0) + TIER_GAP * (ids.length - 1);
  const maxRowW = Math.max(0, ...[...rows.values()].map(rowWidth));
  const centerX = ctx.origin.x + maxRowW / 2;
  const pos = new Map<string, { x: number; y: number; width: number; height: number }>();
  let cursor = ctx.origin.y;
  for (const l of [...rows.keys()].sort((a, b) => a - b)) {
    const ids = rows.get(l)!;
    const rowH = Math.max(...ids.map((id) => sizeOf(id).height));
    let x = centerX - rowWidth(ids) / 2;
    for (const id of ids) {
      const f = ctx.fixed.get(id);
      const s = sizeOf(id);
      pos.set(id, f ? { x: f.position.x, y: f.position.y, width: f.width, height: f.height } : { x, y: cursor, width: s.width, height: s.height });
      x += s.width + TIER_GAP;
    }
    cursor += rowH + TIER_VGAP;
  }
  const nodes: FlowNode[] = [];
  for (const [id, p] of pos) {
    const src = nodeOf(id);
    const type: FlowNodeType = src.type ?? 'process';
    nodes.push({ id: eid(id), type, position: { x: p.x, y: p.y }, width: p.width, height: p.height, data: { label: src.label, type, role: src.role } });
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
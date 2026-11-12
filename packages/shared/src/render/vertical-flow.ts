import { getDefaultNodeSize } from '../node-registry.js';
import type { NormalizedSpec } from '../spec/normalize.js';
import type { SpecNode } from '../spec/types.js';
import type { FlowEdge, FlowNode, FlowNodeType, XYPosition } from '../types.js';
import { BRANCH_GAP, BRANCH_VGAP, LOOP_RISE, LOOP_SIDE, MAIN_GAP } from './constants.js';
import type { RenderContext, RenderResult } from './types.js';

type Box = { x: number; y: number; width: number; height: number };

export function flowSizeOf(n: SpecNode & { role: string }): { width: number; height: number } {
  return getDefaultNodeSize(n.type ?? (n.role === 'annotation' ? 'comment' : 'process'));
}

export function renderVerticalFlow(n: NormalizedSpec, ctx: RenderContext): RenderResult {
  const warnings = [...n.warnings];
  const pos = new Map<string, Box>();
  const eid = (id: string) => ctx.idPrefix + id;
  const nodeOf = (id: string) => n.nodes.find((x) => x.id === id)!;
  const fixedBox = (id: string): Box | undefined => {
    const f = ctx.fixed.get(id);
    return f ? { x: f.position.x, y: f.position.y, width: f.width, height: f.height } : undefined;
  };
  const hitFixed = (x: number, y: number, w: number, h: number) => {
    for (const f of ctx.fixed.values()) {
      if (x < f.position.x + f.width && f.position.x < x + w && y < f.position.y + f.height && f.position.y < y + h) return f;
    }
    return undefined;
  };
  const avoid = (x: number, y: number, w: number, h: number) => {
    let yy = y;
    let f = hitFixed(x, yy, w, h);
    let guard = 0;
    while (f && guard++ < 1000) {
      yy = f.position.y + f.height + MAIN_GAP;
      f = hitFixed(x, yy, w, h);
    }
    return yy;
  };

  const mains = n.mainOrder.map(nodeOf);
  const maxMainW = Math.max(0, ...mains.map((m) => flowSizeOf(m).width));
  const CX = ctx.origin.x + maxMainW / 2;
  const trunkRight = CX + maxMainW / 2;
  let cursor = ctx.origin.y;
  for (const m of mains) {
    const f = fixedBox(m.id);
    if (f) {
      pos.set(m.id, f);
      cursor = Math.max(cursor, f.y + f.height + MAIN_GAP);
      continue;
    }
    const s = flowSizeOf(m);
    const y = avoid(CX - s.width / 2, cursor, s.width, s.height);
    pos.set(m.id, { x: CX - s.width / 2, y, width: s.width, height: s.height });
    cursor = y + s.height + MAIN_GAP;
  }

  const groups = new Map<string, string[]>();
  for (const e of n.edges) {
    if (e.kind !== 'branch') continue;
    const list = groups.get(e.from) ?? [];
    list.push(e.to);
    groups.set(e.from, list);
  }
  const placed = new Set<string>();
  let RC = ctx.origin.y;
  const layoutBlock = (roots: string[], fromId: string) => {
    const rel = new Map<string, number>();
    const members: string[] = [];
    let y = 0;
    let blockW = 0;
    const walk = (id: string) => {
      if (placed.has(id)) return;
      placed.add(id);
      const s = fixedBox(id) ?? flowSizeOf(nodeOf(id));
      rel.set(id, y);
      members.push(id);
      blockW = Math.max(blockW, s.width);
      y += s.height + BRANCH_VGAP;
      for (const e of n.edges) if (e.from === id && (e.kind === 'next' || e.kind === 'branch')) walk(e.to);
    };
    roots.forEach(walk);
    if (members.length === 0) return;
    const blockH = y - BRANCH_VGAP;
    const from = pos.get(fromId)!;
    const firstW = (fixedBox(roots[0]) ?? flowSizeOf(nodeOf(roots[0]))).width;
    let center = from.x + from.width + BRANCH_GAP + firstW / 2;
    const leftmost = center - blockW / 2;
    if (leftmost < trunkRight + MAIN_GAP) center += trunkRight + MAIN_GAP - leftmost;
    let blockY = Math.max(from.y + from.height / 2 - (fixedBox(roots[0]) ?? flowSizeOf(nodeOf(roots[0]))).height / 2, RC);
    blockY = avoid(center - blockW / 2, blockY, blockW, blockH);
    RC = blockY + blockH + BRANCH_VGAP;
    for (const id of members) {
      const f = fixedBox(id);
      const s = f ?? flowSizeOf(nodeOf(id));
      pos.set(id, f ?? { x: center - s.width / 2, y: blockY + rel.get(id)!, width: s.width, height: s.height });
    }
  };
  let pending = [...groups.entries()];
  let guard = 0;
  while (pending.length > 0 && guard++ < 1000) {
    const ready = pending.filter(([fromId]) => pos.has(fromId));
    if (ready.length === 0) break;
    for (const [fromId, roots] of ready) layoutBlock(roots.filter((r) => !placed.has(r)), fromId);
    pending = pending.filter(([fromId]) => !ready.some(([f]) => f === fromId));
  }

  const nodes: FlowNode[] = [];
  for (const [id, p] of pos) {
    const src = nodeOf(id);
    const type: FlowNodeType = src.type ?? (src.role === 'annotation' ? 'comment' : 'process');
    nodes.push({
      id: eid(id),
      type,
      position: { x: p.x, y: p.y },
      width: p.width,
      height: p.height,
      data: {
        label: src.label,
        type,
        role: src.role,
        ...(src.description ? { description: src.description } : {}),
        ...(src.attachTo ? { attachTo: eid(src.attachTo) } : {}),
      },
    });
  }
  for (const src of n.nodes) {
    if (!pos.has(src.id)) warnings.push(`节点 ${src.id} 未参与 vertical-flow 布局（附注几何由 timeline 规则承载）`);
  }

  const edges: FlowEdge[] = [];
  for (const e of n.edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) {
      warnings.push(`连线 ${e.from} -> ${e.to} 端点未布局，跳过`);
      continue;
    }
    let sourceHandle = 'bottom';
    let targetHandle = 'top';
    let waypoints: XYPosition[] | undefined;
    if (e.kind === 'loop') {
      sourceHandle = 'top';
      targetHandle = 'right';
      const riseY = Math.min(a.y, b.y) - LOOP_RISE;
      const sideX = b.x + b.width + LOOP_SIDE;
      waypoints = [
        { x: a.x + a.width / 2, y: riseY },
        { x: sideX, y: riseY },
        { x: sideX, y: b.y + b.height / 2 },
      ];
    } else if (e.kind === 'annotate') {
      sourceHandle = 'right';
      targetHandle = 'left';
    } else if (b.x >= a.x + a.width) {
      sourceHandle = 'right';
      targetHandle = 'left';
    }
    edges.push({
      id: `${ctx.idPrefix}e-${e.from}-${e.to}-${e.kind}`,
      source: eid(e.from),
      target: eid(e.to),
      type: 'orthogonal',
      sourceHandle,
      targetHandle,
      data: { kind: e.kind, ...(e.label ? { label: e.label } : {}), ...(waypoints ? { waypoints } : {}) },
    });
  }
  return { nodes, edges, warnings };
}
import { getDefaultNodeSize } from '../node-registry.js';
import type { NormalizedSpec } from '../spec/normalize.js';
import type { SpecNode } from '../spec/types.js';
import type { FlowEdge, FlowNode, FlowNodeType, XYPosition } from '../types.js';
import { ANNOT_COL_GAP, ANNOT_COL_SIZE, ANNOT_GAP, BRANCH_GAP, BRANCH_VGAP, GRID_COL_GAP, LOOP_RISE, LOOP_SIDE, MAIN_GAP, REG_LANE, REG_LANE_STEP, REG_STUB } from './constants.js';
import type { RenderContext, RenderResult } from './types.js';

type Box = { x: number; y: number; width: number; height: number };

export function flowSizeOf(n: SpecNode & { role: string }): { width: number; height: number } {
  return getDefaultNodeSize(n.type ?? (n.role === 'annotation' ? 'comment' : 'process'));
}

export function renderVerticalFlowGrid(n: NormalizedSpec, ctx: RenderContext): RenderResult {
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
  const anchorOf = (id: string): string => {
    let cur = id;
    const seen = new Set<string>();
    while (!seen.has(cur)) {
      seen.add(cur);
      if (nodeOf(cur).role === 'main') return cur;
      const inc = n.edges.find((e) => (e.kind === 'branch' || e.kind === 'next') && e.to === cur);
      if (!inc) return cur;
      cur = inc.from;
    }
    return cur;
  };

  const mains = n.mainOrder.map(nodeOf);
  const maxMainW = Math.max(0, ...mains.map((m) => flowSizeOf(m).width));
  const CX = ctx.origin.x + maxMainW / 2;
  const trunkLeft = CX - maxMainW / 2;
  const trunkRight = CX + maxMainW / 2;
  let cursor = ctx.origin.y;
  let annotCursor = ctx.origin.y;

  const groups = new Map<string, string[]>();
  for (const e of n.edges) {
    if (e.kind !== 'branch') continue;
    const list = groups.get(e.from) ?? [];
    list.push(e.to);
    groups.set(e.from, list);
  }
  const placed = new Set<string>();

  const layoutBlock = (roots: string[], fromId: string) => {
    const cell = new Map<string, { r: number; c: number }>();
    const occ = new Set<string>();
    const members: string[] = [];
    const place = (id: string, r: number, c: number) => {
      if (cell.has(id) || placed.has(id) || nodeOf(id).role === 'main') return;
      while (occ.has(`${r},${c}`)) c++;
      occ.add(`${r},${c}`);
      cell.set(id, { r, c });
      members.push(id);
      placed.add(id);
      for (const e of n.edges) {
        if (e.from !== id) continue;
        if (e.kind === 'next') place(e.to, r + 1, c);
        else if (e.kind === 'branch') {
          const term = (nodeOf(e.to).type ?? 'process') === 'start-end';
          place(e.to, term ? r + 1 : r, c + 1);
        }
      }
    };
    if (roots.length <= 1) {
      roots.forEach((rt, i) => place(rt, 0, i));
    } else {
      let nextRow = 0;
      for (const rt of roots) {
        place(rt, nextRow, 0);
        let maxR = nextRow;
        for (const v of cell.values()) if (v.r > maxR) maxR = v.r;
        nextRow = maxR + 1;
      }
    }
    if (members.length === 0) return;
    const colW = new Map<number, number>();
    const rowH = new Map<number, number>();
    for (const id of members) {
      const s = fixedBox(id) ?? flowSizeOf(nodeOf(id));
      const { r, c } = cell.get(id)!;
      colW.set(c, Math.max(colW.get(c) ?? 0, s.width));
      rowH.set(r, Math.max(rowH.get(r) ?? 0, s.height));
    }
    const from = pos.get(fromId)!;
    const colX = new Map<number, number>();
    const maxLabelLen = roots.length > 1
      ? Math.max(0, ...roots.map((rt) => (n.edges.find((e) => e.from === fromId && e.to === rt && e.kind === 'branch')?.label ?? '').length))
      : 0;
    const firstGap = roots.length > 1 ? Math.max(BRANCH_GAP, Math.min(220, maxLabelLen * 11 + 56)) : BRANCH_GAP;
    let x = from.x + from.width + firstGap;
    for (const c of [...colW.keys()].sort((a, b) => a - b)) {
      colX.set(c, x);
      x += colW.get(c)! + GRID_COL_GAP;
    }
    const rowY = new Map<number, number>();
    let y = from.y + from.height / 2 - (rowH.get(0) ?? 0) / 2;
    for (const r of [...rowH.keys()].sort((a, b) => a - b)) {
      rowY.set(r, y);
      y += rowH.get(r)! + BRANCH_VGAP;
    }
    let blockBottom = 0;
    for (const id of members) {
      const f = fixedBox(id);
      const s = f ?? flowSizeOf(nodeOf(id));
      const { r, c } = cell.get(id)!;
      const px = f ? f.x : colX.get(c)!;
      const py = f ? f.y : rowY.get(r)!;
      pos.set(id, { x: px, y: py, width: s.width, height: s.height });
      blockBottom = Math.max(blockBottom, py + s.height);
    }
    cursor = Math.max(cursor, blockBottom + MAIN_GAP);
  };

  for (const m of mains) {
    const anns = n.nodes.filter((x) => x.role === 'annotation' && x.attachTo === m.id);
    const cols: Array<Array<typeof anns[number]>> = [];
    for (let i = 0; i < anns.length; i += ANNOT_COL_SIZE) cols.push(anns.slice(i, i + ANNOT_COL_SIZE));
    const colMetrics = cols.map((col) => {
      const sizes = col.map((a) => fixedBox(a.id) ?? flowSizeOf(a));
      return {
        w: Math.max(...sizes.map((s) => s.width)),
        h: sizes.reduce((acc, s) => acc + s.height, 0) + ANNOT_GAP * (sizes.length - 1),
      };
    });
    const blockH = Math.max(0, ...colMetrics.map((c) => c.h));
    const f = fixedBox(m.id);
    const s = f ?? flowSizeOf(m);
    let y: number;
    if (f) {
      y = f.y;
      cursor = Math.max(cursor, f.y + f.height + MAIN_GAP);
    } else {
      y = avoid(CX - s.width / 2, cursor, s.width, s.height);
      cursor = y + s.height + MAIN_GAP;
    }
    pos.set(m.id, { x: f ? f.x : CX - s.width / 2, y, width: s.width, height: s.height });
    const blockTop = cols.length > 0 ? Math.max(annotCursor, y + s.height / 2 - blockH / 2) : 0;
    let colRight = trunkLeft - BRANCH_GAP;
    cols.forEach((col, ci) => {
      const colLeft = colRight - colMetrics[ci].w;
      let ay = blockTop;
      for (const a of col) {
        const af = fixedBox(a.id);
        const as = af ?? flowSizeOf(a);
        pos.set(a.id, af ?? { x: colLeft + (colMetrics[ci].w - as.width) / 2, y: ay, width: as.width, height: as.height });
        ay += as.height + ANNOT_GAP;
      }
      colRight = colLeft - ANNOT_COL_GAP;
    });
    if (cols.length > 0) annotCursor = blockTop + blockH + ANNOT_GAP;
    const roots = (groups.get(m.id) ?? []).filter((r) => !placed.has(r));
    if (roots.length > 0) layoutBlock(roots, m.id);
  }

  let pending = [...groups.entries()].filter(([fromId]) => nodeOf(fromId).role !== 'main');
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
    if (!pos.has(src.id)) warnings.push(`节点 ${src.id} 未参与布局，跳过`);
  }

  const edges: FlowEdge[] = [];
  const maxRight = Math.max(0, ...[...pos.values()].map((p) => p.x + p.width));
  let jumpLane = 0;
  let regLane = 0;
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
    const regression = e.kind === 'loop' && nodeOf(e.from).role === 'branch' && nodeOf(e.to).role === 'main' && anchorOf(e.from) === e.to;
    if (regression) {
      const laneX = trunkRight + REG_LANE + regLane++ * REG_LANE_STEP;
      sourceHandle = 'left';
      targetHandle = 'right';
      waypoints = [
        { x: laneX, y: a.y + a.height / 2 },
        { x: laneX, y: b.y + b.height / 2 + REG_STUB },
        { x: trunkRight + REG_STUB, y: b.y + b.height / 2 + REG_STUB },
        { x: trunkRight + REG_STUB, y: b.y + b.height / 2 },
      ];
    } else if (e.kind === 'loop') {
      const fromMain = nodeOf(e.from).role === 'main';
      const sideX = Math.max(a.x + a.width, b.x + b.width) + LOOP_SIDE;
      const riseY = Math.min(a.y, b.y) - LOOP_RISE;
      if (fromMain) {
        sourceHandle = 'right';
        targetHandle = 'right';
        waypoints = [
          { x: sideX, y: a.y + a.height / 2 },
          { x: sideX, y: riseY },
          { x: sideX, y: b.y + b.height / 2 },
        ];
      } else {
        sourceHandle = 'top';
        targetHandle = 'right';
        waypoints = [
          { x: a.x + a.width / 2, y: riseY },
          { x: sideX, y: riseY },
          { x: sideX, y: b.y + b.height / 2 },
        ];
      }
    } else if (e.kind === 'jump') {
      sourceHandle = 'right';
      targetHandle = 'right';
      const sideX = maxRight + LOOP_SIDE * ++jumpLane;
      waypoints = [
        { x: sideX, y: a.y + a.height / 2 },
        { x: sideX, y: b.y + b.height / 2 },
      ];
    } else if (e.kind === 'annotate') {
      sourceHandle = 'left';
      targetHandle = 'right';
      const midX = trunkLeft - BRANCH_GAP / 2;
      waypoints = [
        { x: midX, y: a.y + a.height / 2 },
        { x: midX, y: b.y + b.height / 2 },
      ];
    } else if (e.kind === 'next' && nodeOf(e.from).role === 'branch' && nodeOf(e.to).role === 'main' && b.y >= a.y + a.height) {
      const mergeX = maxRight + REG_LANE;
      sourceHandle = 'right';
      targetHandle = 'right';
      waypoints = [
        { x: mergeX, y: a.y + a.height / 2 },
        { x: mergeX, y: b.y + b.height / 2 },
      ];
    } else if (b.x >= a.x + a.width) {
      sourceHandle = 'right';
      targetHandle = 'left';
      if (Math.abs(b.y + b.height / 2 - (a.y + a.height / 2)) > 1) {
        const busX = a.x + a.width + REG_STUB * 2;
        waypoints = [
          { x: busX, y: a.y + a.height / 2 },
          { x: busX, y: b.y + b.height / 2 },
        ];
      }
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
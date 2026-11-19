import { getDefaultNodeSize } from '../node-registry.js';
import type { NormalizedSpec } from '../spec/normalize.js';
import type { SpecNode } from '../spec/types.js';
import type { FlowEdge, FlowNode, FlowNodeType } from '../types.js';
import { ANNOT_GAP, BRANCH_VGAP, LANE_HEADER, LANE_PAD, MAIN_GAP } from './constants.js';
import type { RenderContext, RenderResult } from './types.js';
import { renderVerticalFlow } from './vertical-flow.js';

type Box = { x: number; y: number; width: number; height: number };

function sizeOfNode(node: SpecNode & { role: string }): { width: number; height: number } {
  return getDefaultNodeSize(node.type ?? (node.role === 'annotation' ? 'comment' : 'process'));
}

export function renderSwimlane(n: NormalizedSpec, ctx: RenderContext): RenderResult {
  const laneOf = new Map(n.nodes.map((x) => [x.id, x.laneId!]));
  const mainLanes = new Set(n.mainOrder.map((id) => laneOf.get(id)));
  if (mainLanes.size === 1) return renderHorizontalTrunk(n, ctx);
  return renderCrossLaneFlow(n, ctx);
}

function renderHorizontalTrunk(n: NormalizedSpec, ctx: RenderContext): RenderResult {
  const warnings = [...n.warnings];
  const eid = (id: string) => ctx.idPrefix + id;
  const nodeOf = (id: string) => n.nodes.find((x) => x.id === id)!;
  const laneOf = new Map(n.nodes.map((x) => [x.id, x.laneId!]));

  const fixedOf = (id: string): Box | undefined => {
    const f = ctx.fixed.get(id);
    return f ? { x: f.position.x, y: f.position.y, width: f.width, height: f.height } : undefined;
  };
  const sizeOf = (id: string) => sizeOfNode(nodeOf(id));
  const boxOf = (id: string): Box => {
    const f = fixedOf(id);
    if (f) return f;
    const s = sizeOf(id);
    return { x: 0, y: 0, width: s.width, height: s.height };
  };

  const pos = new Map<string, Box>();
  const mains = n.mainOrder.map(nodeOf);
  const branches = n.nodes.filter((x) => x.role === 'branch');
  const flowsBackToTrunk = (id: string) => n.edges.some(
    (e) => e.from === id && (e.kind === 'next' || e.kind === 'loop') && nodeOf(e.to).role === 'main',
  );
  const mergeBranches = branches.filter((b) => flowsBackToTrunk(b.id));
  const endBranches = branches.filter((b) => !flowsBackToTrunk(b.id));

  const topBand = mergeBranches.length > 0
    ? Math.max(...mergeBranches.map((b) => boxOf(b.id).height)) + BRANCH_VGAP
    : 0;
  const mainTop = LANE_PAD + topBand;

  let cursor = LANE_PAD;
  let mainHeight = 0;
  for (const m of mains) {
    const f = fixedOf(m.id);
    const box = boxOf(m.id);
    const x = f ? f.x : cursor;
    pos.set(m.id, { x, y: f ? f.y : mainTop, width: box.width, height: box.height });
    mainHeight = Math.max(mainHeight, box.height);
    cursor = x + box.width + MAIN_GAP;
  }
  const mainBottom = mainTop + mainHeight;

  const branchAnchorX = (id: string, width: number): number => {
    const src = n.edges.find((e) => e.kind === 'branch' && e.to === id);
    const host = src ? pos.get(src.from) : undefined;
    if (!host) return LANE_PAD;
    return host.x + (host.width - width) / 2;
  };
  for (const b of mergeBranches) {
    const f = fixedOf(b.id);
    const box = boxOf(b.id);
    pos.set(b.id, {
      x: f ? f.x : branchAnchorX(b.id, box.width),
      y: f ? f.y : LANE_PAD,
      width: box.width,
      height: box.height,
    });
  }
  for (const b of endBranches) {
    const f = fixedOf(b.id);
    const box = boxOf(b.id);
    pos.set(b.id, {
      x: f ? f.x : branchAnchorX(b.id, box.width),
      y: f ? f.y : mainBottom + BRANCH_VGAP,
      width: box.width,
      height: box.height,
    });
  }

  const overlaps = (a: Box, b: Box) =>
    a.x < b.x + b.width + ANNOT_GAP && b.x < a.x + a.width + ANNOT_GAP
    && a.y < b.y + b.height + ANNOT_GAP && b.y < a.y + a.height + ANNOT_GAP;
  for (const lane of n.lanes) {
    const annots = n.nodes.filter((x) => x.role === 'annotation' && laneOf.get(x.id) === lane.id);
    const ordered = [...annots].sort((a, b) => (pos.get(a.attachTo!)?.x ?? 0) - (pos.get(b.attachTo!)?.x ?? 0));
    const taken: Box[] = [];
    for (const a of ordered) {
      const f = fixedOf(a.id);
      if (f) {
        pos.set(a.id, f);
        taken.push(f);
        continue;
      }
      const host = pos.get(a.attachTo!);
      if (!host) {
        warnings.push(`附注 ${a.id} 的宿主 ${a.attachTo} 未参与布局，跳过`);
        continue;
      }
      const s = sizeOf(a.id);
      const x = host.x + (host.width - s.width) / 2;
      let y = LANE_PAD;
      let guard = 0;
      while (taken.some((p) => overlaps({ x, y, width: s.width, height: s.height }, p)) && guard++ < 200) {
        y += s.height + ANNOT_GAP;
      }
      const placed = { x, y, width: s.width, height: s.height };
      taken.push(placed);
      pos.set(a.id, placed);
    }
  }

  for (const src of n.nodes) {
    if (!pos.has(src.id)) warnings.push(`节点 ${src.id} 未参与布局，跳过`);
  }

  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const poolId = eid('pool');
  let frameY = LANE_HEADER;
  let poolW = 800;

  for (const lane of n.lanes) {
    const members = n.nodes.filter((x) => x.laneId === lane.id);
    let right = 0;
    let bottom = 0;
    for (const m of members) {
      const p = pos.get(m.id);
      if (!p) continue;
      right = Math.max(right, p.x + p.width);
      bottom = Math.max(bottom, p.y + p.height);
    }
    const kept = ctx.laneSizes.get(lane.id);
    const width = Math.max(800, right + LANE_PAD, kept?.width ?? 0);
    const height = Math.max(200, bottom + LANE_PAD, kept?.height ?? 0);
    poolW = Math.max(poolW, width);
    nodes.push({
      id: eid(lane.id),
      type: 'lane',
      parentId: poolId,
      extent: 'parent',
      position: { x: 0, y: frameY },
      width,
      height,
      data: { label: lane.label, type: 'lane', laneTitle: lane.label },
    });
    for (const m of members) {
      const p = pos.get(m.id);
      if (!p) continue;
      const type: FlowNodeType = m.type ?? (m.role === 'annotation' ? 'comment' : 'process');
      nodes.push({
        id: eid(m.id),
        type,
        parentId: eid(lane.id),
        extent: 'parent',
        position: { x: p.x, y: p.y },
        width: p.width,
        height: p.height,
        data: {
          label: m.label,
          type,
          role: m.role,
          ...(m.description ? { description: m.description } : {}),
          ...(m.attachTo ? { attachTo: eid(m.attachTo) } : {}),
        },
      });
    }
    frameY += height;
  }

  let poolY = ctx.origin.y;
  let poolX = ctx.origin.x;
  if (ctx.poolPosition) {
    poolX = ctx.poolPosition.x;
    poolY = ctx.poolPosition.y;
  } else if (ctx.obstacles.size > 0) {
    const bottom = Math.max(...[...ctx.obstacles.values()].map((f) => f.position.y + f.height));
    if (bottom + MAIN_GAP > poolY) {
      poolY = bottom + MAIN_GAP;
      warnings.push(`新骨架池下移至 y=${poolY} 避让人工保留容器`);
    }
  }
  nodes.unshift({
    id: poolId,
    type: 'pool',
    position: { x: poolX, y: poolY },
    width: poolW,
    height: frameY,
    data: {
      label: n.title ?? '业务泳道池',
      type: 'pool',
      orientation: 'horizontal',
      laneOrder: n.lanes.map((l) => eid(l.id)),
      headerSize: LANE_HEADER,
    },
  });

  const laneIndex = new Map(n.lanes.map((l, i) => [l.id, i]));
  for (const e of n.edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) {
      warnings.push(`连线 ${e.from} -> ${e.to} 端点未布局，跳过`);
      continue;
    }
    const ai = laneIndex.get(laneOf.get(e.from)!) ?? 0;
    const bi = laneIndex.get(laneOf.get(e.to)!) ?? 0;
    let sourceHandle: string;
    let targetHandle: string;
    if (ai === bi) {
      if (b.x >= a.x + a.width) {
        sourceHandle = 'right';
        targetHandle = 'left';
      } else if (b.y >= a.y + a.height) {
        sourceHandle = 'bottom';
        targetHandle = 'top';
      } else {
        sourceHandle = 'top';
        targetHandle = 'bottom';
      }
    } else if (bi > ai) {
      sourceHandle = 'bottom';
      targetHandle = 'top';
    } else {
      sourceHandle = 'top';
      targetHandle = 'bottom';
    }
    edges.push({
      id: `${ctx.idPrefix}e-${e.from}-${e.to}-${e.kind}`,
      source: eid(e.from),
      target: eid(e.to),
      type: 'orthogonal',
      sourceHandle,
      targetHandle,
      data: { kind: e.kind, ...(e.label ? { label: e.label } : {}) },
    });
  }
  return { nodes, edges, warnings };
}

function renderCrossLaneFlow(n: NormalizedSpec, ctx: RenderContext): RenderResult {
  const warnings = [...n.warnings];
  const eid = (id: string) => ctx.idPrefix + id;
  const poolId = eid('pool');
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const world = new Map<string, { x: number; y: number; width: number; height: number }>();
  const laneOf = new Map<string, string>();
  let frameY = LANE_HEADER;
  let poolW = 800;

  for (const lane of n.lanes) {
    const members = n.nodes.filter((x) => x.laneId === lane.id);
    const memberIds = new Set(members.map((x) => x.id));
    const sub: NormalizedSpec = {
      paradigm: 'vertical-flow',
      lanes: [],
      nodes: members,
      edges: n.edges.filter((e) => memberIds.has(e.from) && memberIds.has(e.to)),
      mainOrder: n.mainOrder.filter((id) => memberIds.has(id)),
      warnings: [],
    };
    const fixed = new Map([...ctx.fixed].filter(([id]) => memberIds.has(id)));
    const local = renderVerticalFlow(sub, { idPrefix: '', origin: { x: LANE_PAD, y: LANE_PAD }, fixed, laneSizes: new Map(), obstacles: new Map() });
    warnings.push(...local.warnings);
    const right = Math.max(0, ...local.nodes.map((x) => x.position.x + x.width!));
    const bottom = Math.max(0, ...local.nodes.map((x) => x.position.y + x.height!));
    const kept = ctx.laneSizes.get(lane.id);
    const width = Math.max(800, right + LANE_PAD, kept?.width ?? 0);
    const height = Math.max(200, bottom + LANE_PAD, kept?.height ?? 0);
    poolW = Math.max(poolW, width);
    nodes.push({
      id: eid(lane.id),
      type: 'lane',
      parentId: poolId,
      extent: 'parent',
      position: { x: 0, y: frameY },
      width,
      height,
      data: { label: lane.label, type: 'lane', laneTitle: lane.label },
    });
    world.set(eid(lane.id), { x: 0, y: frameY, width, height });
    for (const ln of local.nodes) {
      const specId = ln.id;
      laneOf.set(eid(specId), eid(lane.id));
      nodes.push({
        ...ln,
        id: eid(specId),
        parentId: eid(lane.id),
        extent: 'parent',
        data: { ...ln.data, ...(ln.data!.attachTo ? { attachTo: eid(ln.data!.attachTo as string) } : {}) },
      });
      world.set(eid(specId), { x: ln.position.x, y: frameY + ln.position.y, width: ln.width!, height: ln.height! });
    }
    for (const le of local.edges) {
      edges.push({ ...le, id: `${ctx.idPrefix}${le.id}`, source: eid(le.source), target: eid(le.target) });
    }
    frameY += height;
  }

  let poolY = ctx.origin.y;
  let poolX = ctx.origin.x;
  if (ctx.poolPosition) {
    poolX = ctx.poolPosition.x;
    poolY = ctx.poolPosition.y;
  } else if (ctx.obstacles.size > 0) {
    const bottom = Math.max(...[...ctx.obstacles.values()].map((f) => f.position.y + f.height));
    if (bottom + MAIN_GAP > poolY) {
      poolY = bottom + MAIN_GAP;
      warnings.push(`新骨架池下移至 y=${poolY} 避让人工保留容器`);
    }
  }
  nodes.unshift({
    id: poolId,
    type: 'pool',
    position: { x: poolX, y: poolY },
    width: poolW,
    height: frameY,
    data: {
      label: n.title ?? '业务泳道池',
      type: 'pool',
      orientation: 'horizontal',
      laneOrder: n.lanes.map((l) => eid(l.id)),
      headerSize: LANE_HEADER,
    },
  });

  for (const e of n.edges) {
    const fromLane = laneOf.get(eid(e.from));
    const toLane = laneOf.get(eid(e.to));
    if (!fromLane || !toLane || fromLane === toLane) continue;
    const a = world.get(eid(e.from))!;
    const b = world.get(eid(e.to))!;
    const down = b.y + b.height / 2 >= a.y + a.height / 2;
    edges.push({
      id: `${ctx.idPrefix}e-${e.from}-${e.to}-${e.kind}`,
      source: eid(e.from),
      target: eid(e.to),
      type: 'orthogonal',
      sourceHandle: down ? 'bottom' : 'top',
      targetHandle: down ? 'top' : 'bottom',
      data: { kind: e.kind, ...(e.label ? { label: e.label } : {}) },
    });
  }
  return { nodes, edges, warnings };
}

import { getDefaultNodeSize } from '../node-registry.js';
import type { NormalizedSpec } from '../spec/normalize.js';
import type { SpecNode } from '../spec/types.js';
import type { FlowEdge, FlowNode, FlowNodeType } from '../types.js';
import { ANNOT_GAP, BRANCH_VGAP, GRID_COL_GAP, LANE_HEADER, LANE_PAD, MAIN_GAP } from './constants.js';
import { analyzeGraphTopology } from './topology.js';
import type { RenderContext, RenderResult } from './types.js';

type Box = { x: number; y: number; width: number; height: number };

const VERT_LANE_HEADER = 36;
const HORIZ_MAIN_START = LANE_HEADER + 24;
const VERT_MAIN_START = VERT_LANE_HEADER + 24;

function sizeOfNode(node: SpecNode & { role: string }): { width: number; height: number } {
  return getDefaultNodeSize(node.type ?? (node.role === 'annotation' ? 'comment' : 'process'));
}

export function renderSwimlane(n: NormalizedSpec, ctx: RenderContext): RenderResult {
  const laneOf = new Map(n.nodes.map((x) => [x.id, x.laneId!]));
  const bizLanes = new Set(n.nodes.filter((x) => x.role !== 'annotation').map((x) => laneOf.get(x.id)));
  if (n.orientation === 'horizontal' && bizLanes.size <= 1) return renderHorizontalTrunk(n, ctx);
  return renderCrossLaneDirectional(n, ctx);
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

function renderCrossLaneDirectional(n: NormalizedSpec, ctx: RenderContext): RenderResult {
  const warnings = [...n.warnings];
  const eid = (id: string) => ctx.idPrefix + id;
  const isHoriz = n.orientation === 'horizontal';
  const poolId = eid('pool');
  const nodeById = new Map(n.nodes.map((x) => [x.id, x]));
  const topo = analyzeGraphTopology(n.nodes, n.edges);
  const { bizNodes, annotNodes: annots, backEdgeKeys: backEdges, layerOf } = topo;
  if (backEdges.size > 0) warnings.push(`swimlane 检测到 ${backEdges.size} 条非 loop 环回边，已破环分层`);

  const fixedOf = (id: string): Box | undefined => {
    const f = ctx.fixed.get(id);
    return f ? { x: f.position.x, y: f.position.y, width: f.width, height: f.height } : undefined;
  };
  const boxOf = (id: string): Box => {
    const f = fixedOf(id);
    if (f) return f;
    const s = sizeOfNode(nodeById.get(id)!);
    return { x: 0, y: 0, width: s.width, height: s.height };
  };

  const maxLayer = bizNodes.reduce((m, b) => Math.max(m, layerOf.get(b.id) ?? 0), 0);
  const layerMaxMain = new Map<number, number>();
  for (const b of bizNodes) {
    const l = layerOf.get(b.id) ?? 0;
    const box = boxOf(b.id);
    const span = isHoriz ? box.width : box.height;
    layerMaxMain.set(l, Math.max(layerMaxMain.get(l) ?? 0, span));
  }
  const layerStart = new Map<number, number>();
  let mainCursor = isHoriz ? HORIZ_MAIN_START : VERT_MAIN_START;
  for (let l = 0; l <= maxLayer; l++) {
    layerStart.set(l, mainCursor);
    mainCursor += (layerMaxMain.get(l) ?? 0) + MAIN_GAP;
  }

  const pos = new Map<string, Box>();
  const laneDims = new Map<string, { width: number; height: number }>();
  const overlaps = (a: Box, b: Box) =>
    a.x < b.x + b.width + ANNOT_GAP &&
    b.x < a.x + a.width + ANNOT_GAP &&
    a.y < b.y + b.height + ANNOT_GAP &&
    b.y < a.y + a.height + ANNOT_GAP;

  for (const lane of n.lanes) {
    const laneBiz = bizNodes.filter((x) => x.laneId === lane.id);
    const buckets = new Map<number, Array<SpecNode & { role: string }>>();
    for (const b of laneBiz) {
      const l = layerOf.get(b.id) ?? 0;
      buckets.set(l, [...(buckets.get(l) ?? []), b]);
    }
    const crossGap = isHoriz ? BRANCH_VGAP : GRID_COL_GAP;
    let maxBucketCross = 0;
    const laneFixedBoxes: Box[] = [];
    for (const b of laneBiz) {
      const f = fixedOf(b.id);
      if (f) {
        pos.set(b.id, f);
        laneFixedBoxes.push(f);
      }
    }
    const pendingBuckets: Array<{ layer: number; items: Array<{ id: string; box: Box }> }> = [];
    for (const [l, items] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
      const unfixed = items.filter((it) => !fixedOf(it.id));
      if (unfixed.length === 0) continue;
      const boxes = unfixed.map((it) => ({ id: it.id, box: boxOf(it.id) }));
      const totalCross = boxes.reduce((acc, it) => acc + (isHoriz ? it.box.height : it.box.width), 0) + crossGap * (boxes.length - 1);
      maxBucketCross = Math.max(maxBucketCross, totalCross);
      pendingBuckets.push({ layer: l, items: boxes });
    }

    const kept = ctx.laneSizes.get(lane.id);
    const baseCross = isHoriz
      ? Math.max(200, maxBucketCross + LANE_PAD * 2, kept?.height ?? 0)
      : Math.max(240, maxBucketCross + LANE_PAD * 2, kept?.width ?? 0);

    const taken: Box[] = [...laneFixedBoxes];
    for (const bucket of pendingBuckets) {
      const span = bucket.items.reduce((acc, it) => acc + (isHoriz ? it.box.height : it.box.width), 0) + crossGap * (bucket.items.length - 1);
      let crossCursor = Math.max(LANE_PAD, Math.round((baseCross - span) / 2));
      const mStart = layerStart.get(bucket.layer)!;
      for (const it of bucket.items) {
        const w = it.box.width;
        const h = it.box.height;
        const placed = isHoriz
          ? { x: mStart, y: crossCursor, width: w, height: h }
          : { x: crossCursor, y: mStart, width: w, height: h };
        pos.set(it.id, placed);
        taken.push(placed);
        crossCursor += (isHoriz ? h : w) + crossGap;
      }
    }

    const laneAnnots = annots
      .filter((a) => a.laneId === lane.id)
      .sort((a, b) => {
        const ha = pos.get(a.attachTo!);
        const hb = pos.get(b.attachTo!);
        return isHoriz ? (ha?.x ?? 0) - (hb?.x ?? 0) : (ha?.y ?? 0) - (hb?.y ?? 0);
      });
    for (const a of laneAnnots) {
      const f = fixedOf(a.id);
      if (f) {
        pos.set(a.id, f);
        taken.push(f);
        continue;
      }
      const host = pos.get(a.attachTo!);
      const s = sizeOfNode(a);
      const ax = isHoriz ? (host ? host.x : HORIZ_MAIN_START) : LANE_PAD;
      const ay = isHoriz ? LANE_PAD : (host ? host.y : VERT_MAIN_START);
      let x = ax;
      let y = ay;
      let guard = 0;
      while (taken.some((b) => overlaps({ x, y, width: s.width, height: s.height }, b)) && guard++ < 200) {
        if (isHoriz) y += s.height + ANNOT_GAP;
        else x += s.width + ANNOT_GAP;
      }
      const placed = { x, y, width: s.width, height: s.height };
      pos.set(a.id, placed);
      taken.push(placed);
    }

    const members = n.nodes.filter((x) => x.laneId === lane.id);
    let maxRight = 0;
    let maxBottom = 0;
    for (const m of members) {
      const p = pos.get(m.id);
      if (!p) continue;
      maxRight = Math.max(maxRight, p.x + p.width);
      maxBottom = Math.max(maxBottom, p.y + p.height);
    }
    const width = isHoriz
      ? Math.max(800, maxRight + LANE_PAD, kept?.width ?? 0)
      : Math.max(240, maxRight + LANE_PAD, kept?.width ?? 0);
    const height = isHoriz
      ? Math.max(200, maxBottom + LANE_PAD, kept?.height ?? 0)
      : Math.max(480, maxBottom + LANE_PAD, kept?.height ?? 0);
    laneDims.set(lane.id, { width, height });
  }

  const poolW = isHoriz
    ? Math.max(800, ...[...laneDims.values()].map((d) => d.width))
    : Math.max(240, [...laneDims.values()].reduce((acc, d) => acc + d.width, 0));
  const poolLaneH = isHoriz
    ? 0
    : Math.max(480, ...[...laneDims.values()].map((d) => d.height));

  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const world = new Map<string, Box>();
  const laneOf = new Map<string, string>();
  let frameX = 0;
  let frameY = LANE_HEADER;

  for (const lane of n.lanes) {
    const dim = laneDims.get(lane.id)!;
    const width = isHoriz ? poolW : dim.width;
    const height = isHoriz ? dim.height : poolLaneH;
    const lx = isHoriz ? 0 : frameX;
    const ly = isHoriz ? frameY : LANE_HEADER;
    nodes.push({
      id: eid(lane.id),
      type: 'lane',
      parentId: poolId,
      extent: 'parent',
      position: { x: lx, y: ly },
      width,
      height,
      data: { label: lane.label, type: 'lane', laneTitle: lane.label },
    });
    for (const m of n.nodes.filter((x) => x.laneId === lane.id)) {
      const p = pos.get(m.id);
      if (!p) continue;
      const type: FlowNodeType = m.type ?? (m.role === 'annotation' ? 'comment' : 'process');
      laneOf.set(eid(m.id), lane.id);
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
      world.set(eid(m.id), { x: lx + p.x, y: ly + p.y, width: p.width, height: p.height });
    }
    if (isHoriz) frameY += height;
    else frameX += width;
  }

  let poolX = ctx.origin.x;
  let poolY = ctx.origin.y;
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
    height: isHoriz ? frameY : LANE_HEADER + poolLaneH,
    data: {
      label: n.title ?? '业务泳道池',
      type: 'pool',
      orientation: n.orientation,
      laneOrder: n.lanes.map((l) => eid(l.id)),
      headerSize: LANE_HEADER,
    },
  });

  const laneIndex = new Map(n.lanes.map((l, i) => [l.id, i]));
  for (const e of n.edges) {
    const a = world.get(eid(e.from));
    const b = world.get(eid(e.to));
    if (!a || !b) {
      warnings.push(`连线 ${e.from} -> ${e.to} 端点未布局，跳过`);
      continue;
    }
    const ai = laneIndex.get(laneOf.get(eid(e.from))!) ?? 0;
    const bi = laneIndex.get(laneOf.get(eid(e.to))!) ?? 0;
    let sourceHandle: string;
    let targetHandle: string;

    if (e.kind === 'annotate') {
      if (isHoriz) {
        if (b.y >= a.y) {
          sourceHandle = 'bottom';
          targetHandle = 'top';
        } else {
          sourceHandle = 'top';
          targetHandle = 'bottom';
        }
      } else if (b.x >= a.x) {
        sourceHandle = 'right';
        targetHandle = 'left';
      } else {
        sourceHandle = 'left';
        targetHandle = 'right';
      }
    } else if (isHoriz) {
      if (ai === bi) {
        if (e.kind === 'loop' || b.x < a.x) {
          sourceHandle = 'top';
          targetHandle = 'top';
        } else if (b.x >= a.x + a.width) {
          sourceHandle = 'right';
          targetHandle = 'left';
        } else if (b.y >= a.y) {
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
    } else {
      if (ai === bi) {
        if (e.kind === 'loop' || b.y < a.y) {
          sourceHandle = 'right';
          targetHandle = 'right';
        } else if (b.y >= a.y + a.height) {
          sourceHandle = 'bottom';
          targetHandle = 'top';
        } else if (b.x >= a.x) {
          sourceHandle = 'right';
          targetHandle = 'left';
        } else {
          sourceHandle = 'left';
          targetHandle = 'right';
        }
      } else if (bi > ai) {
        if (b.y >= a.y + a.height) {
          sourceHandle = 'right';
          targetHandle = 'top';
        } else if (b.y < a.y) {
          sourceHandle = 'right';
          targetHandle = 'right';
        } else {
          sourceHandle = 'right';
          targetHandle = 'left';
        }
      } else {
        if (b.y >= a.y + a.height) {
          sourceHandle = 'left';
          targetHandle = 'top';
        } else {
          sourceHandle = 'left';
          targetHandle = 'right';
        }
      }
    }

    edges.push({
      id: `${ctx.idPrefix}e-${e.from}-${e.to}-${e.kind}`,
      source: eid(e.from),
      target: eid(e.to),
      type: e.routingType ?? n.edgeRouting ?? 'orthogonal',
      sourceHandle,
      targetHandle,
      data: {
        kind: e.kind,
        routingType: e.routingType ?? n.edgeRouting ?? 'orthogonal',
        ...(e.label ? { label: e.label } : {}),
      },
    });
  }

  return { nodes, edges, warnings };
}

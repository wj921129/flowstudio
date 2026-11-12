import type { NormalizedSpec } from '../spec/normalize.js';
import type { FlowEdge, FlowNode } from '../types.js';
import { LANE_HEADER, LANE_PAD } from './constants.js';
import type { RenderContext, RenderResult } from './types.js';
import { renderVerticalFlow } from './vertical-flow.js';

export function renderSwimlane(n: NormalizedSpec, ctx: RenderContext): RenderResult {
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
    const local = renderVerticalFlow(sub, { idPrefix: '', origin: { x: LANE_PAD, y: LANE_PAD }, fixed });
    warnings.push(...local.warnings);
    const right = Math.max(0, ...local.nodes.map((x) => x.position.x + x.width!));
    const bottom = Math.max(0, ...local.nodes.map((x) => x.position.y + x.height!));
    const width = Math.max(800, right + LANE_PAD);
    const height = Math.max(200, bottom + LANE_PAD);
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

  nodes.unshift({
    id: poolId,
    type: 'pool',
    position: { x: ctx.origin.x, y: ctx.origin.y },
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
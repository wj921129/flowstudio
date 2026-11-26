import type { FlowEdge, FlowNode, NodeLockMode, RenderResult } from '@flowstudio/shared';

export interface RenderDiff {
  addNodes: FlowNode[];
  addEdges: FlowEdge[];
  updateNodes: Array<{ id: string; patch: Partial<FlowNode> }>;
  updateEdges: Array<{ id: string; patch: Partial<FlowEdge> }>;
  deleteNodeIds: string[];
  deleteEdgeIds: string[];
  warnings: string[];
}

const edgeKey = (e: FlowEdge) => `${e.source}|${e.target}|${(e.data as Record<string, unknown> | undefined)?.kind ?? 'next'}`;
const same = (a: unknown) => JSON.stringify(a);

export function diffRendered(
  rendered: RenderResult,
  existingNodes: FlowNode[],
  existingEdges: FlowEdge[],
  lockOf: (id: string) => NodeLockMode,
  opts?: { orientationChanged?: boolean },
): RenderDiff {
  const warnings: string[] = [];
  const byId = new Map(existingNodes.map((n) => [n.id, n]));
  const protectedIds = new Set<string>();
  for (const n of existingNodes) {
    if (lockOf(n.id) !== 'full') continue;
    protectedIds.add(n.id);
    warnings.push(`节点 ${n.id} 已被人类完全锁定，保留原节点`);
    let cursor = n.parentId;
    const seen = new Set([n.id]);
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      protectedIds.add(cursor);
      cursor = byId.get(cursor)?.parentId;
    }
  }

  const orientationChanged = Boolean(opts?.orientationChanged);
  const addNodes = rendered.nodes.filter((n) => !byId.has(n.id));
  const updateNodes: RenderDiff['updateNodes'] = [];
  const patchById = new Map<string, Partial<FlowNode>>();

  for (const rn of rendered.nodes) {
    const ex = byId.get(rn.id);
    if (!ex) continue;
    if (protectedIds.has(rn.id)) continue;
    const patch: Partial<FlowNode> = {};
    if (same(ex.type) !== same(rn.type)) patch.type = rn.type;
    const isContainer = rn.type === 'pool' || rn.type === 'lane';
    const allowContainerPos = isContainer && orientationChanged && lockOf(rn.id) === 'none';
    if (((!isContainer && lockOf(rn.id) !== 'position') || allowContainerPos) && same(ex.position) !== same(rn.position)) {
      patch.position = rn.position;
    }
    const width = isContainer && !orientationChanged ? Math.max(ex.width ?? 0, rn.width ?? 0) : rn.width;
    const height = isContainer && !orientationChanged ? Math.max(ex.height ?? 0, rn.height ?? 0) : rn.height;
    if (same(ex.width) !== same(width)) patch.width = width;
    if (same(ex.height) !== same(height)) patch.height = height;
    if (same(ex.parentId) !== same(rn.parentId)) patch.parentId = rn.parentId;
    if (same(ex.extent) !== same(rn.extent)) patch.extent = rn.extent;
    const data = { ...(ex.data as object), ...(rn.data as object) };
    if (same(ex.data) !== same(data)) patch.data = data as FlowNode['data'];
    patchById.set(rn.id, patch);
  }

  if (!orientationChanged) {
    for (const pool of rendered.nodes.filter((n) => n.type === 'pool')) {
      const exPool = byId.get(pool.id);
      if (!exPool) continue;
      const poolData = ((patchById.get(pool.id)?.data ?? exPool.data) as Record<string, unknown> | undefined) ?? {};
      const isHoriz = (poolData.orientation ?? 'horizontal') !== 'vertical';
      const headerSize = typeof poolData.headerSize === 'number' ? poolData.headerSize : 40;
      const renderedLanes = rendered.nodes.filter((n) => n.type === 'lane' && n.parentId === pool.id);
      let cursor = headerSize;
      let crossMax = 0;
      for (const rl of renderedLanes) {
        const exLane = byId.get(rl.id);
        const lp = patchById.get(rl.id);
        const w = (lp?.width ?? exLane?.width ?? rl.width ?? 0) as number;
        const h = (lp?.height ?? exLane?.height ?? rl.height ?? 0) as number;
        if (exLane && !protectedIds.has(rl.id) && lockOf(rl.id) === 'none') {
          const curPos = (lp?.position ?? exLane.position) as { x: number; y: number };
          const curMain = isHoriz ? curPos.y : curPos.x;
          if (curMain < cursor) {
            const nextPos = isHoriz ? { x: curPos.x, y: cursor } : { x: cursor, y: curPos.y };
            const targetPatch = lp ?? {};
            targetPatch.position = nextPos;
            patchById.set(rl.id, targetPatch);
            cursor = cursor + (isHoriz ? h : w);
          } else {
            cursor = curMain + (isHoriz ? h : w);
          }
          crossMax = Math.max(crossMax, isHoriz ? curPos.x + w : curPos.y + h);
        } else {
          const pos = (exLane?.position ?? rl.position) as { x: number; y: number };
          cursor = Math.max(cursor, (isHoriz ? pos.y + h : pos.x + w));
          crossMax = Math.max(crossMax, isHoriz ? pos.x + w : pos.y + h);
        }
      }
      if (!protectedIds.has(pool.id) && lockOf(pool.id) !== 'full') {
        const pp = patchById.get(pool.id) ?? {};
        const curW = (pp.width ?? exPool.width ?? pool.width ?? 0) as number;
        const curH = (pp.height ?? exPool.height ?? pool.height ?? 0) as number;
        const reqW = isHoriz ? Math.max(curW, crossMax) : Math.max(curW, cursor);
        const reqH = isHoriz ? Math.max(curH, cursor) : Math.max(curH, headerSize + crossMax);
        if (reqW !== curW) pp.width = reqW;
        if (reqH !== curH) pp.height = reqH;
        if (Object.keys(pp).length > 0) patchById.set(pool.id, pp);
      }
    }
  }

  for (const [id, patch] of patchById) {
    if (Object.keys(patch).length > 0) updateNodes.push({ id, patch });
  }

  const renderedNodeIds = new Set(rendered.nodes.map((n) => n.id));
  const deleteNodeIds = existingNodes.filter((n) => !renderedNodeIds.has(n.id) && !protectedIds.has(n.id)).map((n) => n.id);

  const exByKey = new Map(existingEdges.map((e) => [edgeKey(e), e]));
  const addEdges = rendered.edges.filter((e) => !exByKey.has(edgeKey(e)));
  const updateEdges: RenderDiff['updateEdges'] = [];
  for (const re of rendered.edges) {
    const ex = exByKey.get(edgeKey(re));
    if (!ex) continue;
    if (protectedIds.has(ex.source) || protectedIds.has(ex.target)) continue;
    const patch: Partial<FlowEdge> = {};
    if (same(ex.type) !== same(re.type)) patch.type = re.type;
    if (same(ex.sourceHandle) !== same(re.sourceHandle)) patch.sourceHandle = re.sourceHandle;
    if (same(ex.targetHandle) !== same(re.targetHandle)) patch.targetHandle = re.targetHandle;
    const exData = (ex.data as Record<string, unknown> | undefined) ?? {};
    const reData = (re.data as Record<string, unknown> | undefined) ?? {};
    const data: Record<string, unknown> = { ...exData, ...reData };
    if (re.type === 'straight' || reData.routingType === 'straight') delete data.waypoints;
    const exStyle = exData.style && typeof exData.style === 'object' ? (exData.style as Record<string, unknown>) : undefined;
    const reStyle = reData.style && typeof exData.style === 'object' ? (reData.style as Record<string, unknown>) : undefined;
    if (exStyle || reStyle) {
      const nextStyle: Record<string, unknown> = { ...(exStyle ?? {}), ...(reStyle ?? {}) };
      if (!reStyle || !('strokeStyle' in reStyle)) delete nextStyle.strokeStyle;
      if (Object.keys(nextStyle).length > 0) data.style = nextStyle;
      else delete data.style;
    }
    if (!('autoSourceHandle' in reData)) delete data.autoSourceHandle;
    if (!('autoTargetHandle' in reData)) delete data.autoTargetHandle;
    if (same(ex.data) !== same(data)) patch.data = data as FlowEdge['data'];
    if (Object.keys(patch).length > 0) updateEdges.push({ id: ex.id, patch });
  }
  const renderedKeys = new Set(rendered.edges.map(edgeKey));
  const deleteEdgeIds = existingEdges
    .filter((e) => !renderedKeys.has(edgeKey(e)) && !(protectedIds.has(e.source) && protectedIds.has(e.target)))
    .map((e) => e.id);

  return { addNodes, addEdges, updateNodes, updateEdges, deleteNodeIds, deleteEdgeIds, warnings };
}

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

  const addNodes = rendered.nodes.filter((n) => !byId.has(n.id));
  const updateNodes: RenderDiff['updateNodes'] = [];
  for (const rn of rendered.nodes) {
    const ex = byId.get(rn.id);
    if (!ex) continue;
    if (protectedIds.has(rn.id)) continue;
    const patch: Partial<FlowNode> = {};
    if (same(ex.type) !== same(rn.type)) patch.type = rn.type;
    const isContainer = rn.type === 'pool' || rn.type === 'lane';
    if (!isContainer && lockOf(rn.id) !== 'position' && same(ex.position) !== same(rn.position)) patch.position = rn.position;
    const width = isContainer ? Math.max(ex.width ?? 0, rn.width ?? 0) : rn.width;
    const height = isContainer ? Math.max(ex.height ?? 0, rn.height ?? 0) : rn.height;
    if (same(ex.width) !== same(width)) patch.width = width;
    if (same(ex.height) !== same(height)) patch.height = height;
    if (same(ex.parentId) !== same(rn.parentId)) patch.parentId = rn.parentId;
    if (same(ex.extent) !== same(rn.extent)) patch.extent = rn.extent;
    const data = { ...(ex.data as object), ...(rn.data as object) };
    if (same(ex.data) !== same(data)) patch.data = data as FlowNode['data'];
    if (Object.keys(patch).length > 0) updateNodes.push({ id: rn.id, patch });
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
    const data = { ...(ex.data as object), ...(re.data as object) };
    if (same(ex.data) !== same(data)) patch.data = data as FlowEdge['data'];
    if (Object.keys(patch).length > 0) updateEdges.push({ id: ex.id, patch });
  }
  const renderedKeys = new Set(rendered.edges.map(edgeKey));
  const deleteEdgeIds = existingEdges
    .filter((e) => !renderedKeys.has(edgeKey(e)) && !(protectedIds.has(e.source) && protectedIds.has(e.target)))
    .map((e) => e.id);

  return { addNodes, addEdges, updateNodes, updateEdges, deleteNodeIds, deleteEdgeIds, warnings };
}
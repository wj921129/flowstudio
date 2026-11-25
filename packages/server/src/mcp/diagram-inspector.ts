import type * as Y from 'yjs';
import {
  type BorderSide,
  type FlowEdge,
  type FlowNode,
  inferBestSides,
  parseBorderAnchorHandle,
  resolveNodeWorldBoxes,
} from '@flowstudio/shared';

export function inspectDiagramSemantics(
  nodesMap: Y.Map<Y.Map<unknown>>,
  edgesMap: Y.Map<Y.Map<unknown>>,
): string[] {
  const warnings: string[] = [];
  const containerOrNoteTypes = new Set(['pool', 'lane', 'comment', 'group']);
  const businessNodes: Array<{ id: string; type: string; label: string; parentId?: string }> = [];
  const labelById = new Map<string, string>();
  const flowNodes: FlowNode[] = [];
  const flowEdges: FlowEdge[] = [];
  let hasLane = false;

  nodesMap.forEach((nodeMap, id) => {
    const type = (nodeMap.get('type') as string) || 'process';
    if (type === 'lane') hasLane = true;
    const data = (nodeMap.get('data') as Record<string, unknown>) || {};
    const label = ((data.label as string) || id).trim();
    const parentId = nodeMap.get('parentId') as string | undefined;
    labelById.set(id, label);
    flowNodes.push({
      id,
      type: type as FlowNode['type'],
      position: (nodeMap.get('position') as FlowNode['position']) || { x: 0, y: 0 },
      parentId,
      width: nodeMap.get('width') as number | undefined,
      height: nodeMap.get('height') as number | undefined,
      data: data as FlowNode['data'],
    });
    if (containerOrNoteTypes.has(type)) return;
    businessNodes.push({ id, type, label, parentId });
  });

  if (businessNodes.length === 0) return warnings;

  const connectedIds = new Set<string>();
  const outEdgesBySource = new Map<string, Array<{ label: string }>>();
  edgesMap.forEach((edgeMap, id) => {
    const source = edgeMap.get('source') as string;
    const target = edgeMap.get('target') as string;
    const sourceHandle = edgeMap.get('sourceHandle') as string | undefined;
    const targetHandle = edgeMap.get('targetHandle') as string | undefined;
    const data = (edgeMap.get('data') as Record<string, unknown>) || {};
    const label = typeof data.label === 'string' ? data.label.trim() : '';
    if (source && target) {
      flowEdges.push({ id, source, target, sourceHandle, targetHandle, data: data as FlowEdge['data'] });
    }
    if (source) {
      connectedIds.add(source);
      const list = outEdgesBySource.get(source) ?? [];
      list.push({ label });
      outEdgesBySource.set(source, list);
    }
    if (target) connectedIds.add(target);
  });

  if (businessNodes.length >= 2) {
    const isolated = businessNodes.filter((n) => !connectedIds.has(n.id)).map((n) => `${n.label}(${n.id})`);
    if (isolated.length > 0) {
      warnings.push(`检测到孤立节点: ${isolated.slice(0, 5).join('、')}${isolated.length > 5 ? ` 等 ${isolated.length} 个` : ''}，建议通过 connect 接入主链路`);
    }
  }

  for (const n of businessNodes) {
    if (n.type !== 'decision') continue;
    const outEdges = outEdgesBySource.get(n.id) ?? [];
    if (outEdges.length >= 2) {
      const missingCount = outEdges.filter((e) => !e.label).length;
      if (missingCount > 0) {
        warnings.push(`判断节点 ${n.label}(${n.id}) 有 ${missingCount} 条分支连线缺少条件标签，建议补充是/否等分支说明`);
      }
    }
  }

  if (hasLane) {
    const unlaned = businessNodes.filter((n) => !n.parentId).map((n) => `${n.label}(${n.id})`);
    if (unlaned.length > 0) {
      warnings.push(`泳道图中存在未归属泳道的游离节点: ${unlaned.slice(0, 5).join('、')}${unlaned.length > 5 ? ` 等 ${unlaned.length} 个` : ''}，建议通过 move_to_lane 归属泳道`);
    }
  }

  const boxes = resolveNodeWorldBoxes(flowNodes);
  const portBuckets = new Map<string, number[]>();
  const addPort = (nodeId: string, side: BorderSide, offset: number) => {
    const key = `${nodeId}::${side}`;
    const bucket = portBuckets.get(key);
    if (bucket) bucket.push(offset);
    else portBuckets.set(key, [offset]);
  };
  for (const edge of flowEdges) {
    const sBox = boxes.get(edge.source);
    const tBox = boxes.get(edge.target);
    const fallback = sBox && tBox ? inferBestSides(sBox, tBox) : { sourceSide: 'right' as BorderSide, targetSide: 'left' as BorderSide };
    const ps = parseBorderAnchorHandle(edge.sourceHandle);
    const pt = parseBorderAnchorHandle(edge.targetHandle);
    addPort(edge.source, ps?.side ?? fallback.sourceSide, ps?.offset ?? 0.5);
    addPort(edge.target, pt?.side ?? fallback.targetSide, pt?.offset ?? 0.5);
  }
  const overlappedPorts: string[] = [];
  for (const [key, offsets] of portBuckets.entries()) {
    if (offsets.length < 2) continue;
    const sorted = [...offsets].sort((a, b) => a - b);
    let hasOverlap = false;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] < 0.03) {
        hasOverlap = true;
        break;
      }
    }
    if (hasOverlap) {
      const sep = key.indexOf('::');
      const nodeId = key.slice(0, sep);
      const side = key.slice(sep + 2);
      overlappedPorts.push(`${labelById.get(nodeId) ?? nodeId}(${nodeId}) 的 ${side} 侧`);
    }
  }
  if (overlappedPorts.length > 0) {
    warnings.push(
      `检测到同点连线重叠: ${overlappedPorts.slice(0, 5).join('、')}${overlappedPorts.length > 5 ? ` 等 ${overlappedPorts.length} 处` : ''}，建议通过 update_edge 错开锚点或执行 auto_layout`,
    );
  }

  return warnings;
}

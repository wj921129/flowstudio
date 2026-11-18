import type * as Y from 'yjs';

export function inspectDiagramSemantics(
  nodesMap: Y.Map<Y.Map<unknown>>,
  edgesMap: Y.Map<Y.Map<unknown>>,
): string[] {
  const warnings: string[] = [];
  const containerOrNoteTypes = new Set(['pool', 'lane', 'comment', 'group']);
  const businessNodes: Array<{ id: string; type: string; label: string; parentId?: string }> = [];
  let hasLane = false;

  nodesMap.forEach((nodeMap, id) => {
    const type = (nodeMap.get('type') as string) || 'process';
    if (type === 'lane') hasLane = true;
    if (containerOrNoteTypes.has(type)) return;
    const data = (nodeMap.get('data') as Record<string, unknown>) || {};
    const label = ((data.label as string) || id).trim();
    const parentId = nodeMap.get('parentId') as string | undefined;
    businessNodes.push({ id, type, label, parentId });
  });

  if (businessNodes.length === 0) return warnings;

  const connectedIds = new Set<string>();
  const outEdgesBySource = new Map<string, Array<{ label: string }>>();
  edgesMap.forEach((edgeMap) => {
    const source = edgeMap.get('source') as string;
    const target = edgeMap.get('target') as string;
    const data = (edgeMap.get('data') as Record<string, unknown>) || {};
    const label = typeof data.label === 'string' ? data.label.trim() : '';
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

  return warnings;
}

import type { FlowNode, FlowEdge } from './types.js';

export type VisualDiffOpType = 'add' | 'update' | 'delete';

export interface VisualDiffItem {
  id: string;
  entityType: 'node' | 'edge';
  opType: VisualDiffOpType;
  label: string;
  description: string;
  changes?: string[];
  before?: Partial<FlowNode> | Partial<FlowEdge>;
  after?: Partial<FlowNode> | Partial<FlowEdge>;
}

export interface SnapshotDiffResult {
  baseLabel: string;
  targetLabel: string;
  items: VisualDiffItem[];
  summary: {
    addedCount: number;
    updatedCount: number;
    deletedCount: number;
    totalChanges: number;
  };
}

const resolveNodeLabel = (n?: Partial<FlowNode>): string =>
  String(n?.data?.label || n?.data?.laneTitle || n?.id || '未命名图元');

const resolveEdgeLabel = (e?: Partial<FlowEdge>): string =>
  String(e?.data?.label || e?.label || e?.id || '连线');

export function compareSnapshots(
  baseNodes: FlowNode[],
  baseEdges: FlowEdge[],
  targetNodes: FlowNode[],
  targetEdges: FlowEdge[],
  baseLabel = '基线版本',
  targetLabel = '目标版本'
): SnapshotDiffResult {
  const items: VisualDiffItem[] = [];
  const baseNodeMap = new Map<string, FlowNode>(baseNodes.map((n) => [n.id, n]));
  const targetNodeMap = new Map<string, FlowNode>(targetNodes.map((n) => [n.id, n]));

  targetNodeMap.forEach((tNode, id) => {
    const bNode = baseNodeMap.get(id);
    if (!bNode) {
      items.push({
        id,
        entityType: 'node',
        opType: 'add',
        label: resolveNodeLabel(tNode),
        description: `新增图元「${resolveNodeLabel(tNode)}」`,
        after: tNode,
      });
      return;
    }
    const changes: string[] = [];
    const bLabel = resolveNodeLabel(bNode);
    const tLabel = resolveNodeLabel(tNode);
    if (bLabel !== tLabel) changes.push(`文案由「${bLabel}」变更为「${tLabel}」`);
    if (bNode.position.x !== tNode.position.x || bNode.position.y !== tNode.position.y) {
      changes.push(`坐标偏移 (${Math.round(tNode.position.x - bNode.position.x)}, ${Math.round(tNode.position.y - bNode.position.y)})`);
    }
    if ((bNode.width ?? 160) !== (tNode.width ?? 160) || (bNode.height ?? 80) !== (tNode.height ?? 80)) {
      changes.push('尺寸调整');
    }
    if (bNode.type !== tNode.type) changes.push(`类型从 ${bNode.type} 改为 ${tNode.type}`);
    if (bNode.parentId !== tNode.parentId) changes.push('所属容器层级变更');
    if (bNode.data?.lockMode !== tNode.data?.lockMode) changes.push('锁定模式变更');
    if (changes.length > 0) {
      items.push({
        id,
        entityType: 'node',
        opType: 'update',
        label: tLabel,
        description: changes.join('；'),
        changes,
        before: bNode,
        after: tNode,
      });
    }
  });

  baseNodeMap.forEach((bNode, id) => {
    if (!targetNodeMap.has(id)) {
      items.push({
        id,
        entityType: 'node',
        opType: 'delete',
        label: resolveNodeLabel(bNode),
        description: `删除图元「${resolveNodeLabel(bNode)}」`,
        before: bNode,
      });
    }
  });

  const baseEdgeMap = new Map<string, FlowEdge>(baseEdges.map((e) => [e.id, e]));
  const targetEdgeMap = new Map<string, FlowEdge>(targetEdges.map((e) => [e.id, e]));

  targetEdgeMap.forEach((tEdge, id) => {
    const bEdge = baseEdgeMap.get(id);
    if (!bEdge) {
      items.push({
        id,
        entityType: 'edge',
        opType: 'add',
        label: resolveEdgeLabel(tEdge),
        description: `新增连线「${resolveEdgeLabel(tEdge)}」`,
        after: tEdge,
      });
      return;
    }
    const changes: string[] = [];
    const bLabel = resolveEdgeLabel(bEdge);
    const tLabel = resolveEdgeLabel(tEdge);
    if (bLabel !== tLabel) changes.push(`关系标签由「${bLabel}」变更为「${tLabel}」`);
    if (bEdge.source !== tEdge.source || bEdge.target !== tEdge.target) changes.push('连接端点重定向');
    if (JSON.stringify(bEdge.data?.waypoints || []) !== JSON.stringify(tEdge.data?.waypoints || [])) changes.push('折线拐点调整');
    if (changes.length > 0) {
      items.push({
        id,
        entityType: 'edge',
        opType: 'update',
        label: tLabel,
        description: changes.join('；'),
        changes,
        before: bEdge,
        after: tEdge,
      });
    }
  });

  baseEdgeMap.forEach((bEdge, id) => {
    if (!targetEdgeMap.has(id)) {
      items.push({
        id,
        entityType: 'edge',
        opType: 'delete',
        label: resolveEdgeLabel(bEdge),
        description: `删除连线「${resolveEdgeLabel(bEdge)}」`,
        before: bEdge,
      });
    }
  });

  const addedCount = items.filter((i) => i.opType === 'add').length;
  const updatedCount = items.filter((i) => i.opType === 'update').length;
  const deletedCount = items.filter((i) => i.opType === 'delete').length;

  return {
    baseLabel,
    targetLabel,
    items,
    summary: {
      addedCount,
      updatedCount,
      deletedCount,
      totalChanges: items.length,
    },
  };
}

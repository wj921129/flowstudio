/**
 * @fileoverview 因果链路聚光灯走查算法与决策分支解析
 * @description 基于有向图双向 BFS（上游来路 + 下游去路），支持 Decision 条件分支独立走查与跨泳道高亮
 */

import type { FlowNode, FlowEdge } from '@flowstudio/shared';

export interface PathSpotlightOptions {
  /** 决策节点分支过滤：'all' 或具体的连线标签如 '是' / '否' */
  decisionBranchFilter?: string | null;
}

export interface PathSpotlightResult {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  laneIds: Set<string>;
}

/**
 * 提取指定 Decision 节点的所有外出分支标签选项
 */
export function getDecisionBranches(decisionNodeId: string, edges: FlowEdge[]): string[] {
  const labels: string[] = [];
  for (const e of edges) {
    if (e.source === decisionNodeId) {
      const lbl = e.data?.label ? String(e.data.label).trim() : '';
      if (lbl && !labels.includes(lbl)) {
        labels.push(lbl);
      }
    }
  }
  return labels;
}

/**
 * 计算给定目标节点或连线的完整因果链路（双向 BFS）
 */
export function computePathSpotlight(
  nodes: FlowNode[],
  edges: FlowEdge[],
  targetId: string,
  options?: PathSpotlightOptions
): PathSpotlightResult {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const edgeMap = new Map(edges.map((e) => [e.id, e]));

  const highlightedNodeIds = new Set<string>();
  const highlightedEdgeIds = new Set<string>();
  const startNodeIds: string[] = [];

  // 判断 targetId 是连线还是节点
  const targetEdge = edgeMap.get(targetId);
  if (targetEdge) {
    highlightedEdgeIds.add(targetEdge.id);
    startNodeIds.push(targetEdge.source, targetEdge.target);
    highlightedNodeIds.add(targetEdge.source);
    highlightedNodeIds.add(targetEdge.target);
  } else {
    startNodeIds.push(targetId);
    highlightedNodeIds.add(targetId);
  }

  const branchFilter = options?.decisionBranchFilter;

  // 1. 下游 BFS (Forward: 从起点沿输出有向边遍历)
  const forwardQueue = [...startNodeIds];
  while (forwardQueue.length > 0) {
    const currId = forwardQueue.shift()!;
    const currNode = nodeMap.get(currId);

    for (const e of edges) {
      if (e.source === currId) {
        // 如果当前节点为 Decision 且配置了分支过滤，按分支标签筛选
        if (
          currNode?.type === 'decision' &&
          branchFilter &&
          branchFilter !== 'all'
        ) {
          const edgeLabel = e.data?.label ? String(e.data.label).trim() : '';
          if (edgeLabel !== branchFilter) {
            continue; // 跳过不符合筛选的分支
          }
        }

        highlightedEdgeIds.add(e.id);
        if (!highlightedNodeIds.has(e.target)) {
          highlightedNodeIds.add(e.target);
          forwardQueue.push(e.target);
        }
      }
    }
  }

  // 2. 上游 BFS (Backward: 从起点反向沿输入有向边遍历)
  const backwardQueue = [...startNodeIds];
  while (backwardQueue.length > 0) {
    const currId = backwardQueue.shift()!;

    for (const e of edges) {
      if (e.target === currId) {
        highlightedEdgeIds.add(e.id);
        if (!highlightedNodeIds.has(e.source)) {
          highlightedNodeIds.add(e.source);
          backwardQueue.push(e.source);
        }
      }
    }
  }

  // 3. 统计途经的泳道 (Lane)
  const highlightedLaneIds = new Set<string>();
  for (const nodeId of highlightedNodeIds) {
    const node = nodeMap.get(nodeId);
    if (node?.parentId) {
      const parent = nodeMap.get(node.parentId);
      if (parent?.type === 'lane') {
        highlightedLaneIds.add(parent.id);
      }
    }
  }

  return {
    nodeIds: highlightedNodeIds,
    edgeIds: highlightedEdgeIds,
    laneIds: highlightedLaneIds,
  };
}

/**
 * 计算全图全局链路走查高亮集合（所有参与连线的节点、连线及途经泳道）
 */
export function computeGlobalPathSpotlight(
  nodes: FlowNode[],
  edges: FlowEdge[]
): PathSpotlightResult {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const highlightedNodeIds = new Set<string>();
  const highlightedEdgeIds = new Set<string>();

  for (const e of edges) {
    highlightedEdgeIds.add(e.id);
    if (nodeMap.has(e.source)) highlightedNodeIds.add(e.source);
    if (nodeMap.has(e.target)) highlightedNodeIds.add(e.target);
  }

  const highlightedLaneIds = new Set<string>();
  for (const nodeId of highlightedNodeIds) {
    const node = nodeMap.get(nodeId);
    if (node?.parentId) {
      const parent = nodeMap.get(node.parentId);
      if (parent?.type === 'lane') {
        highlightedLaneIds.add(parent.id);
      }
    }
  }

  return {
    nodeIds: highlightedNodeIds,
    edgeIds: highlightedEdgeIds,
    laneIds: highlightedLaneIds,
  };
}

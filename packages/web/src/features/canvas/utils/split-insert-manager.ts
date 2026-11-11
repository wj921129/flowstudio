/**
 * @fileoverview 连线悬浮断键智能串接与下游局部推挤管理工具
 * @description 支持悬停连线检测 (<16px)、断键插入新节点、单向 DAG 下游局部推挤以及愈合式删除 (Heal-on-Delete)
 */

import type { FlowNode, FlowEdge, XYPosition } from '@flowstudio/shared';
import { getNodeDimensions } from './group-calculator.js';
import { generateEdgeId } from '../../../lib/node-utils.js';

/**
 * 递归计算节点的世界绝对坐标
 */
export function getNodeWorldPosition(node: FlowNode, byId: Map<string, FlowNode>): XYPosition {
  let curr: FlowNode | undefined = node;
  let wx = 0;
  let wy = 0;
  const visited = new Set<string>();

  while (curr && !visited.has(curr.id)) {
    visited.add(curr.id);
    wx += curr.position.x;
    wy += curr.position.y;
    curr = curr.parentId ? byId.get(curr.parentId) : undefined;
  }

  return { x: wx, y: wy };
}

/**
 * 计算节点锚点 (Handle) 的绝对坐标
 */
export function getHandlePoint(
  node: FlowNode,
  byId: Map<string, FlowNode>,
  handleId?: string,
  fallbackSide: 'source' | 'target' = 'source'
): XYPosition {
  const worldPos = getNodeWorldPosition(node, byId);
  const { width, height } = getNodeDimensions(node);

  const side = handleId || (fallbackSide === 'source' ? 'right' : 'left');

  switch (side) {
    case 'top':
      return { x: worldPos.x + width / 2, y: worldPos.y };
    case 'bottom':
      return { x: worldPos.x + width / 2, y: worldPos.y + height };
    case 'left':
      return { x: worldPos.x, y: worldPos.y + height / 2 };
    case 'right':
    default:
      return { x: worldPos.x + width, y: worldPos.y + height / 2 };
  }
}

/**
 * 计算点到线段的最短距离与垂足投影点
 */
export function pointToSegmentDistance(
  p: XYPosition,
  a: XYPosition,
  b: XYPosition
): { distance: number; projection: XYPosition } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return {
      distance: Math.hypot(p.x - a.x, p.y - a.y),
      projection: { x: a.x, y: a.y },
    };
  }

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = a.x + t * dx;
  const projY = a.y + t * dy;

  return {
    distance: Math.hypot(p.x - projX, p.y - projY),
    projection: { x: projX, y: projY },
  };
}

/**
 * 获取连线的完整折线段点集（包含源点、折点、目标点）
 */
export function getEdgePoints(
  edge: FlowEdge,
  nodes: FlowNode[],
  byId: Map<string, FlowNode>
): XYPosition[] {
  const src = byId.get(edge.source);
  const tgt = byId.get(edge.target);
  if (!src || !tgt) return [];

  const start = getHandlePoint(src, byId, edge.sourceHandle, 'source');
  const end = getHandlePoint(tgt, byId, edge.targetHandle, 'target');

  const waypoints = edge.data?.waypoints;
  if (Array.isArray(waypoints) && waypoints.length > 0) {
    return [start, ...waypoints, end];
  }

  // 默认正交中间折点
  const midX = (start.x + end.x) / 2;
  return [
    start,
    { x: midX, y: start.y },
    { x: midX, y: end.y },
    end,
  ];
}

/**
 * 探测光标或待插入节点中心附近最近的连线 (< 16px)
 */
export function findEdgeAtPosition(
  edges: FlowEdge[],
  nodes: FlowNode[],
  point: XYPosition,
  threshold = 16
): { edge: FlowEdge; distance: number; projection: XYPosition } | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let best: { edge: FlowEdge; distance: number; projection: XYPosition } | null = null;

  for (const edge of edges) {
    const pts = getEdgePoints(edge, nodes, byId);
    if (pts.length < 2) continue;

    for (let i = 0; i < pts.length - 1; i++) {
      const segA = pts[i];
      const segB = pts[i + 1];
      const { distance, projection } = pointToSegmentDistance(point, segA, segB);

      if (distance < threshold) {
        if (!best || distance < best.distance) {
          best = { edge, distance, projection };
        }
      }
    }
  }

  return best;
}

export interface SplitInsertOptions {
  nodes: FlowNode[];
  edges: FlowEdge[];
  targetEdge: FlowEdge;
  newNode: FlowNode;
  /** 安全间距阈值，低于此值触发下游顺推，默认 60px */
  safetyGap?: number;
}

export interface SplitInsertResult {
  nextNodes: FlowNode[];
  nextEdges: FlowEdge[];
  pushedNodeIds: string[];
  splitEdgeId: string;
}

/**
 * 断键串接与下游局部推挤主算法
 */
export function splitEdgeAndInsertNode({
  nodes,
  edges,
  targetEdge,
  newNode,
  safetyGap = 60,
}: SplitInsertOptions): SplitInsertResult {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const targetNode = byId.get(targetEdge.target);

  // 1. 拆分连线：E (S -> T) => (S -> NewNode) + (NewNode -> T)
  const remainingEdges = edges.filter((e) => e.id !== targetEdge.id);

  // 确定新连线默认接入方位 (根据源与目标方向倾向)
  const isTargetBelow = targetNode ? targetNode.position.y > newNode.position.y + 40 : false;
  const inTargetHandle = isTargetBelow ? 'top' : 'left';
  const outSourceHandle = isTargetBelow ? 'bottom' : 'right';

  const inEdge: FlowEdge = {
    id: generateEdgeId(targetEdge.source, newNode.id),
    source: targetEdge.source,
    target: newNode.id,
    sourceHandle: targetEdge.sourceHandle,
    targetHandle: inTargetHandle,
    type: targetEdge.type || 'orthogonal',
    markerEnd: targetEdge.markerEnd || { type: 'arrowclosed' as any },
    animated: targetEdge.animated,
    data: {
      ...targetEdge.data, // 完整继承原连线上的标签（如“是/否/驳回”）与样式
    },
  };

  const outEdge: FlowEdge = {
    id: generateEdgeId(newNode.id, targetEdge.target),
    source: newNode.id,
    target: targetEdge.target,
    sourceHandle: outSourceHandle,
    targetHandle: targetEdge.targetHandle,
    type: targetEdge.type || 'orthogonal',
    markerEnd: targetEdge.markerEnd || { type: 'arrowclosed' as any },
    animated: targetEdge.animated,
    data: {},
  };

  const nextEdges: FlowEdge[] = [...remainingEdges, inEdge, outEdge];

  // 2. 下游同流向局部自适应推挤 (Local Downstream Push)
  const pushedNodeIds: string[] = [];
  const baseNodes = nodes.filter((n) => n.id !== newNode.id);
  let nextNodes: FlowNode[] = [...baseNodes, newNode];

  if (targetNode) {
    const { width: newW, height: newH } = getNodeDimensions(newNode);

    // 判断主轴流向：检查所属泳道或几何排布
    let parentPool: FlowNode | undefined;
    if (newNode.parentId) {
      const parent = byId.get(newNode.parentId);
      if (parent?.type === 'lane' && parent.parentId) {
        parentPool = byId.get(parent.parentId);
      } else if (parent?.type === 'pool') {
        parentPool = parent;
      }
    }

    const isVertical =
      parentPool?.data?.orientation === 'vertical' ||
      (targetNode.position.y > newNode.position.y + 40 &&
        Math.abs(targetNode.position.x - newNode.position.x) < 50);

    const mainAxis = isVertical ? 'y' : 'x';

    // 计算当前 newNode 与下游 targetNode 的间距
    const currentGap = isVertical
      ? targetNode.position.y - (newNode.position.y + newH)
      : targetNode.position.x - (newNode.position.x + newW);

    if (currentGap < safetyGap) {
      const pushDelta = Math.round(
        (isVertical ? newH : newW) + safetyGap - Math.max(0, currentGap)
      );

      // 单向 DAG 可达性遍历：仅查找 targetNode 及其同流向的下游节点集合
      const downstreamSet = new Set<string>();
      const queue: string[] = [targetNode.id];

      while (queue.length > 0) {
        const currId = queue.shift()!;
        if (downstreamSet.has(currId)) continue;
        downstreamSet.add(currId);

        // 仅沿有向输出连线向下查找
        for (const e of edges) {
          if (e.source === currId && !downstreamSet.has(e.target)) {
            queue.push(e.target);
          }
        }
      }

      // 顺推下游节点
      nextNodes = nextNodes.map((n) => {
        if (!downstreamSet.has(n.id)) return n;
        // 锚定锁强约束：位置锁定 (position) 或完全锁定 (full) 的节点坚决禁止被推移
        if (n.data?.lockMode === 'position' || n.data?.lockMode === 'full') {
          return n;
        }
        pushedNodeIds.push(n.id);

        if (mainAxis === 'x') {
          return {
            ...n,
            position: { ...n.position, x: n.position.x + pushDelta },
          };
        } else {
          return {
            ...n,
            position: { ...n.position, y: n.position.y + pushDelta },
          };
        }
      });

      // 联动撑开所属 Lane / Pool 容器尺寸
      const affectedLaneIds = new Set<string>();
      for (const id of downstreamSet) {
        const node = byId.get(id);
        if (node?.parentId) affectedLaneIds.add(node.parentId);
      }

      if (affectedLaneIds.size > 0) {
        nextNodes = nextNodes.map((n) => {
          if (!affectedLaneIds.has(n.id) && n.id !== parentPool?.id) return n;

          // 若节点在泳道内顺推导致靠右/靠底越界，自适应扩大容器
          const children = nextNodes.filter((c) => c.parentId === n.id);
          if (children.length === 0) return n;

          let maxChildRight = 0;
          let maxChildBottom = 0;
          for (const c of children) {
            const { width: cw, height: ch } = getNodeDimensions(c);
            maxChildRight = Math.max(maxChildRight, c.position.x + cw + 40);
            maxChildBottom = Math.max(maxChildBottom, c.position.y + ch + 40);
          }

          const curW = n.width ?? 800;
          const curH = n.height ?? 200;
          const nextW = Math.max(curW, maxChildRight);
          const nextH = Math.max(curH, maxChildBottom);

          if (nextW !== curW || nextH !== curH) {
            return {
              ...n,
              width: nextW,
              height: nextH,
              style: { ...n.style, width: nextW, height: nextH },
            };
          }
          return n;
        });
      }
    }
  }

  return {
    nextNodes,
    nextEdges,
    pushedNodeIds,
    splitEdgeId: targetEdge.id,
  };
}

/**
 * 愈合式删除 (Heal-on-Delete)：
 * 若选中节点为单入单出，删除该节点的同时自动将上游与下游节点重新直连
 */
export function healOnDelete(
  nodeId: string,
  nodes: FlowNode[],
  edges: FlowEdge[]
): { canHeal: boolean; nextNodes: FlowNode[]; nextEdges: FlowEdge[]; healedEdge?: FlowEdge } {
  const targetNode = nodes.find((n) => n.id === nodeId);
  // 锚定锁强约束：完全锁定 (full) 的节点禁止愈合删除
  if (!targetNode || targetNode.data?.lockMode === 'full') {
    return {
      canHeal: false,
      nextNodes: nodes,
      nextEdges: edges,
    };
  }

  const incoming = edges.filter((e) => e.target === nodeId);
  const outgoing = edges.filter((e) => e.source === nodeId);

  if (incoming.length === 1 && outgoing.length === 1) {
    const inEdge = incoming[0];
    const outEdge = outgoing[0];

    // 重新连接上游与下游
    const directEdge: FlowEdge = {
      id: generateEdgeId(inEdge.source, outEdge.target),
      source: inEdge.source,
      target: outEdge.target,
      sourceHandle: inEdge.sourceHandle,
      targetHandle: outEdge.targetHandle,
      type: inEdge.type || outEdge.type || 'orthogonal',
      markerEnd: outEdge.markerEnd || inEdge.markerEnd || { type: 'arrowclosed' as any },
      data: {
        ...(inEdge.data?.label ? { label: inEdge.data.label } : outEdge.data?.label ? { label: outEdge.data.label } : {}),
      },
    };

    const nextNodes = nodes.filter((n) => n.id !== nodeId);
    const nextEdges = edges
      .filter((e) => e.id !== inEdge.id && e.id !== outEdge.id)
      .concat(directEdge);

    return {
      canHeal: true,
      nextNodes,
      nextEdges,
      healedEdge: directEdge,
    };
  }

  return {
    canHeal: false,
    nextNodes: nodes,
    nextEdges: edges,
  };
}

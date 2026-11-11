/**
 * @fileoverview 泳道节点拖拽吸附与尺寸自动撑开管理器
 * @description 处理普通节点拖入/拖出泳道时的父子关系绑定、坐标系转换与容器自动扩容
 */

import type { FlowNode, XYPosition } from '@flowstudio/shared';
import { getNodeDimensions } from './group-calculator';
import { isNodeLocked } from './node-lock-manager';

/**
 * 计算任意节点在画布上的全局世界绝对坐标
 */
export function getAbsoluteWorldPosition(nodeId: string, nodes: FlowNode[]): XYPosition {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return { x: 0, y: 0 };

  let currentX = node.position.x;
  let currentY = node.position.y;
  let currentParentId = node.parentId;

  // 递归累加祖先节点坐标
  const visited = new Set<string>([nodeId]);
  while (currentParentId) {
    if (visited.has(currentParentId)) break; // 防循环引用
    visited.add(currentParentId);

    const parentNode = nodes.find((n) => n.id === currentParentId);
    if (!parentNode) break;

    currentX += parentNode.position.x;
    currentY += parentNode.position.y;
    currentParentId = parentNode.parentId;
  }

  return { x: currentX, y: currentY };
}

/**
 * 获取泳道条带的全局绝对包围盒
 */
export function getLaneAbsoluteBounds(lane: FlowNode, nodes: FlowNode[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const worldPos = getAbsoluteWorldPosition(lane.id, nodes);
  const { width, height } = getNodeDimensions(lane);
  return {
    x: worldPos.x,
    y: worldPos.y,
    width,
    height,
  };
}

/**
 * 核心处理器：处理节点拖拽结束时的泳道吸附判定与父子坐标转换
 * @param draggedNodeId 被拖动的节点 ID
 * @param currentNodes 当前全量节点列表
 * @returns 是否发生嵌套状态或坐标调整，及更新后的新节点列表
 */
export function handleNodeDragNesting(
  draggedNodeId: string,
  currentNodes: FlowNode[]
): { updated: boolean; nextNodes: FlowNode[] } {
  const draggedNode = currentNodes.find((n) => n.id === draggedNodeId);
  if (!draggedNode) return { updated: false, nextNodes: currentNodes };

  // 泳道池和泳道容器本身不作为被吸附的业务子节点
  if (draggedNode.type === 'pool' || draggedNode.type === 'lane') {
    return { updated: false, nextNodes: currentNodes };
  }

  const { width: nodeW, height: nodeH } = getNodeDimensions(draggedNode);
  const nodeWorldPos = getAbsoluteWorldPosition(draggedNode.id, currentNodes);
  const centerWorldX = nodeWorldPos.x + nodeW / 2;
  const centerWorldY = nodeWorldPos.y + nodeH / 2;

  const lanes = currentNodes.filter((n) => n.type === 'lane');

  // 寻找被拖拽节点中心点所落入的目标泳道
  let targetLane: FlowNode | null = null;
  for (const lane of lanes) {
    const bounds = getLaneAbsoluteBounds(lane, currentNodes);
    if (
      centerWorldX >= bounds.x &&
      centerWorldX <= bounds.x + bounds.width &&
      centerWorldY >= bounds.y &&
      centerWorldY <= bounds.y + bounds.height
    ) {
      targetLane = lane;
      break;
    }
  }

  // 若常规矩形未命中，但该节点原本就属于某条泳道，检查是否属于沿泳道方向延伸扩容
  if (!targetLane && draggedNode.parentId) {
    const origLane = lanes.find((l) => l.id === draggedNode.parentId);
    if (origLane) {
      const origBounds = getLaneAbsoluteBounds(origLane, currentNodes);
      const pool = origLane.parentId ? currentNodes.find((n) => n.id === origLane.parentId) : null;
      const isHorizontal = (pool?.data?.orientation ?? 'horizontal') === 'horizontal';

      if (isHorizontal) {
        // 横向泳道：上下在条带内且位于表头右侧 -> 认定为沿泳道向右延伸
        if (
          centerWorldY >= origBounds.y &&
          centerWorldY <= origBounds.y + origBounds.height &&
          centerWorldX >= origBounds.x
        ) {
          targetLane = origLane;
        }
      } else {
        // 纵向泳道：左右在条带内且位于表头下方 -> 认定为沿泳道向下延伸
        if (
          centerWorldX >= origBounds.x &&
          centerWorldX <= origBounds.x + origBounds.width &&
          centerWorldY >= origBounds.y
        ) {
          targetLane = origLane;
        }
      }
    }
  }

  let nextNodes = [...currentNodes];
  let didChange = false;

  if (targetLane) {
    // 1. 拖入或处于目标泳道中
    const laneWorldPos = getAbsoluteWorldPosition(targetLane.id, currentNodes);
    const localX = nodeWorldPos.x - laneWorldPos.x;
    const localY = nodeWorldPos.y - laneWorldPos.y;

    const isDifferentParent = draggedNode.parentId !== targetLane.id;

    if (isDifferentParent) {
      // 换算并赋予 parentId
      nextNodes = nextNodes.map((n) => {
        if (n.id === draggedNode.id) {
          return {
            ...n,
            parentId: targetLane!.id,
            extent: 'parent',
            position: { x: Math.max(10, localX), y: Math.max(10, localY) },
          };
        }
        return n;
      });
      didChange = true;
    }

    // 2. 泳道自动撑开检测 (Auto-expand)
    const laneChildren = nextNodes.filter((n) => n.parentId === targetLane!.id);
    let maxChildRight = 0;
    let maxChildBottom = 0;

    for (const child of laneChildren) {
      const { width: cw, height: ch } = getNodeDimensions(child);
      maxChildRight = Math.max(maxChildRight, child.position.x + cw);
      maxChildBottom = Math.max(maxChildBottom, child.position.y + ch);
    }

    const { width: currentLaneW, height: currentLaneH } = getNodeDimensions(targetLane);
    const padding = 40;
    const neededLaneW = Math.max(currentLaneW, maxChildRight + padding);
    const neededLaneH = Math.max(currentLaneH, maxChildBottom + padding);

    if (!isNodeLocked(targetLane, 'position') && (neededLaneW > currentLaneW || neededLaneH > currentLaneH)) {
      nextNodes = nextNodes.map((n) => {
        if (n.id === targetLane!.id) {
          return {
            ...n,
            width: neededLaneW,
            height: neededLaneH,
            style: { ...(n.style || {}), width: neededLaneW, height: neededLaneH },
          };
        }
        return n;
      });

      if (targetLane.parentId) {
        const pool = nextNodes.find((n) => n.id === targetLane!.parentId);
        if (pool && !isNodeLocked(pool, 'position')) {
          const poolLanes = nextNodes.filter((n) => n.parentId === pool.id);
          const isHorizontal = (pool.data?.orientation ?? 'horizontal') === 'horizontal';

          let poolTotalW = pool.width ?? 800;
          let poolTotalH = pool.height ?? 400;

          if (isHorizontal) {
            poolTotalW = Math.max(poolTotalW, neededLaneW);
            const totalLaneHeights = poolLanes.reduce(
              (sum, l) => sum + (l.height ?? (l.style?.height as number) ?? 200),
              0
            );
            poolTotalH = Math.max(poolTotalH, totalLaneHeights + (pool.data?.headerSize ?? 40));
          } else {
            poolTotalH = Math.max(poolTotalH, neededLaneH);
            const totalLaneWidths = poolLanes.reduce(
              (sum, l) => sum + (l.width ?? (l.style?.width as number) ?? 220),
              0
            );
            poolTotalW = Math.max(poolTotalW, totalLaneWidths + (pool.data?.headerSize ?? 40));
          }

          nextNodes = nextNodes.map((n) => {
            if (n.id === pool.id) {
              return {
                ...n,
                width: poolTotalW,
                height: poolTotalH,
                style: { ...(n.style || {}), width: poolTotalW, height: poolTotalH },
              };
            }
            return n;
          });
        }
      }

      didChange = true;
    }
  } else if (draggedNode.parentId && lanes.some((l) => l.id === draggedNode.parentId)) {
    // 3. 拖出原泳道，回到画布顶层
    nextNodes = nextNodes.map((n) => {
      if (n.id === draggedNode.id) {
        return {
          ...n,
          parentId: undefined,
          extent: undefined,
          position: { x: nodeWorldPos.x, y: nodeWorldPos.y },
        };
      }
      return n;
    });
    didChange = true;
  }

  return { updated: didChange, nextNodes };
}

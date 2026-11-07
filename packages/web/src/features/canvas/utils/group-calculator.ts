/**
 * @fileoverview 画布包围盒与相对/世界坐标系换算工具
 * @description 支持多选成组外接包围盒动态计算，以及父子容器坐标系的精确双向换算
 */

import type { FlowNode, XYPosition } from '@flowstudio/shared';
import { getNodeRegistryEntry } from '@flowstudio/shared';

/**
 * 获取节点的实际宽高尺寸
 * 优先读取 node.width/height，其次读取 node.style.width/height，最后降级至节点注册表默认尺寸
 */
export function getNodeDimensions(node: FlowNode): { width: number; height: number } {
  const styleWidth = typeof node.style?.width === 'number' ? node.style.width : undefined;
  const styleHeight = typeof node.style?.height === 'number' ? node.style.height : undefined;
  const def = getNodeRegistryEntry(node.type);
  const width = node.width ?? styleWidth ?? (def ? def.defaultSize.width : 160);
  const height = node.height ?? styleHeight ?? (def ? def.defaultSize.height : 80);
  return { width, height };
}

/**
 * 计算多个节点集合的外接包围盒 (Bounding Box)
 * @param nodes 待计算的节点集合
 * @param padding 外周填充边距，默认为 20px
 * @returns 包含 x, y, width, height 的包围盒结构
 */
export function computeBoundingBox(
  nodes: FlowNode[],
  padding = 20
): { x: number; y: number; width: number; height: number } {
  if (nodes.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    const { width, height } = getNodeDimensions(node);
    const x = node.position.x;
    const y = node.position.y;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }

  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}

/**
 * 将世界坐标转换为父容器内部的相对坐标
 * @param worldPos 节点的世界绝对坐标
 * @param parentPos 父容器的世界绝对坐标
 */
export function toLocalPosition(worldPos: XYPosition, parentPos: XYPosition): XYPosition {
  return {
    x: worldPos.x - parentPos.x,
    y: worldPos.y - parentPos.y,
  };
}

/**
 * 将父容器内部的相对坐标转换为世界绝对坐标
 * @param localPos 节点在父容器内部的相对坐标
 * @param parentPos 父容器的世界绝对坐标
 */
export function toWorldPosition(localPos: XYPosition, parentPos: XYPosition): XYPosition {
  return {
    x: localPos.x + parentPos.x,
    y: localPos.y + parentPos.y,
  };
}

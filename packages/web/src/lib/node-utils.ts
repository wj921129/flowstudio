/**
 * @fileoverview 节点与图元工具函数
 * @description 提供节点工厂函数、唯一 ID 生成、网格对齐等通用逻辑
 */

import type { FlowNode, FlowNodeType } from '@flowstudio/shared';
import {
  NODE_REGISTRY_RECORD,
  DEFAULT_SNAP_GRID,
  getNodeRegistryEntry,
} from '@flowstudio/shared';

/**
 * 生成全局唯一 ID
 * @param prefix 前缀标识，默认为 'node'
 */
export function generateUniqueId(prefix = 'node'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  // 降级使用时间戳 + 随机字符串
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 生成连线唯一 ID
 * @param source 源节点 ID
 * @param target 目标节点 ID
 */
export function generateEdgeId(source: string, target: string): string {
  const shortId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 8);
  return `edge_${source}_${target}_${shortId}`;
}

/**
 * 根据流程图节点类型与画布坐标生成标准 FlowNode 实例
 * @param type 节点类型
 * @param position 画布落点坐标 { x, y }
 * @returns 完整的 FlowNode 节点对象
 */
export function createNodeFromType(
  type: FlowNodeType,
  position: { x: number; y: number }
): FlowNode {
  const entry = getNodeRegistryEntry(type) ?? NODE_REGISTRY_RECORD[type];
  const width = entry ? entry.defaultSize.width : 160;
  const height = entry ? entry.defaultSize.height : 80;
  const label = entry ? entry.label : type;

  return {
    id: generateUniqueId(type),
    type,
    position: {
      x: position.x,
      y: position.y,
    },
    data: {
      label,
      type,
    },
    width,
    height,
    style: {
      width,
      height,
    },
  };
}

/**
 * 将坐标对齐至指定网格步长
 * @param position 原始坐标
 * @param snapGrid 网格步长 [gridX, gridY]
 */
export function snapPositionToGrid(
  position: { x: number; y: number },
  snapGrid: [number, number] = DEFAULT_SNAP_GRID
): { x: number; y: number } {
  const [gridX, gridY] = snapGrid;
  return {
    x: Math.round(position.x / gridX) * gridX,
    y: Math.round(position.y / gridY) * gridY,
  };
}

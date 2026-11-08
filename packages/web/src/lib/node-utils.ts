/**
 * @fileoverview 节点与图元工具函数
 * @description 提供节点工厂函数与唯一 ID 生成等通用逻辑
 */

import type { FlowNode, FlowNodeType } from '@flowstudio/shared';
import { getNodeRegistryEntry } from '@flowstudio/shared';

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
  const entry = getNodeRegistryEntry(type);
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

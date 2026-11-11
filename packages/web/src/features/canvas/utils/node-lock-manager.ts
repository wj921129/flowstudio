/**
 * @fileoverview 统一节点锚定锁守卫工具 (Node Lock Guard)
 * @description 统一定义全画布图元在移动、对齐、分布、成组/解散、批量改色、删除及自动推挤等路径下的锁定判定准则，
 *              杜绝任何绕过 PRD 5.2「锁定节点 100% 保持不动与受保护」的行为
 */

import type { FlowNode, NodeLockMode } from '@flowstudio/shared';

export type LockCheckType =
  | 'position'   // 位置移动锁定：检查是否禁止拖拽移动或对齐/分布/自动顺推调整坐标（position 或 full 均生效）
  | 'content'    // 内容与样式修改锁定：检查是否禁止修改文案、属性、调色板颜色（full 生效）
  | 'hierarchy'  // 父子层级锁定：检查是否禁止改变 parentId/extent 或加入/解散组合（full 生效）
  | 'delete'     // 删除锁定：检查是否禁止普通删除或愈合式删除（full 生效）
  | 'full'       // 完全锁定（full 生效）
  | 'any';       // 任意锁定（position 或 full 均生效）

/**
 * 判断单个节点是否受到指定类型的锚定锁约束
 */
export function isNodeLocked(
  node: FlowNode | undefined | null,
  check: LockCheckType = 'any'
): boolean {
  if (!node || !node.data?.lockMode || node.data.lockMode === 'none') {
    return false;
  }

  const mode = node.data.lockMode;

  switch (check) {
    case 'position':
      return mode === 'position' || mode === 'full';
    case 'content':
    case 'hierarchy':
    case 'delete':
    case 'full':
      return mode === 'full';
    case 'any':
    default:
      return mode === 'position' || mode === 'full';
  }
}

/**
 * 从节点列表中过滤出未受指定锁约束的节点集合
 */
export function filterUnlockedNodes(
  nodes: FlowNode[],
  check: LockCheckType = 'any'
): FlowNode[] {
  return nodes.filter((n) => !isNodeLocked(n, check));
}

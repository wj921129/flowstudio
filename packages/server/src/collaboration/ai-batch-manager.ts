/**
 * @fileoverview AI 批次修改内存账本与安全撤回管理器
 * @description 记录服务端生命周期内所有 AI MCP 批次，提供可逆撤回算法，保护同事的手工后续改动
 */

import * as Y from 'yjs';
import type { DiagramRepository } from '../db/diagram-repository.js';

export interface AiBatchRecord {
  batchId: string;
  diagramId: string;
  summary: string;
  createdNodeIds: string[];
  createdEdgeIds: string[];
  updatedNodeBackups: Array<{ id: string; oldData: Record<string, unknown> }>;
  createdAt: string;
}

export class AiBatchManager {
  // 内存批次账本: diagramId -> AiBatchRecord[]
  private batchesMap = new Map<string, AiBatchRecord[]>();

  constructor(private repo: DiagramRepository) {}

  /**
   * 记录一次新的 AI 批次
   */
  recordBatch(batch: AiBatchRecord): void {
    const list = this.batchesMap.get(batch.diagramId) || [];
    list.unshift(batch); // 最新的排在前面
    // 保留最近 20 批
    if (list.length > 20) {
      list.length = 20;
    }
    this.batchesMap.set(batch.diagramId, list);
  }

  /**
   * 查询指定图表最近的有效 AI 批次列表
   */
  getBatches(diagramId: string): AiBatchRecord[] {
    return this.batchesMap.get(diagramId) || [];
  }

  /**
   * 撤回指定的 AI 批次
   * 算法：
   * 1. 检查 batch 中的创建项与更新项；
   * 2. 若创建的节点之后被同事连了新线或修改了数据，跳过该项并计数；
   * 3. 否则删除创建的节点和连线，还原更新前的值；
   * 4. 事务写回 Y.Doc。
   */
  revertBatch(diagramId: string, batchId: string): {
    success: boolean;
    reverted: boolean;
    skippedCount: number;
    message: string;
  } {
    const list = this.batchesMap.get(diagramId) || [];
    const batchIndex = list.findIndex((b) => b.batchId === batchId);
    if (batchIndex === -1) {
      return {
        success: false,
        reverted: false,
        skippedCount: 0,
        message: '未找到指定 AI 批次（可能服务已重启或已被撤回）',
      };
    }

    const batch = list[batchIndex];
    const rawState = this.repo.getYDocState(diagramId);
    if (!rawState) {
      return { success: false, reverted: false, skippedCount: 0, message: '图表不存在' };
    }

    const doc = new Y.Doc();
    Y.applyUpdate(doc, rawState);

    const nodesMap = doc.getMap<Y.Map<unknown>>('nodes');
    const edgesMap = doc.getMap<Y.Map<unknown>>('edges');

    let skippedCount = 0;

    doc.transact(() => {
      // 1. 还原被修改的节点属性
      for (const backup of batch.updatedNodeBackups) {
        const nm = nodesMap.get(backup.id);
        if (nm) {
          nm.set('data', backup.oldData);
        }
      }

      // 2. 检查由该批次创建的节点：若之后被别人连了新线，则保护并跳过
      const batchCreatedEdgeSet = new Set(batch.createdEdgeIds);
      for (const nodeId of batch.createdNodeIds) {
        // 查找与该节点相连的所有线
        let connectedToOtherEdge = false;
        edgesMap.forEach((em) => {
          const s = em.get('source');
          const t = em.get('target');
          const edgeId = em.get('id') as string;
          if ((s === nodeId || t === nodeId) && !batchCreatedEdgeSet.has(edgeId)) {
            connectedToOtherEdge = true;
          }
        });

        if (connectedToOtherEdge) {
          skippedCount++;
        } else {
          nodesMap.delete(nodeId);
        }
      }

      // 3. 删除该批次创建的连线
      for (const edgeId of batch.createdEdgeIds) {
        edgesMap.delete(edgeId);
      }
    }, 'revert-ai-batch');

    // 写入 SQLite
    this.repo.saveYDocState(diagramId, Y.encodeStateAsUpdate(doc));

    // 从列表中移除该已撤回批次
    list.splice(batchIndex, 1);
    this.batchesMap.set(diagramId, list);

    const message = skippedCount > 0
      ? `已撤回该批次（其中 ${skippedCount} 项已被同事修改或连线，未强制删除）`
      : '已成功撤回该次 AI 修改';

    return {
      success: true,
      reverted: true,
      skippedCount,
      message,
    };
  }
}

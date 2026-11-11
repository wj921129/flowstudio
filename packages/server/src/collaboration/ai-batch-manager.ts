/**
 * @fileoverview AI 批次持久化账本与字段级防冲突撤回管理器
 * @description 记录每次 AI 调用的实体级 Diff 明细并落库 SQLite；
 *              撤回时逐字段比对，仅当当前值仍等于 AI 写入后的值才还原，
 *              人类已二次修改的字段安全跳过并记入 skipped 明细。
 */

import * as Y from 'yjs';
import type {
  AiBatchEntityDiff,
  AiBatchRecord,
  AiBatchRevertResult,
  AiBatchSkippedDetail,
  AiBatchStatus,
} from '@flowstudio/shared';
import type { DiagramRepository } from '../db/diagram-repository.js';
import { DocumentWriter } from './document-writer.js';
import {
  applyMapState,
  mapMatchesState,
  revertMapFields,
  snapshotMap,
} from './entity-state.js';

export interface LegacyBatchInput {
  batchId: string;
  diagramId: string;
  summary: string;
  createdAt: string;
  agentName?: string;
  status?: AiBatchStatus;
  diffs?: AiBatchEntityDiff[];
  createdNodeIds?: string[];
  createdEdgeIds?: string[];
  updatedNodeBackups?: Array<{ id: string; oldData: Record<string, unknown> }>;
}

export class AiBatchManager {
  private writer: DocumentWriter;

  constructor(
    private repo: DiagramRepository,
    writer?: DocumentWriter,
  ) {
    this.writer = writer ?? new DocumentWriter(repo);
  }

  /**
   * 记录一次新的 AI 批次（支持新 diffs 契约与旧版字段入参）
   */
  recordBatch(input: LegacyBatchInput): void {
    const record = this.normalizeBatch(input);
    this.repo.insertAiBatch(record);
  }

  /**
   * 查询指定图表最近的有效 AI 批次列表（含 diffs 明细）
   */
  getBatches(diagramId: string): AiBatchRecord[] {
    return this.repo.listAiBatches(diagramId);
  }

  /**
   * 撤回指定的 AI 批次（全部未撤回项）
   */
  async revertBatch(diagramId: string, batchId: string): Promise<AiBatchRevertResult> {
    const batch = this.repo.getAiBatch(diagramId, batchId);
    if (!batch) {
      return this.failure(diagramId, batchId, '未找到指定 AI 批次（可能已被撤回或账本不存在）');
    }

    const targets = batch.diffs.filter((diff) => !diff.reverted);
    if (targets.length === 0) {
      return this.failure(diagramId, batchId, '该批次所有变更均已撤回');
    }

    return this.performRevert(batch, targets);
  }

  /**
   * 单点/多点精细化撤回（Cherry-Pick）：仅回滚指定实体
   */
  async revertItems(
    diagramId: string,
    batchId: string,
    entityIds: string[],
  ): Promise<AiBatchRevertResult> {
    const batch = this.repo.getAiBatch(diagramId, batchId);
    if (!batch) {
      return this.failure(diagramId, batchId, '未找到指定 AI 批次（可能已被撤回或账本不存在）');
    }

    const targetSet = new Set(entityIds);
    const targets = batch.diffs.filter(
      (diff) => targetSet.has(diff.entityId) && !diff.reverted,
    );

    if (targets.length === 0) {
      return this.failure(diagramId, batchId, '指定实体不在该批次中或已撤回');
    }

    return this.performRevert(batch, targets);
  }

  private async performRevert(
    batch: AiBatchRecord,
    targets: AiBatchEntityDiff[],
  ): Promise<AiBatchRevertResult> {
    const diagramId = batch.diagramId;
    const batchId = batch.batchId;
    const skipped: AiBatchSkippedDetail[] = [];
    const revertedEntityIds = new Set<string>();
    const processedDiffs = new Set<AiBatchEntityDiff>();
    const batchAddedEdgeIds = new Set(
      batch.diffs
        .filter((diff) => diff.entityType === 'edge' && diff.opType === 'add')
        .map((diff) => diff.entityId),
    );
    const batchAddedEdgeDiffs = new Map(
      batch.diffs
        .filter((diff) => diff.entityType === 'edge' && diff.opType === 'add')
        .map((diff) => [diff.entityId, diff]),
    );

    await this.writer.mutate(diagramId, `ai-revert:${batchId}`, (doc) => {
      const nodesMap = doc.getMap<Y.Map<unknown>>('nodes');
      const edgesMap = doc.getMap<Y.Map<unknown>>('edges');

      // 预建 node → edge 邻接索引，避免逐节点全表扫边的 O(N·E) 开销
      const edgesByNode = new Map<string, Set<string>>();
      const indexEdge = (edgeId: string, source: unknown, target: unknown) => {
        for (const endpoint of [source, target]) {
          if (typeof endpoint !== 'string') continue;
          let edgeIds = edgesByNode.get(endpoint);
          if (!edgeIds) {
            edgeIds = new Set<string>();
            edgesByNode.set(endpoint, edgeIds);
          }
          edgeIds.add(edgeId);
        }
      };
      const unindexEdge = (edgeId: string, source?: unknown, target?: unknown) => {
        if (source !== undefined || target !== undefined) {
          for (const endpoint of [source, target]) {
            if (typeof endpoint === 'string') edgesByNode.get(endpoint)?.delete(edgeId);
          }
          return;
        }
        for (const edgeIds of edgesByNode.values()) edgeIds.delete(edgeId);
      };
      const deleteEdge = (edgeId: string) => {
        const edgeMap = edgesMap.get(edgeId);
        if (edgeMap) {
          unindexEdge(edgeId, edgeMap.get('source'), edgeMap.get('target'));
          edgesMap.delete(edgeId);
        } else {
          unindexEdge(edgeId);
        }
      };
      const hasHumanAttachedEdge = (nodeId: string): boolean => {
        const attached = edgesByNode.get(nodeId);
        if (!attached) return false;
        for (const edgeId of attached) {
          if (!batchAddedEdgeIds.has(edgeId) && edgesMap.has(edgeId)) return true;
        }
        return false;
      };

      edgesMap.forEach((edgeMap, edgeId) => {
        indexEdge(edgeId, edgeMap.get('source'), edgeMap.get('target'));
      });

      // 逆序回放：同一实体多次修改时，先撤销最后一次
      for (const diff of [...targets].reverse()) {
        const map = diff.entityType === 'node' ? nodesMap : edgesMap;
        const current = map.get(diff.entityId);

        if (diff.opType === 'add') {
          if (!current) {
            revertedEntityIds.add(diff.entityId);
            processedDiffs.add(diff);
            continue;
          }

          if (diff.afterState && !mapMatchesState(current, diff.afterState)) {
            skipped.push({
              entityId: diff.entityId,
              entityType: diff.entityType,
              reason: '实体已被人工修改，安全跳过',
            });
            continue;
          }

          if (diff.entityType === 'node' && hasHumanAttachedEdge(diff.entityId)) {
            skipped.push({
              entityId: diff.entityId,
              entityType: 'node',
              reason: '该节点已被人工新增连线，安全跳过删除',
            });
            continue;
          }

          if (diff.entityType === 'edge') {
            deleteEdge(diff.entityId);
          } else {
            map.delete(diff.entityId);
          }
          revertedEntityIds.add(diff.entityId);
          processedDiffs.add(diff);

          // 级联清理同批次创建的悬挂连线，避免留下指向空节点的脏边
          if (diff.entityType === 'node') {
            for (const [edgeId, edgeDiff] of batchAddedEdgeDiffs) {
              if (processedDiffs.has(edgeDiff)) continue;
              const after = edgeDiff.afterState;
              if (!after) continue;
              if (after.source !== diff.entityId && after.target !== diff.entityId) continue;

              const edgeMap = edgesMap.get(edgeId);
              if (!edgeMap) {
                processedDiffs.add(edgeDiff);
                revertedEntityIds.add(edgeId);
                continue;
              }

              if (!mapMatchesState(edgeMap, after)) {
                // 连线已被人工二次修改，保留人工成果
                continue;
              }

              deleteEdge(edgeId);
              processedDiffs.add(edgeDiff);
              revertedEntityIds.add(edgeId);
            }
          }
          continue;
        }

        if (diff.opType === 'update') {
          if (!current) {
            skipped.push({
              entityId: diff.entityId,
              entityType: diff.entityType,
              reason: '实体已不存在，无法还原',
            });
            continue;
          }

          const outcome = revertMapFields(current, diff.beforeState, diff.afterState);
          for (const field of outcome.skippedFields) {
            skipped.push({
              entityId: diff.entityId,
              entityType: diff.entityType,
              field,
              reason: `字段 ${field} 已被人工修改，安全跳过`,
            });
          }

          if (outcome.changed) {
            revertedEntityIds.add(diff.entityId);
            processedDiffs.add(diff);
          } else if (outcome.skippedFields.length === 0) {
            // 当前值本就等于 beforeState：无需改动，视为已完成撤回
            revertedEntityIds.add(diff.entityId);
            processedDiffs.add(diff);
          }
          // 全部字段都被人工改写时保持未撤回状态，避免与 skipped 双重计数
          continue;
        }

        // opType === 'delete'：完整恢复被 AI 删除的实体
        if (current) {
          skipped.push({
            entityId: diff.entityId,
            entityType: diff.entityType,
            reason: '实体已被人工重建或仍存在，安全跳过',
          });
          continue;
        }

        if (diff.beforeState) {
          const restored = new Y.Map<unknown>();
          applyMapState(restored, diff.beforeState);
          map.set(diff.entityId, restored);
          if (diff.entityType === 'edge') {
            indexEdge(diff.entityId, restored.get('source'), restored.get('target'));
          }
          revertedEntityIds.add(diff.entityId);
          processedDiffs.add(diff);
        }
      }
    });

    // 仅认「本轮回放实际处理」的 Diff，全字段被人工跳过的 update 不得被同实体其他 Diff 连带标记
    const nextDiffs = batch.diffs.map((diff) =>
      processedDiffs.has(diff) ? { ...diff, reverted: true } : diff,
    );

    const allReverted = nextDiffs.every((diff) => diff.reverted);
    // 存在被跳过的字段/实体时，批次只能算部分撤回，绝不能谎报为完全撤回
    const status: AiBatchStatus =
      skipped.length > 0 || !allReverted ? 'partially_reverted' : 'reverted';

    this.repo.updateAiBatch(batchId, status, nextDiffs);

    const revertedIds = Array.from(revertedEntityIds);
    const message = skipped.length > 0
      ? `已撤回 ${revertedIds.length} 项，跳过 ${skipped.length} 项人工修改`
      : `已成功撤回 ${revertedIds.length} 项 AI 修改`;

    return {
      success: true,
      reverted: revertedIds.length > 0,
      batchId,
      diagramId,
      revertedEntityIds: revertedIds,
      skipped,
      skippedCount: skipped.length,
      status,
      message,
    };
  }

  private normalizeBatch(input: LegacyBatchInput): {
    batchId: string;
    diagramId: string;
    agentName?: string;
    summary: string;
    status: AiBatchStatus;
    diffs: AiBatchEntityDiff[];
    createdAt: string;
  } {
    if (Array.isArray(input.diffs)) {
      return {
        batchId: input.batchId,
        diagramId: input.diagramId,
        agentName: input.agentName,
        summary: input.summary,
        status: input.status ?? 'active',
        diffs: input.diffs.map((diff) => ({
          entityId: diff.entityId,
          entityType: diff.entityType,
          opType: diff.opType,
          beforeState: diff.beforeState ?? null,
          afterState: diff.afterState ?? null,
          reverted: diff.reverted ?? false,
        })),
        createdAt: input.createdAt,
      };
    }

    // 旧版入参兼容：从当前冷文档补全实体级快照
    const diffs: AiBatchEntityDiff[] = [];
    const state = this.repo.getYDocState(input.diagramId);
    const doc = state ? (() => {
      const d = new Y.Doc();
      Y.applyUpdate(d, state);
      return d;
    })() : null;
    const nodesMap = doc?.getMap<Y.Map<unknown>>('nodes');
    const edgesMap = doc?.getMap<Y.Map<unknown>>('edges');

    for (const nodeId of input.createdNodeIds ?? []) {
      const node = nodesMap?.get(nodeId);
      diffs.push({
        entityId: nodeId,
        entityType: 'node',
        opType: 'add',
        beforeState: null,
        afterState: node ? snapshotMap(node) : null,
      });
    }

    for (const edgeId of input.createdEdgeIds ?? []) {
      const edge = edgesMap?.get(edgeId);
      diffs.push({
        entityId: edgeId,
        entityType: 'edge',
        opType: 'add',
        beforeState: null,
        afterState: edge ? snapshotMap(edge) : null,
      });
    }

    for (const backup of input.updatedNodeBackups ?? []) {
      const node = nodesMap?.get(backup.id);
      const currentState = node ? snapshotMap(node) : null;
      diffs.push({
        entityId: backup.id,
        entityType: 'node',
        opType: 'update',
        beforeState: currentState
          ? { ...currentState, data: backup.oldData }
          : { data: backup.oldData },
        afterState: currentState,
      });
    }

    if (doc) doc.destroy();

    return {
      batchId: input.batchId,
      diagramId: input.diagramId,
      agentName: input.agentName,
      summary: input.summary,
      status: input.status ?? 'active',
      diffs,
      createdAt: input.createdAt,
    };
  }

  private failure(diagramId: string, batchId: string, message: string): AiBatchRevertResult {
    return {
      success: false,
      reverted: false,
      batchId,
      diagramId,
      revertedEntityIds: [],
      skipped: [],
      skippedCount: 0,
      status: 'active',
      message,
    };
  }
}

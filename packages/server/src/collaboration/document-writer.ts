/**
 * @fileoverview 服务端统一写入引擎 (DocumentWriter)
 * @description 作为服务端唯一的 Y.Doc 写入出口：在线优先命中 Hocuspocus 内存中的 Live Y.Doc，
 *              由 Hocuspocus 原生实时广播给全部在线客户端；冷文档才回落到 SQLite 加载路径。
 *              所有落库统一走 `saveYDocState` 的 CRDT 增量合并，杜绝整包覆盖。
 */

import * as Y from 'yjs';
import type { Hocuspocus } from '@hocuspocus/server';
import type { DiagramRepository } from '../db/diagram-repository.js';

export type DocumentOrigin =
  | `ai:${string}`
  | `ai-revert:${string}`
  | `snapshot-restore:${string}`;

export interface MutateOutcome<T> {
  /** 事务回调的返回值 */
  result: T;
  /** 是否命中了 Hocuspocus 在线 Live Y.Doc */
  live: boolean;
}

export class DocumentWriter {
  constructor(
    private repo: DiagramRepository,
    private hocuspocus?: Hocuspocus,
  ) {}

  /**
   * 绑定协同服务实例（服务装配阶段的依赖倒置）
   */
  attachCollaborationServer(hocuspocus: Hocuspocus): void {
    this.hocuspocus = hocuspocus;
  }

  /**
   * 获取指定图表的在线文档（若存在）
   */
  getLiveDocument(diagramId: string): Y.Doc | null {
    const doc = this.hocuspocus?.documents.get(diagramId);
    if (!doc || doc.isDestroyed || doc.isLoading) return null;
    return doc;
  }

  /**
   * 只读访问文档：在线时读取 Live Doc，否则从 SQLite 冷加载一份副本
   */
  async readDocument<T>(diagramId: string, fn: (doc: Y.Doc) => T): Promise<T> {
    const live = this.getLiveDocument(diagramId);
    if (live) return fn(live);

    const state = this.repo.getYDocState(diagramId);
    if (!state) throw new Error(`图表 ${diagramId} 不存在`);

    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    return fn(doc);
  }

  /**
   * 统一写入入口（在线优先）
   *
   * - 在线：直接在 Live Y.Doc 的 `transact(fn, origin)` 中修改，Hocuspocus 自动广播差量；
   * - 冷文档：通过 `openDirectConnection` 加载后写入并触发防抖/立即落库；
   * - 无协同实例（单元测试/离线脚本）：从 SQLite 冷加载，事务后增量合并写回。
   */
  async mutate<T>(
    diagramId: string,
    origin: DocumentOrigin,
    fn: (doc: Y.Doc) => T,
  ): Promise<MutateOutcome<T>> {
    if (!this.repo.getDiagramById(diagramId)) {
      throw new Error(`图表 ${diagramId} 不存在`);
    }

    const live = this.getLiveDocument(diagramId);
    if (live) {
      let result!: T;
      live.transact(() => {
        result = fn(live);
      }, origin);
      return { result, live: true };
    }

    if (this.hocuspocus) {
      const direct = await this.hocuspocus.openDirectConnection(diagramId);
      try {
        const doc = direct.document as unknown as Y.Doc;
        let result!: T;
        doc.transact(() => {
          result = fn(doc);
        }, origin);
        return { result, live: false };
      } finally {
        // 立即落库并卸载，确保冷写入具备持久性
        await direct.disconnect();
      }
    }

    // 无协同实例的纯离线路径
    const state = this.repo.getYDocState(diagramId);
    if (!state) throw new Error(`图表 ${diagramId} 不存在`);

    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    let result!: T;
    doc.transact(() => {
      result = fn(doc);
    }, origin);

    const metaTitle = doc.getMap('meta').get('title');
    this.repo.saveYDocState(
      diagramId,
      Y.encodeStateAsUpdate(doc),
      typeof metaTitle === 'string' ? metaTitle : undefined,
    );

    return { result, live: false };
  }

  /**
   * 无损差异快照恢复：将目标快照与当前文档的差量作为一次普通协同事务写回
   */
  async restoreSnapshot(
    diagramId: string,
    snapshotId: string,
  ): Promise<{ success: boolean; error?: string }> {
    const targetState = this.repo.getSnapshotState(snapshotId);
    if (!targetState) {
      return { success: false, error: '目标快照不存在' };
    }
    if (!this.repo.getDiagramById(diagramId)) {
      return { success: false, error: '目标图表不存在' };
    }

    const snapDoc = new Y.Doc();
    Y.applyUpdate(snapDoc, targetState);

    await this.mutate(diagramId, `snapshot-restore:${snapshotId}`, (doc) => {
      applySnapshotDelta(doc, snapDoc);
    });

    return { success: true };
  }
}

/**
 * 将快照文档的差量应用至目标文档（仅构建差量，不整包替换）
 */
export function applySnapshotDelta(targetDoc: Y.Doc, snapDoc: Y.Doc): void {
  const snapNodesMap = snapDoc.getMap<Y.Map<unknown>>('nodes');
  const snapEdgesMap = snapDoc.getMap<Y.Map<unknown>>('edges');
  const snapMetaMap = snapDoc.getMap<unknown>('meta');

  const currNodesMap = targetDoc.getMap<Y.Map<unknown>>('nodes');
  const currEdgesMap = targetDoc.getMap<Y.Map<unknown>>('edges');
  const currMetaMap = targetDoc.getMap<unknown>('meta');

  const snapTitle = snapMetaMap.get('title');
  if (typeof snapTitle === 'string') {
    currMetaMap.set('title', snapTitle);
  }

  const targetNodeIds = new Set<string>();
  snapNodesMap.forEach((nodeMap, id) => {
    targetNodeIds.add(id);
    let currNodeMap = currNodesMap.get(id);
    if (!currNodeMap) {
      currNodeMap = new Y.Map<unknown>();
      currNodesMap.set(id, currNodeMap);
    }
    nodeMap.forEach((val, key) => {
      currNodeMap!.set(key, val);
    });
  });

  for (const id of Array.from(currNodesMap.keys())) {
    if (!targetNodeIds.has(id)) {
      currNodesMap.delete(id);
    }
  }

  const targetEdgeIds = new Set<string>();
  snapEdgesMap.forEach((edgeMap, id) => {
    targetEdgeIds.add(id);
    let currEdgeMap = currEdgesMap.get(id);
    if (!currEdgeMap) {
      currEdgeMap = new Y.Map<unknown>();
      currEdgesMap.set(id, currEdgeMap);
    }
    edgeMap.forEach((val, key) => {
      currEdgeMap!.set(key, val);
    });
  });

  for (const id of Array.from(currEdgesMap.keys())) {
    if (!targetEdgeIds.has(id)) {
      currEdgesMap.delete(id);
    }
  }
}

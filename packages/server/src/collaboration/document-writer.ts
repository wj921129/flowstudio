/**
 * @fileoverview 服务端统一写入引擎 (DocumentWriter)
 * @description 作为服务端唯一的 Y.Doc 写入出口：在线优先命中 Hocuspocus 内存中的 Live Y.Doc，
 *              由 Hocuspocus 原生实时广播给全部在线客户端；冷文档才回落到 SQLite 加载路径。
 *              所有落库统一走 `saveYDocState` 的 CRDT 增量合并，杜绝整包覆盖。
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import * as Y from 'yjs';
import type { Hocuspocus } from '@hocuspocus/server';
import type { SnapshotSummary } from '@flowstudio/shared';
import type { DiagramRepository } from '../db/diagram-repository.js';
import type { SaveStatusTracker } from './save-status.js';
import { getTopLevelMaps } from './shared-maps.js';
import { deepEqual, cloneValue } from './entity-state.js';

export type DocumentOrigin =
  | `ai:${string}`
  | `ai-revert:${string}`
  | `snapshot-restore:${string}`
  | `system:${string}`;

export interface MutateOutcome<T> {
  /** 事务回调的返回值 */
  result: T;
  /** 是否命中了 Hocuspocus 在线 Live Y.Doc */
  live: boolean;
}

export class DocumentWriter {
  private writeQueues = new Map<string, Promise<unknown>>();
  private queueScope = new AsyncLocalStorage<Set<string>>();

  constructor(
    private repo: DiagramRepository,
    private hocuspocus?: Hocuspocus,
    private saveStatus?: SaveStatusTracker,
  ) {}

  runSerialized<T>(diagramId: string, task: () => Promise<T>): Promise<T> {
    const active = this.queueScope.getStore();
    if (active?.has(diagramId)) return task();

    const previous = this.writeQueues.get(diagramId) ?? Promise.resolve();
    const execute = () => {
      const nextActive = new Set(active);
      nextActive.add(diagramId);
      return this.queueScope.run(nextActive, task);
    };
    const next = previous.then(execute, execute);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    this.writeQueues.set(diagramId, tail);
    void tail.then(() => {
      if (this.writeQueues.get(diagramId) === tail) {
        this.writeQueues.delete(diagramId);
      }
    });
    return next;
  }

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
    try {
      return fn(doc);
    } finally {
      doc.destroy();
    }
  }

  /**
   * 获取当前图表最新 Y.Doc 二进制状态（优先 Live 内存，回底 SQLite）
   */
  getSnapshotState(diagramId: string): Uint8Array | null {
    const live = this.getLiveDocument(diagramId);
    return live ? Y.encodeStateAsUpdate(live) : this.repo.getYDocState(diagramId);
  }

  /**
   * 在线优先创建历史快照
   *
   * Live Doc 存在时直接编码内存最新状态，避免被 SQLite 的落库防抖窗口截断；
   * 冷文档才回退到数据库状态。这是 `restoreSnapshot` 不丢失同事最新编辑的前提。
   */
  createSnapshot(
    diagramId: string,
    label: string,
    triggerType: 'manual' | 'ai_batch' | 'auto' | 'timer' = 'manual',
  ): SnapshotSummary | null {
    if (!this.repo.getDiagramById(diagramId)) return null;

    const state = this.getSnapshotState(diagramId);
    if (!state) return null;

    return this.repo.createSnapshotFromState(diagramId, state, label, triggerType);
  }

  /**
   * 手动保存：跳过 Hocuspocus 防抖窗口，将在线文档立即落库
   */
  async flushDocument(diagramId: string): Promise<boolean> {
    const live = this.getLiveDocument(diagramId);
    if (!live) return false;

    const update = Y.encodeStateAsUpdate(live);
    const metaTitle = live.getMap('meta').get('title');
    const saved = this.repo.saveYDocState(
      diagramId,
      update,
      typeof metaTitle === 'string' ? metaTitle : undefined,
    );
    if (saved) this.saveStatus?.markSaved(diagramId);
    return saved;
  }

  /**
   * 统一写入入口（在线优先）
   *
   * - 在线：直接在 Live Y.Doc 的 `transact(fn, origin)` 中修改，Hocuspocus 自动广播差量；
   * - 冷文档：通过 `openDirectConnection` 加载后写入并触发防抖/立即落库；
   * - 无协同实例（单元测试/离线脚本）：从 SQLite 冷加载，事务后增量合并写回。
   *
   * 原子性契约（务必遵守）：
   * 1. `fn` 只允许做纯 Yjs 本地修改，必须是同步函数，严禁返回 Promise；
   * 2. 所有参数校验、IO、布局计算等可能失败的前置工作，必须在调用 `mutate` 之前完成；
   * 3. `fn` 不得在修改中途抛错。引擎会用 UndoManager 对已发生的本地修改做防御性补偿回滚，
   *    但补偿本身仍是一次广播事务，因此失败路径不应被业务依赖。
   */
  async mutate<T>(
    diagramId: string,
    origin: DocumentOrigin,
    fn: (doc: Y.Doc) => T,
  ): Promise<MutateOutcome<T>> {
    return this.runSerialized(diagramId, async () => {
      if (!this.repo.getDiagramById(diagramId)) {
        throw new Error(`图表 ${diagramId} 不存在`);
      }

      const live = this.getLiveDocument(diagramId);
      if (live) {
        const result = this.applyTransaction(live, origin, fn);
        this.clearThumbnailIfEmpty(diagramId, live);
        return { result, live: true };
      }

      if (this.hocuspocus) {
        const direct = await this.hocuspocus.openDirectConnection(diagramId);
        try {
          const doc = direct.document as unknown as Y.Doc;
          const result = this.applyTransaction(doc, origin, fn);
          this.clearThumbnailIfEmpty(diagramId, doc);
          return { result, live: false };
        } finally {
          await direct.disconnect();
        }
      }

      const state = this.repo.getYDocState(diagramId);
      if (!state) throw new Error(`图表 ${diagramId} 不存在`);

      const doc = new Y.Doc();
      try {
        Y.applyUpdate(doc, state);

        const increments: Uint8Array[] = [];
        const collectUpdate = (update: Uint8Array) => {
          increments.push(update);
        };
        doc.on('update', collectUpdate);

        let result!: T;
        try {
          doc.transact(() => {
            result = fn(doc);
          }, origin);
        } finally {
          doc.off('update', collectUpdate);
        }

        if (result && typeof (result as { then?: unknown }).then === 'function') {
          throw new Error('DocumentWriter.mutate 回调必须同步执行，严禁返回 Promise');
        }

        if (increments.length > 0) {
          const increment =
            increments.length === 1 ? increments[0] : Y.mergeUpdates(increments);
          const metaTitle = doc.getMap('meta').get('title');
          this.repo.saveYDocState(
            diagramId,
            increment,
            typeof metaTitle === 'string' ? metaTitle : undefined,
          );
          this.clearThumbnailIfEmpty(diagramId, doc);
        }

        return { result, live: false };
      } finally {
        doc.destroy();
      }
    });
  }

  private clearThumbnailIfEmpty(diagramId: string, doc: Y.Doc): void {
    if (doc.getMap('nodes').size === 0) {
      this.repo.clearThumbnail(diagramId);
    }
  }

  /**
   * 在事务中执行回调，并在回调抛错时用 UndoManager 补偿回滚本次 origin 的本地修改
   */
  private applyTransaction<T>(
    doc: Y.Doc,
    origin: DocumentOrigin,
    fn: (doc: Y.Doc) => T,
  ): T {
    const undoManager = new Y.UndoManager(getTopLevelMaps(doc), {
      trackedOrigins: new Set([origin]),
      captureTimeout: 0,
    });

    try {
      let result!: T;
      doc.transact(() => {
        result = fn(doc);
      }, origin);

      if (result && typeof (result as { then?: unknown }).then === 'function') {
        // 统一交给 catch 回滚，避免重复 undo
        throw new Error('DocumentWriter.mutate 回调必须同步执行，严禁返回 Promise');
      }
      return result;
    } catch (error) {
      // Yjs 事务在回调抛错时不会自动回滚，这里做防御性补偿，避免半截修改污染画布
      try {
        undoManager.undo();
      } catch {
        // 回滚失败不掩盖原始异常
      }
      throw error;
    } finally {
      undoManager.destroy();
    }
  }

  /**
   * 仅计算快照恢复差量：不写入当前文档，供发起客户端本地事务应用并纳入撤销栈
   */
  computeSnapshotRestoreUpdate(
    diagramId: string,
    snapshotId: string,
  ): { success: boolean; update?: Uint8Array; error?: string } {
    const targetState = this.repo.getSnapshotState(snapshotId);
    if (!targetState) return { success: false, error: '目标快照不存在' };
    if (!this.repo.getDiagramById(diagramId)) {
      return { success: false, error: '目标图表不存在' };
    }
    if (this.repo.getSnapshotDiagramId(snapshotId) !== diagramId) {
      return { success: false, error: '该快照不属于当前图表，禁止跨图恢复' };
    }

    const live = this.getLiveDocument(diagramId);
    const currentState = live
      ? Y.encodeStateAsUpdate(live)
      : this.repo.getYDocState(diagramId);
    if (!currentState) return { success: false, error: '当前图表状态不存在' };

    const snapDoc = new Y.Doc();
    const clone = new Y.Doc();
    try {
      Y.applyUpdate(snapDoc, targetState);
      Y.applyUpdate(clone, currentState);
      const stateVector = Y.encodeStateVector(clone);
      applySnapshotDelta(clone, snapDoc);
      return { success: true, update: Y.encodeStateAsUpdate(clone, stateVector) };
    } finally {
      clone.destroy();
      snapDoc.destroy();
    }
  }

  /**
   * 无损差异快照恢复：将目标快照与当前文档的差量作为一次普通协同事务写回
   */
  async restoreSnapshot(
    diagramId: string,
    snapshotId: string,
  ): Promise<{ success: boolean; error?: string }> {
    return this.runSerialized(diagramId, async () => {
      const targetState = this.repo.getSnapshotState(snapshotId);
      if (!targetState) {
        return { success: false, error: '目标快照不存在' };
      }
      if (!this.repo.getDiagramById(diagramId)) {
        return { success: false, error: '目标图表不存在' };
      }
      if (this.repo.getSnapshotDiagramId(snapshotId) !== diagramId) {
        return { success: false, error: '该快照不属于当前图表，禁止跨图恢复' };
      }

      const snapDoc = new Y.Doc();
      try {
        Y.applyUpdate(snapDoc, targetState);
        await this.mutate(diagramId, `snapshot-restore:${snapshotId}`, (doc) => {
          applySnapshotDelta(doc, snapDoc);
        });
      } finally {
        snapDoc.destroy();
      }

      return { success: true };
    });
  }
}

function syncMapDeep(curr: Y.Map<unknown>, snap: Y.Map<unknown>): void {
  const snapKeys = new Set<string>();
  snap.forEach((snapVal, k) => {
    snapKeys.add(k);
    const currVal = curr.get(k);
    if (snapVal instanceof Y.Map) {
      let targetSubMap = currVal instanceof Y.Map ? currVal : null;
      if (!targetSubMap) {
        targetSubMap = new Y.Map<unknown>();
        curr.set(k, targetSubMap);
      }
      syncMapDeep(targetSubMap, snapVal);
    } else {
      if (!deepEqual(currVal, snapVal)) {
        curr.set(k, cloneValue(snapVal));
      }
    }
  });

  for (const k of Array.from(curr.keys())) {
    if (!snapKeys.has(k)) {
      curr.delete(k);
    }
  }
}

function syncNestedMapDelta(
  currMap: Y.Map<Y.Map<unknown>>,
  snapMap: Y.Map<Y.Map<unknown>>,
): void {
  const targetIds = new Set<string>();
  snapMap.forEach((snapItemMap, id) => {
    targetIds.add(id);
    let currItemMap = currMap.get(id);
    if (!currItemMap) {
      currItemMap = new Y.Map<unknown>();
      currMap.set(id, currItemMap);
    }
    syncMapDeep(currItemMap, snapItemMap);
  });

  for (const id of Array.from(currMap.keys())) {
    if (!targetIds.has(id)) {
      currMap.delete(id);
    }
  }
}

/**
 * 将快照文档的差量应用至目标文档（仅构建差量，不整包替换）
 */
export function applySnapshotDelta(targetDoc: Y.Doc, snapDoc: Y.Doc): void {
  const snapMetaMap = snapDoc.getMap<unknown>('meta');
  const currMetaMap = targetDoc.getMap<unknown>('meta');

  // meta 目前以 title 为唯一权威键；为向前兼容，快照中的所有 meta 键均做差量还原，
  // 当前文档独有的扩展键保留，不做破坏性删除
  snapMetaMap.forEach((value, key) => {
    if (!deepEqual(currMetaMap.get(key), value)) {
      currMetaMap.set(key, value);
    }
  });

  for (const mapName of ['nodes', 'edges', 'comments'] as const) {
    syncNestedMapDelta(
      targetDoc.getMap<Y.Map<unknown>>(mapName),
      snapDoc.getMap<Y.Map<unknown>>(mapName),
    );
  }
}

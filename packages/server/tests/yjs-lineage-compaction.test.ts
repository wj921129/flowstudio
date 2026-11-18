import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as Y from 'yjs';
import { YDOC_TOP_LEVEL_MAPS } from '@flowstudio/shared';
import { initDatabase } from '../src/db/database.js';
import { DiagramRepository } from '../src/db/diagram-repository.js';
import { SqlitePersistenceExtension } from '../src/collaboration/sqlite-extension.js';
import { DocumentWriter } from '../src/collaboration/document-writer.js';
import {
  COMPACT_THRESHOLD_BYTES,
  compactYDocState,
  compactDiagramStateOffline,
} from '../src/collaboration/yjs-compaction.js';

function createNodeMap(id: string, label: string): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set('id', id);
  m.set('type', 'process');
  m.set('data', { label, type: 'process' });
  return m;
}

function createCommentMap(id: string, content: string): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set('id', id);
  m.set('content', content);
  m.set('authorId', 'user-1');
  m.set('authorName', '测试用户');
  m.set('createdAt', 1700000000000);
  m.set('position', { x: 100, y: 100 });
  m.set('resolved', false);
  m.set('replies', []);
  m.set('reactions', []);
  return m;
}

function bloatDocOverThreshold(doc: Y.Doc): void {
  // 构造 >2MB 的历史膨胀且可压缩 >50% 的状态，检验运行时不会触发无血缘重构压缩
  const bloat = new Y.Doc({ gc: false });
  Y.applyUpdate(bloat, Y.encodeStateAsUpdate(doc));
  const payload = 'x'.repeat(2400);
  bloat.transact(() => {
    for (let i = 0; i < 1000; i++) {
      bloat.getMap('meta').set(`junk-${i}`, payload);
    }
  });
  bloat.transact(() => {
    for (let i = 0; i < 1000; i++) {
      bloat.getMap('meta').delete(`junk-${i}`);
    }
  });
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(bloat));
  bloat.destroy();
}

describe('工单02：大图压缩血缘安全与批注保护', () => {
  let tmpDbPath: string;

  beforeEach(() => {
    tmpDbPath = path.join(
      os.tmpdir(),
      `flowstudio-ticket02-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`,
    );
  });

  afterEach(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        if (fs.existsSync(tmpDbPath + suffix)) fs.unlinkSync(tmpDbPath + suffix);
      } catch {
        // ignore
      }
    }
  });

  it('超过 2MB 的文档经 onStoreDocument/onLoadDocument 后保留 CRDT 删除血缘且不丢批注', async () => {
    const db = initDatabase(tmpDbPath);
    const repo = new DiagramRepository(db);
    const ext = new SqlitePersistenceExtension(repo);
    const diag = repo.createDiagram({ title: '大图血缘测试' });

    // 1. 初始协作基线：n-deleted、n-keep 与批注 c-1
    const clientA = new Y.Doc({ gc: false });
    Y.applyUpdate(clientA, repo.getYDocState(diag.id)!);
    clientA.getMap('nodes').set('n-deleted', createNodeMap('n-deleted', '待删除节点'));
    clientA.getMap('nodes').set('n-keep', createNodeMap('n-keep', '旧文案'));
    clientA.getMap('comments').set('c-1', createCommentMap('c-1', '重要批注'));

    const offlineClient = new Y.Doc();
    Y.applyUpdate(offlineClient, Y.encodeStateAsUpdate(clientA));

    // 2. clientA 删除 n-deleted、更新 n-keep 并累积 >2MB CRDT 历史
    clientA.getMap('nodes').delete('n-deleted');
    (clientA.getMap('nodes').get('n-keep') as Y.Map<unknown>).set('data', {
      label: '最新编辑',
      type: 'process',
    });
    bloatDocOverThreshold(clientA);

    const encoded = Y.encodeStateAsUpdate(clientA);
    expect(encoded.byteLength).toBeGreaterThan(COMPACT_THRESHOLD_BYTES);

    // 3. 服务端存储并重新加载
    const replaceSpy = vi.spyOn(repo, 'replaceYDocState');
    await ext.onStoreDocument({ documentName: diag.id, document: clientA } as any);
    const storedAfterSave = repo.getYDocState(diag.id)!;

    const reloadedDoc = new Y.Doc();
    await ext.onLoadDocument({ documentName: diag.id, document: reloadedDoc } as any);

    // onLoadDocument 不应触发运行时压缩或偷偷替换掉库里的原血缘状态
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(repo.getYDocState(diag.id)).toEqual(storedAfterSave);

    // 4. 曾见过 n-deleted 的离线客户端重连同步，不应令已删节点复活
    Y.applyUpdate(reloadedDoc, Y.encodeStateAsUpdate(offlineClient));
    Y.applyUpdate(offlineClient, Y.encodeStateAsUpdate(reloadedDoc));

    expect(reloadedDoc.getMap('nodes').has('n-deleted')).toBe(false);
    expect((reloadedDoc.getMap('nodes').get('n-keep') as Y.Map<unknown>).get('data')).toEqual({
      label: '最新编辑',
      type: 'process',
    });
    expect(reloadedDoc.getMap('comments').has('c-1')).toBe(true);
    expect((reloadedDoc.getMap('comments').get('c-1') as Y.Map<unknown>).get('content')).toBe('重要批注');

    db.close();
  }, 30000);

  it('DocumentWriter.flushDocument 对超过 2MB 的文档直接增量保存而不破坏 CRDT 血缘与批注', async () => {
    const db = initDatabase(tmpDbPath);
    const repo = new DiagramRepository(db);
    const diag = repo.createDiagram({ title: 'Flush 大图血缘' });

    const liveDoc = new Y.Doc({ gc: false });
    Y.applyUpdate(liveDoc, repo.getYDocState(diag.id)!);
    liveDoc.getMap('nodes').set('n-deleted', createNodeMap('n-deleted', '待删'));
    liveDoc.getMap('comments').set('c-flush', createCommentMap('c-flush', '落库批注'));

    const offlineClient = new Y.Doc();
    Y.applyUpdate(offlineClient, Y.encodeStateAsUpdate(liveDoc));

    liveDoc.getMap('nodes').delete('n-deleted');
    bloatDocOverThreshold(liveDoc);
    expect(Y.encodeStateAsUpdate(liveDoc).byteLength).toBeGreaterThan(COMPACT_THRESHOLD_BYTES);

    const mockHocuspocus = {
      documents: new Map([[diag.id, liveDoc]]),
    } as any;
    const writer = new DocumentWriter(repo, mockHocuspocus);

    const saved = await writer.flushDocument(diag.id);
    expect(saved).toBe(true);

    const reopened = new Y.Doc();
    Y.applyUpdate(reopened, repo.getYDocState(diag.id)!);
    Y.applyUpdate(reopened, Y.encodeStateAsUpdate(offlineClient));

    expect(reopened.getMap('nodes').has('n-deleted')).toBe(false);
    expect(reopened.getMap('comments').has('c-flush')).toBe(true);

    db.close();
  }, 30000);

  it('共享容器注册表 YDOC_TOP_LEVEL_MAPS 包含全部 4 个顶层容器', () => {
    expect([...YDOC_TOP_LEVEL_MAPS]).toEqual(['nodes', 'edges', 'meta', 'comments']);
  });

  it('DocumentWriter.mutate 事务回调抛错时同事务内写入的 comments 变更一并回滚', async () => {
    const db = initDatabase(tmpDbPath);
    const repo = new DiagramRepository(db);
    const diag = repo.createDiagram({ title: '批注事务回滚图' });

    const seedDoc = new Y.Doc();
    Y.applyUpdate(seedDoc, repo.getYDocState(diag.id)!);
    seedDoc.getMap('comments').set('c-existing', createCommentMap('c-existing', '初始批注'));
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(seedDoc));

    const liveDoc = new Y.Doc({ gc: false });
    Y.applyUpdate(liveDoc, repo.getYDocState(diag.id)!);
    const mockHocuspocus = {
      documents: new Map([[diag.id, liveDoc]]),
    } as any;
    const writer = new DocumentWriter(repo, mockHocuspocus);

    await expect(
      writer.mutate(diag.id, 'ai:comment-rollback', (doc) => {
        doc.getMap('nodes').set('n-dirty', createNodeMap('n-dirty', '脏节点'));
        doc.getMap('comments').set('c-dirty', createCommentMap('c-dirty', '脏批注'));
        (doc.getMap('comments').get('c-existing') as Y.Map<unknown>).set('content', '被污染的批注');
        throw new Error('模拟批注事务异常');
      }),
    ).rejects.toThrow('模拟批注事务异常');

    expect(liveDoc.getMap('nodes').has('n-dirty')).toBe(false);
    expect(liveDoc.getMap('comments').has('c-dirty')).toBe(false);
    expect((liveDoc.getMap('comments').get('c-existing') as Y.Map<unknown>).get('content')).toBe('初始批注');

    db.close();
  });

  it('DocumentWriter.restoreSnapshot 同步按差量还原 comments Map', async () => {
    const db = initDatabase(tmpDbPath);
    const repo = new DiagramRepository(db);
    const writer = new DocumentWriter(repo);
    const diag = repo.createDiagram({ title: '批注快照差量恢复图' });

    const v1 = new Y.Doc();
    Y.applyUpdate(v1, repo.getYDocState(diag.id)!);
    v1.getMap('comments').set('c-1', createCommentMap('c-1', 'V1批注'));
    v1.getMap('comments').set('c-2', createCommentMap('c-2', '将被删除的V1批注'));
    v1.getMap('comments').set('c-keep', createCommentMap('c-keep', '未变化批注'));
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(v1));
    const snap = repo.createSnapshot(diag.id, '含批注V1', 'manual')!;

    const v2 = new Y.Doc();
    Y.applyUpdate(v2, repo.getYDocState(diag.id)!);
    (v2.getMap('comments').get('c-1') as Y.Map<unknown>).set('content', 'V2修改后批注');
    v2.getMap('comments').delete('c-2');
    v2.getMap('comments').set('c-3', createCommentMap('c-3', '快照后新增批注'));
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(v2));

    const res = await writer.restoreSnapshot(diag.id, snap.id);
    expect(res.success).toBe(true);

    const restored = new Y.Doc();
    Y.applyUpdate(restored, repo.getYDocState(diag.id)!);
    const comments = restored.getMap<Y.Map<unknown>>('comments');
    expect(comments.has('c-1')).toBe(true);
    expect(comments.get('c-1')!.get('content')).toBe('V1批注');
    expect(comments.has('c-2')).toBe(true);
    expect(comments.get('c-2')!.get('content')).toBe('将被删除的V1批注');
    expect(comments.has('c-keep')).toBe(true);
    expect(comments.has('c-3')).toBe(false);

    db.close();
  });

  it('离线压缩 compactYDocState 保留 comments 且递增 meta.docEpoch 并有效收敛体积', async () => {
    const docA = new Y.Doc({ gc: false });
    docA.getMap('nodes').set('n-1', createNodeMap('n-1', '正式节点'));
    const edge = new Y.Map<unknown>();
    edge.set('id', 'e-1');
    edge.set('source', 'n-1');
    edge.set('target', 'n-1');
    docA.getMap('edges').set('e-1', edge);
    docA.getMap('meta').set('title', '离线清洗图');
    docA.getMap('comments').set('c-1', createCommentMap('c-1', '待保留批注'));

    // 模拟长期累积的未 GC 历史垃圾，随后删除临时节点，形成 >2MB 的历史膨胀
    const junk = 'j'.repeat(2400);
    docA.transact(() => {
      for (let i = 0; i < 1000; i++) {
        docA.getMap('meta').set(`scratch-${i}`, junk);
      }
    });
    docA.transact(() => {
      for (let i = 0; i < 1000; i++) {
        docA.getMap('meta').delete(`scratch-${i}`);
      }
    });

    const bloated = Y.encodeStateAsUpdate(docA);
    expect(bloated.byteLength).toBeGreaterThan(COMPACT_THRESHOLD_BYTES);

    const compacted = await compactYDocState(bloated);
    expect(compacted).not.toBeNull();
    expect(compacted!.byteLength).toBeLessThan(bloated.byteLength * 0.5);

    const cleanDoc = new Y.Doc();
    Y.applyUpdate(cleanDoc, compacted!);
    expect(cleanDoc.getMap('nodes').has('n-1')).toBe(true);
    expect(cleanDoc.getMap('edges').has('e-1')).toBe(true);
    expect(cleanDoc.getMap('meta').get('title')).toBe('离线清洗图');
    expect(cleanDoc.getMap('meta').get('docEpoch')).toBe(2);
    expect(cleanDoc.getMap('comments').has('c-1')).toBe(true);
    expect((cleanDoc.getMap('comments').get('c-1') as Y.Map<unknown>).get('content')).toBe('待保留批注');

    const compactedAgain = await compactYDocState(compacted!, { force: true });
    expect(compactedAgain).not.toBeNull();
    const docEpoch3 = new Y.Doc();
    Y.applyUpdate(docEpoch3, compactedAgain!);
    expect(docEpoch3.getMap('meta').get('docEpoch')).toBe(3);
  }, 30000);

  it('compactDiagramStateOffline 对仓储内图表执行一次性离线清洗并更新 docEpoch', async () => {
    const db = initDatabase(tmpDbPath);
    const repo = new DiagramRepository(db);
    const diag = repo.createDiagram({ title: '仓储离线清洗' });

    const doc = new Y.Doc();
    Y.applyUpdate(doc, repo.getYDocState(diag.id)!);
    doc.getMap('meta').set('docEpoch', 1);
    doc.getMap('nodes').set('n-1', createNodeMap('n-1', '保留节点'));
    doc.getMap('comments').set('c-1', createCommentMap('c-1', '保留批注'));
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc));

    const summary = await compactDiagramStateOffline(repo, diag.id, { force: true });
    expect(summary.compacted).toBe(true);
    expect(summary.docEpoch).toBe(2);

    const after = new Y.Doc();
    Y.applyUpdate(after, repo.getYDocState(diag.id)!);
    expect(after.getMap('meta').get('docEpoch')).toBe(2);
    expect(after.getMap('nodes').has('n-1')).toBe(true);
    expect((after.getMap('comments').get('c-1') as Y.Map<unknown>).get('content')).toBe('保留批注');

    db.close();
  });

  it('离线清洗后新状态的 docEpoch 在与任意随机 clientID 旧文档合并时必定胜出', async () => {
    for (let round = 0; round < 10; round++) {
      const legacy = new Y.Doc();
      legacy.getMap('meta').set('docEpoch', 1);
      legacy.getMap('nodes').set('n-1', createNodeMap('n-1', '节点'));

      const cleanedBytes = await compactYDocState(Y.encodeStateAsUpdate(legacy), { force: true });
      expect(cleanedBytes).not.toBeNull();

      let observedEpoch: unknown;
      legacy.getMap('meta').observe((e) => {
        if (e.keysChanged.has('docEpoch')) {
          observedEpoch = legacy.getMap('meta').get('docEpoch');
        }
      });
      Y.applyUpdate(legacy, cleanedBytes!, 'remote');
      expect(observedEpoch).toBe(2);
      expect(legacy.getMap('meta').get('docEpoch')).toBe(2);
      legacy.destroy();
    }
  });
});

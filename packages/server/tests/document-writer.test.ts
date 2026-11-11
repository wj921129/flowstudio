import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as Y from 'yjs';
import { initDatabase } from '../src/db/database.js';
import { DiagramRepository } from '../src/db/diagram-repository.js';
import { DocumentWriter } from '../src/collaboration/document-writer.js';

function loadDoc(repo: DiagramRepository, diagramId: string): Y.Doc {
  const state = repo.getYDocState(diagramId);
  if (!state) throw new Error('文档状态不存在');
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc;
}

function addNode(doc: Y.Doc, id: string, label: string): void {
  const node = new Y.Map<unknown>();
  node.set('id', id);
  node.set('type', 'process');
  node.set('data', { label, type: 'process' });
  doc.getMap('nodes').set(id, node);
}

describe('DocumentWriter 与 CRDT 增量合并落库', () => {
  let tmpDbPath: string;

  beforeEach(() => {
    tmpDbPath = path.join(os.tmpdir(), `flowstudio-writer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`);
  });

  afterEach(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        if (fs.existsSync(tmpDbPath + suffix)) {
          fs.unlinkSync(tmpDbPath + suffix);
        }
      } catch {
        // ignore
      }
    }
  });

  it('saveYDocState 以 mergeUpdates 合并并发增量，绝不整包覆盖丢失改动', () => {
    const db = initDatabase(tmpDbPath);
    const repo = new DiagramRepository(db);
    const diag = repo.createDiagram({ title: '并发合并图' });

    const base = repo.getYDocState(diag.id)!;

    // 客户端 A、B 均基于同一基线离线编辑后先后落库
    const docA = new Y.Doc();
    Y.applyUpdate(docA, base);
    addNode(docA, 'node-a', 'A 的节点');
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(docA));

    const docB = new Y.Doc();
    Y.applyUpdate(docB, base);
    addNode(docB, 'node-b', 'B 的节点');
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(docB));

    const merged = loadDoc(repo, diag.id);
    const nodes = merged.getMap('nodes');
    expect(nodes.has('node-a')).toBe(true);
    expect(nodes.has('node-b')).toBe(true);

    db.close();
  });

  it('updateDiagram 重命名通过增量合并同步 meta.title 且不丢节点', () => {
    const db = initDatabase(tmpDbPath);
    const repo = new DiagramRepository(db);
    const diag = repo.createDiagram({ title: '原标题' });

    const doc = loadDoc(repo, diag.id);
    addNode(doc, 'node-keep', '保留节点');
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc));

    const updated = repo.updateDiagram(diag.id, { title: '新标题' });
    expect(updated?.title).toBe('新标题');

    const reloaded = loadDoc(repo, diag.id);
    expect(reloaded.getMap('meta').get('title')).toBe('新标题');
    expect(reloaded.getMap('nodes').has('node-keep')).toBe(true);

    db.close();
  });

  it('图表删除后的残余防抖写入被丢弃，绝不复活已删图', () => {
    const db = initDatabase(tmpDbPath);
    const repo = new DiagramRepository(db);
    const diag = repo.createDiagram({ title: '待删除图' });

    const doc = loadDoc(repo, diag.id);
    addNode(doc, 'node-x', '残留节点');
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc));

    expect(repo.deleteDiagram(diag.id)).toBe(true);

    const staleDoc = new Y.Doc();
    addNode(staleDoc, 'node-stale', '防抖残余');
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(staleDoc));

    expect(repo.getDiagramById(diag.id)).toBeNull();
    expect(repo.getYDocState(diag.id)).toBeNull();
    expect(repo.listDiagrams().length).toBe(0);

    db.close();
  });

  it('restoreSnapshot 以差量方式恢复节点集合并保留其他元数据', async () => {
    const db = initDatabase(tmpDbPath);
    const repo = new DiagramRepository(db);
    const writer = new DocumentWriter(repo);
    const diag = repo.createDiagram({ title: '快照差量图' });

    const v1 = loadDoc(repo, diag.id);
    v1.getMap('meta').set('owner', 'team-a');
    addNode(v1, 'node-a', 'A');
    addNode(v1, 'node-b', 'B');
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(v1));
    const snap = repo.createSnapshot(diag.id, 'V1 基线', 'manual')!;

    const v2 = loadDoc(repo, diag.id);
    v2.getMap('nodes').delete('node-b');
    addNode(v2, 'node-c', 'C');
    v2.getMap('meta').set('title', 'V2 标题');
    v2.getMap('meta').set('memo', '未提交草稿');
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(v2));

    const result = await writer.restoreSnapshot(diag.id, snap.id);
    expect(result.success).toBe(true);

    const restored = loadDoc(repo, diag.id);
    const nodes = restored.getMap('nodes');
    expect(nodes.has('node-a')).toBe(true);
    expect(nodes.has('node-b')).toBe(true);
    expect(nodes.has('node-c')).toBe(false);

    // 差量恢复只同步标题与图元，其他 meta 不被整包替换
    expect(restored.getMap('meta').get('title')).toBe('快照差量图');
    expect(restored.getMap('meta').get('owner')).toBe('team-a');
    expect(restored.getMap('meta').get('memo')).toBe('未提交草稿');

    db.close();
  });

  it('恢复不存在的快照返回明确失败而非抛异常', async () => {
    const db = initDatabase(tmpDbPath);
    const repo = new DiagramRepository(db);
    const writer = new DocumentWriter(repo);
    const diag = repo.createDiagram({ title: '无效快照图' });

    const result = await writer.restoreSnapshot(diag.id, 'snap-not-exist');
    expect(result.success).toBe(false);
    expect(result.error).toContain('快照不存在');

    db.close();
  });
});

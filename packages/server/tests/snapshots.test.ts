import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as Y from 'yjs';
import { initDatabase } from '../src/db/database.js';
import { DiagramRepository } from '../src/db/diagram-repository.js';
import { DocumentWriter, applySnapshotDelta } from '../src/collaboration/document-writer.js';
import { buildServer } from '../src/server.js';

describe('Server Snapshots & Lossless Delta Rollback', () => {
  let tmpDbPath: string;

  beforeEach(() => {
    tmpDbPath = path.join(os.tmpdir(), `flowstudio-snap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`);
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

  it('creates snapshots, lists them chronologically, and restores with lossless delta rollback', async () => {
    const db = initDatabase(tmpDbPath);
    const repo = new DiagramRepository(db);
    const writer = new DocumentWriter(repo);

    const diag = repo.createDiagram({ title: '版本测试图' });

    // 1. 初始化 2 个节点并保存
    const doc1 = new Y.Doc();
    doc1.getMap('meta').set('title', '版本测试图');
    const n1 = new Y.Map();
    n1.set('id', 'node-1');
    n1.set('type', 'start-end');
    doc1.getMap('nodes').set('node-1', n1);

    const n2 = new Y.Map();
    n2.set('id', 'node-2');
    n2.set('type', 'process');
    doc1.getMap('nodes').set('node-2', n2);

    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc1));

    // 2. 创建快照 1（包含 node-1, node-2）
    const snap1 = repo.createSnapshot(diag.id, '初始两节点版本', 'manual');
    expect(snap1).not.toBeNull();
    expect(snap1!.label).toBe('初始两节点版本');
    expect(snap1!.triggerType).toBe('manual');

    // 3. 模拟进一步修改：添加 node-3，删除 node-2
    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, repo.getYDocState(diag.id)!);
    doc2.getMap('nodes').delete('node-2');
    const n3 = new Y.Map();
    n3.set('id', 'node-3');
    n3.set('type', 'database');
    doc2.getMap('nodes').set('node-3', n3);

    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc2));

    // 4. 创建快照 2
    const snap2 = repo.createSnapshot(diag.id, '增加数据库节点', 'ai_batch');
    expect(snap2).not.toBeNull();

    // 5. 查询列表验证按时间倒序排列
    const list = repo.listSnapshots(diag.id);
    expect(list.length).toBe(2);
    expect(list[0].id).toBe(snap2!.id);
    expect(list[1].id).toBe(snap1!.id);

    // 6. 执行恢复到快照 1
    const restoreRes = await writer.restoreSnapshot(diag.id, snap1!.id);
    expect(restoreRes.success).toBe(true);

    // 7. 读取恢复后的文档状态进行断言
    const recoveredDoc = new Y.Doc();
    Y.applyUpdate(recoveredDoc, repo.getYDocState(diag.id)!);
    const recoveredNodes = recoveredDoc.getMap('nodes');

    expect(recoveredNodes.size).toBe(2);
    expect(recoveredNodes.has('node-1')).toBe(true);
    expect(recoveredNodes.has('node-2')).toBe(true);
    expect(recoveredNodes.has('node-3')).toBe(false); // node-3 应被安全清理

    db.close();
  });

  it('provides REST endpoints for snapshots management and recovery', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });

    const createRes = await server.app.inject({
      method: 'POST',
      url: '/api/diagrams',
      payload: { title: 'REST 快照图' },
    });
    const diagId = createRes.json().id;

    // 创建快照
    const snapPostRes = await server.app.inject({
      method: 'POST',
      url: `/api/diagrams/${diagId}/snapshots`,
      payload: { label: '首发快照' },
    });
    expect(snapPostRes.statusCode).toBe(201);
    const snapId = snapPostRes.json().id;

    // 列表查询
    const listRes = await server.app.inject({
      method: 'GET',
      url: `/api/diagrams/${diagId}/snapshots`,
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().length).toBe(1);
    expect(listRes.json()[0].label).toBe('首发快照');

    // 恢复快照
    const restoreRes = await server.app.inject({
      method: 'POST',
      url: `/api/diagrams/${diagId}/snapshots/${snapId}/restore`,
    });
    expect(restoreRes.statusCode).toBe(200);
    expect(restoreRes.json().success).toBe(true);

    await server.app.close();
  });

  it('delta 模式仅返回差量不应用，客户端本地应用一次即还原快照且可重复应用', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });

    const createRes = await server.app.inject({
      method: 'POST',
      url: '/api/diagrams',
      payload: { title: '差量恢复图' },
    });
    const diagId = createRes.json().id;

    const v1 = new Y.Doc();
    Y.applyUpdate(v1, server.repo.getYDocState(diagId)!);
    for (const id of ['node-1', 'node-2']) {
      const node = new Y.Map();
      node.set('id', id);
      node.set('type', 'process');
      v1.getMap('nodes').set(id, node);
    }
    server.repo.saveYDocState(diagId, Y.encodeStateAsUpdate(v1));
    const snap = server.repo.createSnapshot(diagId, 'V1 基线', 'manual')!;

    const v2 = new Y.Doc();
    Y.applyUpdate(v2, server.repo.getYDocState(diagId)!);
    v2.getMap('nodes').delete('node-2');
    const n3 = new Y.Map();
    n3.set('id', 'node-3');
    n3.set('type', 'process');
    v2.getMap('nodes').set('node-3', n3);
    server.repo.saveYDocState(diagId, Y.encodeStateAsUpdate(v2));

    const deltaRes = await server.app.inject({
      method: 'POST',
      url: `/api/diagrams/${diagId}/snapshots/${snap.id}/restore`,
      payload: { mode: 'delta' },
    });
    expect(deltaRes.statusCode).toBe(200);
    const delta = deltaRes.json();
    expect(delta.success).toBe(true);
    expect(delta.mode).toBe('delta');
    expect(typeof delta.update).toBe('string');
    expect(delta.update.length).toBeGreaterThan(0);

    const persisted = new Y.Doc();
    Y.applyUpdate(persisted, server.repo.getYDocState(diagId)!);
    expect(persisted.getMap('nodes').has('node-2')).toBe(false);
    expect(persisted.getMap('nodes').has('node-3')).toBe(true);

    const clientDoc = new Y.Doc();
    Y.applyUpdate(clientDoc, server.repo.getYDocState(diagId)!);
    const update = new Uint8Array(Buffer.from(delta.update, 'base64'));
    clientDoc.transact(() => {
      Y.applyUpdate(clientDoc, update);
    }, `snapshot-restore:${snap.id}`);

    expect(clientDoc.getMap('nodes').has('node-1')).toBe(true);
    expect(clientDoc.getMap('nodes').has('node-2')).toBe(true);
    expect(clientDoc.getMap('nodes').has('node-3')).toBe(false);

    clientDoc.transact(() => {
      Y.applyUpdate(clientDoc, update);
    }, `snapshot-restore:${snap.id}`);
    expect(clientDoc.getMap('nodes').has('node-2')).toBe(true);
    expect(clientDoc.getMap('nodes').has('node-3')).toBe(false);

    const aliasRes = await server.app.inject({
      method: 'POST',
      url: `/api/diagrams/${diagId}/snapshots/${snap.id}/restore`,
      payload: { applyLocal: true },
    });
    expect(aliasRes.statusCode).toBe(200);
    expect(aliasRes.json().mode).toBe('delta');
    expect(typeof aliasRes.json().update).toBe('string');

    const stillPersisted = new Y.Doc();
    Y.applyUpdate(stillPersisted, server.repo.getYDocState(diagId)!);
    expect(stillPersisted.getMap('nodes').has('node-2')).toBe(false);
    expect(stillPersisted.getMap('nodes').has('node-3')).toBe(true);

    await server.app.close();
  }, 20000);

<<<<<<< HEAD
  it('恢复快照时彻底清理快照后附加到节点和连线上的多余子字段', async () => {
    const db = initDatabase(tmpDbPath);
    const repo = new DiagramRepository(db);
    const writer = new DocumentWriter(repo);
    const diag = repo.createDiagram({ title: '子字段清理测试' });

    const doc = new Y.Doc();
    const n1 = new Y.Map();
    n1.set('id', 'node-1');
    n1.set('type', 'process');
    n1.set('position', { x: 100, y: 100 });
    n1.set('data', { label: '步骤一' });
    doc.getMap('nodes').set('node-1', n1);

    const e1 = new Y.Map();
    e1.set('id', 'edge-1');
    e1.set('source', 'node-1');
    e1.set('target', 'node-1');
    doc.getMap('edges').set('edge-1', e1);

    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc));
    const snap = repo.createSnapshot(diag.id, '基线快照', 'manual')!;

    // 模拟快照后把节点拖入泳道并修改连线附加字段
    const mutated = new Y.Doc();
    Y.applyUpdate(mutated, repo.getYDocState(diag.id)!);
    const mn1 = mutated.getMap<Y.Map<unknown>>('nodes').get('node-1')!;
    mn1.set('parentId', 'lane-1');
    mn1.set('extent', 'parent');
    mn1.set('style', { backgroundColor: '#fff' });
    const me1 = mutated.getMap<Y.Map<unknown>>('edges').get('edge-1')!;
    me1.set('style', { stroke: '#f00' });
    me1.set('animated', true);
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(mutated));

    const restoreRes = await writer.restoreSnapshot(diag.id, snap.id);
    expect(restoreRes.success).toBe(true);

    const recovered = new Y.Doc();
    Y.applyUpdate(recovered, repo.getYDocState(diag.id)!);
    const rn1 = recovered.getMap<Y.Map<unknown>>('nodes').get('node-1')!;
    expect(rn1.has('parentId')).toBe(false);
    expect(rn1.has('extent')).toBe(false);
    expect(rn1.has('style')).toBe(false);
    expect(rn1.get('data')).toEqual({ label: '步骤一' });

    const re1 = recovered.getMap<Y.Map<unknown>>('edges').get('edge-1')!;
    expect(re1.has('style')).toBe(false);
    expect(re1.has('animated')).toBe(false);

    db.close();
  });

  it('仅修改单节点时未变节点和连线不产生冗余写事件，完全一致时零 update', () => {
    const snapDoc = new Y.Doc();
    const s1 = new Y.Map();
    s1.set('id', 'node-1');
    s1.set('position', { x: 10, y: 20 });
    s1.set('data', { label: '不变节点', style: { bg: '#fff', border: '#000' } });
    snapDoc.getMap('nodes').set('node-1', s1);

    const s2 = new Y.Map();
    s2.set('id', 'node-2');
    s2.set('type', 'process');
    s2.set('data', { label: '旧标签' });
    snapDoc.getMap('nodes').set('node-2', s2);

    const se1 = new Y.Map();
    se1.set('id', 'edge-1');
    se1.set('source', 'node-1');
    se1.set('target', 'node-2');
    snapDoc.getMap('edges').set('edge-1', se1);

    const targetDoc = new Y.Doc();
    const t1 = new Y.Map();
    t1.set('id', 'node-1');
    // 故意改变对象键序，验证 deepEqual 忽略键序不产生冗余写入
    t1.set('position', { y: 20, x: 10 });
    t1.set('data', { style: { border: '#000', bg: '#fff' }, label: '不变节点' });
    targetDoc.getMap('nodes').set('node-1', t1);

    const t2 = new Y.Map();
    t2.set('id', 'node-2');
    t2.set('type', 'process');
    t2.set('data', { label: '新标签' });
    targetDoc.getMap('nodes').set('node-2', t2);

    const te1 = new Y.Map();
    te1.set('id', 'edge-1');
    te1.set('source', 'node-1');
    te1.set('target', 'node-2');
    targetDoc.getMap('edges').set('edge-1', te1);

    let unchangedNodeEvents = 0;
    let unchangedEdgeEvents = 0;
    const changedNodeKeys: string[] = [];
    t1.observe(() => {
      unchangedNodeEvents += 1;
    });
    te1.observe(() => {
      unchangedEdgeEvents += 1;
    });
    t2.observe((event) => {
      changedNodeKeys.push(...Array.from(event.keysChanged));
    });

    targetDoc.transact(() => {
      applySnapshotDelta(targetDoc, snapDoc);
    });

    expect(unchangedNodeEvents).toBe(0);
    expect(unchangedEdgeEvents).toBe(0);
    expect(changedNodeKeys).toEqual(['data']);
    expect(t2.get('data')).toEqual({ label: '旧标签' });

    // 再次恢复完全等价的状态时不应发出任何 Yjs update
    let updateCount = 0;
    targetDoc.on('update', () => {
      updateCount += 1;
    });
    targetDoc.transact(() => {
      applySnapshotDelta(targetDoc, snapDoc);
    });
    expect(updateCount).toBe(0);

    snapDoc.destroy();
    targetDoc.destroy();
  });

  it('恢复快照时精确还原批注并保留当前文档独有的 meta 扩展键', async () => {
    const db = initDatabase(tmpDbPath);
    const repo = new DiagramRepository(db);
    const writer = new DocumentWriter(repo);
    const diag = repo.createDiagram({ title: '初始标题' });

    const v1 = new Y.Doc();
    Y.applyUpdate(v1, repo.getYDocState(diag.id)!);
    const c1 = new Y.Map();
    c1.set('id', 'comment-1');
    c1.set('content', '基线批注');
    v1.getMap('comments').set('comment-1', c1);
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(v1));
    const snap = repo.createSnapshot(diag.id, '含批注快照', 'manual')!;

    const v2 = new Y.Doc();
    Y.applyUpdate(v2, repo.getYDocState(diag.id)!);
    v2.getMap('meta').set('title', '被修改的标题');
    v2.getMap('meta').set('customExt', 'keep-me');
    const vc1 = v2.getMap<Y.Map<unknown>>('comments').get('comment-1')!;
    vc1.set('content', '改后批注');
    vc1.set('resolved', true);
    const c2 = new Y.Map();
    c2.set('id', 'comment-2');
    c2.set('content', '快照后新增批注');
    v2.getMap('comments').set('comment-2', c2);
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(v2));

    const res = await writer.restoreSnapshot(diag.id, snap.id);
    expect(res.success).toBe(true);

    const recovered = new Y.Doc();
    Y.applyUpdate(recovered, repo.getYDocState(diag.id)!);
    expect(recovered.getMap('meta').get('title')).toBe('初始标题');
    expect(recovered.getMap('meta').get('customExt')).toBe('keep-me');

    const comments = recovered.getMap<Y.Map<unknown>>('comments');
    expect(comments.size).toBe(1);
    expect(comments.has('comment-2')).toBe(false);
    expect(comments.get('comment-1')!.get('content')).toBe('基线批注');
    expect(comments.get('comment-1')!.has('resolved')).toBe(false);

    db.close();
  });

  it('校验快照创建/恢复入参并支持快照列表分页', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diag = server.repo.createDiagram({ title: '快照校验图' });

    const badCreate1 = await server.app.inject({
      method: 'POST',
      url: `/api/diagrams/${diag.id}/snapshots`,
      payload: { triggerType: 'invalid_trigger' },
    });
    expect(badCreate1.statusCode).toBe(400);

    const badCreate2 = await server.app.inject({
      method: 'POST',
      url: `/api/diagrams/${diag.id}/snapshots`,
      payload: { label: 'a'.repeat(101) },
    });
    expect(badCreate2.statusCode).toBe(400);

    const s1 = (await server.app.inject({ method: 'POST', url: `/api/diagrams/${diag.id}/snapshots`, payload: { label: 'S1' } })).json();
    await server.app.inject({ method: 'POST', url: `/api/diagrams/${diag.id}/snapshots`, payload: { label: 'S2' } });
    await server.app.inject({ method: 'POST', url: `/api/diagrams/${diag.id}/snapshots`, payload: { label: 'S3' } });

    const pagedList = await server.app.inject({
      method: 'GET',
      url: `/api/diagrams/${diag.id}/snapshots?limit=2&offset=1`,
    });
    expect(pagedList.statusCode).toBe(200);
    expect(pagedList.json()).toHaveLength(2);

    const badQuery = await server.app.inject({
      method: 'GET',
      url: `/api/diagrams/${diag.id}/snapshots?limit=0`,
    });
    expect(badQuery.statusCode).toBe(400);

    const badRestore1 = await server.app.inject({
      method: 'POST',
      url: `/api/diagrams/${diag.id}/snapshots/${s1.id}/restore`,
      payload: { mode: 'overwrite' },
    });
    expect(badRestore1.statusCode).toBe(400);

    const badRestore2 = await server.app.inject({
      method: 'POST',
      url: `/api/diagrams/${diag.id}/snapshots/${s1.id}/restore`,
      payload: { applyLocal: 'yes' },
    });
    expect(badRestore2.statusCode).toBe(400);

    await server.app.close();
  });
});

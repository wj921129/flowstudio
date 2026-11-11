import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as Y from 'yjs';
import { initDatabase } from '../src/db/database.js';
import { DiagramRepository } from '../src/db/diagram-repository.js';
import { DocumentWriter } from '../src/collaboration/document-writer.js';
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
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as Y from 'yjs';
import { initDatabase } from '../src/db/database.js';
import { DiagramRepository } from '../src/db/diagram-repository.js';
import { buildServer } from '../src/server.js';

describe('快照详情与内容查询 REST 接口', () => {
  let tmpDbPath: string;

  beforeEach(() => {
    tmpDbPath = path.join(os.tmpdir(), `flowstudio-diff-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`);
  });

  afterEach(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        if (fs.existsSync(tmpDbPath + suffix)) fs.unlinkSync(tmpDbPath + suffix);
      } catch {}
    }
  });

  it('成功返回指定快照反序列化后的 nodes 与 edges 实体', async () => {
    const db = initDatabase(tmpDbPath);
    const repo = new DiagramRepository(db);
    const diag = repo.createDiagram({ title: '比对源图' });

    const doc = new Y.Doc();
    doc.getMap('meta').set('title', '比对源图');
    const n1 = new Y.Map();
    n1.set('id', 'node-1');
    n1.set('type', 'start-end');
    n1.set('position', { x: 100, y: 150 });
    n1.set('data', { label: '发起流程' });
    doc.getMap('nodes').set('node-1', n1);

    const e1 = new Y.Map();
    e1.set('id', 'edge-1');
    e1.set('source', 'node-1');
    e1.set('target', 'node-2');
    doc.getMap('edges').set('edge-1', e1);

    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc));
    const snap = repo.createSnapshot(diag.id, '快照A', 'manual');
    expect(snap).not.toBeNull();
    db.close();

    const server = await buildServer({ dbPath: tmpDbPath });
    const res = await server.app.inject({
      method: 'GET',
      url: `/api/diagrams/${diag.id}/snapshots/${snap!.id}`,
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.id).toBe(snap!.id);
    expect(data.diagramId).toBe(diag.id);
    expect(data.nodes.length).toBe(1);
    expect(data.nodes[0].id).toBe('node-1');
    expect(data.nodes[0].data.label).toBe('发起流程');
    expect(data.edges.length).toBe(1);
    expect(data.edges[0].id).toBe('edge-1');

    await server.app.close();
  });

  it('对于不存在的快照返回 404 错误', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const createRes = await server.app.inject({
      method: 'POST',
      url: '/api/diagrams',
      payload: { title: '测试空快照' },
    });
    const diag = JSON.parse(createRes.body);

    const res = await server.app.inject({
      method: 'GET',
      url: `/api/diagrams/${diag.id}/snapshots/snap-not-exist`,
    });
    expect(res.statusCode).toBe(404);
    await server.app.close();
  });
});

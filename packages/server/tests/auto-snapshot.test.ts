import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as Y from 'yjs';
import { initDatabase } from '../src/db/database.js';
import { DiagramRepository } from '../src/db/diagram-repository.js';
import { DocumentWriter } from '../src/collaboration/document-writer.js';
import { AutoSnapshotScheduler } from '../src/collaboration/auto-snapshot.js';
import { buildServer } from '../src/server.js';

describe('定时自动快照与自动排版前置备份', () => {
  let tmpDbPath: string;

  beforeEach(() => {
    tmpDbPath = path.join(
      os.tmpdir(),
      `flowstudio-auto-snap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`,
    );
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

  it('start 采集基线，变更后按周期生成 auto 快照，同态不重复空转', () => {
    const db = initDatabase(tmpDbPath);
    const repo = new DiagramRepository(db);
    const writer = new DocumentWriter(repo);
    const diagram = repo.createDiagram({ title: '定时快照图' });
    const scheduler = new AutoSnapshotScheduler(repo, writer, { intervalMs: 60_000 });

    scheduler.start();
    expect(scheduler.runOnce()).toHaveLength(0);
    expect(repo.listSnapshots(diagram.id)).toHaveLength(0);

    const doc = new Y.Doc();
    Y.applyUpdate(doc, repo.getYDocState(diagram.id)!);
    const node = new Y.Map<unknown>();
    node.set('id', 'node-timer');
    node.set('type', 'process');
    doc.getMap('nodes').set('node-timer', node);
    repo.saveYDocState(diagram.id, Y.encodeStateAsUpdate(doc));

    const created = scheduler.runOnce();
    expect(created).toHaveLength(1);
    expect(created[0].triggerType).toBe('auto');
    expect(created[0].label).toBe('定时自动快照');

    expect(scheduler.runOnce()).toHaveLength(0);
    expect(repo.listSnapshots(diagram.id)).toHaveLength(1);

    scheduler.stop();
    db.close();
  });

  it('持续变更按 tick 分别落快照，删除图表后指纹清理', () => {
    const db = initDatabase(tmpDbPath);
    const repo = new DiagramRepository(db);
    const writer = new DocumentWriter(repo);
    const diagram = repo.createDiagram({ title: '连续变更图' });
    const scheduler = new AutoSnapshotScheduler(repo, writer, { intervalMs: 60_000 });
    scheduler.start();

    for (const nodeId of ['n1', 'n2']) {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, repo.getYDocState(diagram.id)!);
      const node = new Y.Map<unknown>();
      node.set('id', nodeId);
      node.set('type', 'process');
      doc.getMap('nodes').set(nodeId, node);
      repo.saveYDocState(diagram.id, Y.encodeStateAsUpdate(doc));
      expect(scheduler.runOnce()).toHaveLength(1);
    }
    expect(repo.listSnapshots(diagram.id)).toHaveLength(2);

    repo.deleteDiagram(diagram.id);
    expect(scheduler.runOnce()).toHaveLength(0);

    scheduler.stop();
    db.close();
  });

  it('auto_layout 前置安全备份使用 auto 触发类型', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diagram = server.repo.createDiagram({ title: '自动排版备份图' });
    const doc = new Y.Doc();
    for (const id of ['seed-a', 'seed-b']) {
      const node = new Y.Map<unknown>();
      node.set('id', id);
      node.set('type', 'process');
      node.set('position', { x: 0, y: 0 });
      node.set('width', 160);
      node.set('height', 80);
      node.set('data', { label: id, type: 'process' });
      doc.getMap('nodes').set(id, node);
    }
    const edge = new Y.Map<unknown>();
    edge.set('id', 'seed-edge');
    edge.set('source', 'seed-a');
    edge.set('target', 'seed-b');
    edge.set('data', {});
    doc.getMap('edges').set('seed-edge', edge);
    server.repo.saveYDocState(diagram.id, Y.encodeStateAsUpdate(doc));

    const res = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'auto_layout', arguments: { diagramId: diagram.id, direction: 'RIGHT' } },
      },
    });
    expect(res.statusCode).toBe(200);

    const preLayout = server.repo
      .listSnapshots(diagram.id)
      .find((snap) => snap.label === '服务端自动排版前快照');
    expect(preLayout).toBeTruthy();
    expect(preLayout!.triggerType).toBe('auto');

    await server.app.close();
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as Y from 'yjs';
import { initDatabase } from '../src/db/database.js';
import { DiagramRepository } from '../src/db/diagram-repository.js';
import { DocumentWriter } from '../src/collaboration/document-writer.js';
import { AutoSnapshotScheduler } from '../src/collaboration/auto-snapshot.js';
import { SaveStatusTracker } from '../src/collaboration/save-status.js';
import { SqlitePersistenceExtension } from '../src/collaboration/sqlite-extension.js';
import { buildServer } from '../src/server.js';

describe('保存状态信号与手动保存', () => {
  let tmpDbPath: string;

  beforeEach(() => {
    tmpDbPath = path.join(
      os.tmpdir(),
      `flowstudio-save-status-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`,
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

  it('onStoreDocument 成功落库后记录 lastSavedAt，删除图表后不再记录', async () => {
    const db = initDatabase(':memory:');
    const repo = new DiagramRepository(db);
    const tracker = new SaveStatusTracker(repo);
    const ext = new SqlitePersistenceExtension(repo, tracker);

    const diagram = repo.createDiagram({ title: '落库信号图' });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, repo.getYDocState(diagram.id)!);
    doc.getMap('nodes').set('n1', new Y.Map([['id', 'n1']]));

    await ext.onStoreDocument({ documentName: diagram.id, document: doc } as any);
    const savedAt = tracker.getLastSavedAt(diagram.id);
    expect(savedAt).toBeTruthy();
    expect(Number.isNaN(Date.parse(savedAt!))).toBe(false);

    const ghost = repo.createDiagram({ title: '已删除图' });
    repo.deleteDiagram(ghost.id);
    await ext.onStoreDocument({ documentName: ghost.id, document: doc } as any);
    expect(tracker.getLastSavedAt(ghost.id)).toBeNull();

    db.close();
  });

  it('POST /save 跳过防抖立即落库并刷新 lastSavedAt', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diagram = server.repo.createDiagram({ title: '手动保存图' });
    const before = Date.now();

    const direct = await server.hocuspocus.openDirectConnection(diagram.id);
    const liveDoc = direct.document as unknown as Y.Doc;
    liveDoc.getMap('nodes').set('n-save', new Y.Map([['id', 'n-save'], ['type', 'process']]));

    const res = await server.app.inject({
      method: 'POST',
      url: `/api/diagrams/${diagram.id}/save`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.flushed).toBe(true);
    expect(Date.parse(body.status.lastSavedAt)).toBeGreaterThanOrEqual(before);

    const persisted = new Y.Doc();
    Y.applyUpdate(persisted, server.repo.getYDocState(diagram.id)!);
    expect(persisted.getMap('nodes').has('n-save')).toBe(true);
    persisted.destroy();

    await direct.disconnect();
    await server.app.close();
  });

  it('GET /save-status 默认停用服务端巡检（nextSnapshotAt=null），显式配置间隔时暴露完整契约', async () => {
    const defaultServer = await buildServer({ dbPath: tmpDbPath });
    const defaultDiag = defaultServer.repo.createDiagram({ title: '默认巡检关闭图' });
    const defaultRes = await defaultServer.app.inject({
      method: 'GET',
      url: `/api/diagrams/${defaultDiag.id}/save-status`,
    });
    expect(defaultRes.statusCode).toBe(200);
    expect(defaultRes.json().nextSnapshotAt).toBeNull();
    await defaultServer.app.close();

    const server = await buildServer({ dbPath: tmpDbPath, autoSnapshotIntervalMs: 300_000 });
    const diagram = server.repo.createDiagram({ title: '状态契约图' });

    const snapshot = server.writer.createSnapshot(diagram.id, '契约快照', 'manual');
    expect(snapshot).toBeTruthy();

    const res = await server.app.inject({
      method: 'GET',
      url: `/api/diagrams/${diagram.id}/save-status`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.diagramId).toBe(diagram.id);
    expect(body.lastSnapshotAt).toBe(snapshot!.createdAt);
    expect(typeof body.lastSavedAt).toBe('string');
    expect(body.snapshotIntervalMs).toBe(300_000);
    expect(body.nextSnapshotAt).toBeTruthy();
    expect(Date.parse(body.nextSnapshotAt)).toBeGreaterThan(Date.now());
    expect(body.serverTime).toBeTruthy();

    await server.app.close();
  });

  it('save-status 与 save 对不存在的图表返回 404', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });

    const statusRes = await server.app.inject({
      method: 'GET',
      url: '/api/diagrams/not-exist/save-status',
    });
    expect(statusRes.statusCode).toBe(404);

    const saveRes = await server.app.inject({
      method: 'POST',
      url: '/api/diagrams/not-exist/save',
    });
    expect(saveRes.statusCode).toBe(404);

    await server.app.close();
  });

  it('AutoSnapshotScheduler.getStatus 反映运行态与下一次巡检时间', () => {
    const db = initDatabase(':memory:');
    const repo = new DiagramRepository(db);
    const writer = new DocumentWriter(repo);
    const scheduler = new AutoSnapshotScheduler(repo, writer, { intervalMs: 60_000 });

    expect(scheduler.getStatus()).toMatchObject({
      running: false,
      nextRunAt: null,
      intervalMs: 60_000,
    });

    scheduler.start();
    const status = scheduler.getStatus();
    expect(status.running).toBe(true);
    expect(status.startedAt).toBeTruthy();
    expect(Date.parse(status.nextRunAt!)).toBeGreaterThan(Date.now());

    scheduler.stop();
    expect(scheduler.getStatus().nextRunAt).toBeNull();

    db.close();
  });
});

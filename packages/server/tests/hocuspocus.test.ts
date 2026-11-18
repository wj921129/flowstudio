import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { initDatabase } from '../src/db/database.js';
import { DiagramRepository } from '../src/db/diagram-repository.js';
import { SqlitePersistenceExtension } from '../src/collaboration/sqlite-extension.js';
import { buildServer } from '../src/server.js';

describe('SqlitePersistenceExtension', () => {
  let repo: DiagramRepository;
  let ext: SqlitePersistenceExtension;

  beforeEach(() => {
    const db = initDatabase(':memory:');
    repo = new DiagramRepository(db);
    ext = new SqlitePersistenceExtension(repo);
  });

  it('loads existing Y.Doc state from SQLite and stores updates back', async () => {
    const diagram = repo.createDiagram({ title: '初始标题' });
    // 模拟真实协同客户端：先应用既有状态，再在同一文档上增量编辑
    const seedDoc = new Y.Doc();
    Y.applyUpdate(seedDoc, repo.getYDocState(diagram.id)!);
    seedDoc.getMap('meta').set('title', '协同修改后标题');
    seedDoc.getMap('nodes').set('n1', new Y.Map([['id', 'n1']]));

    await ext.onStoreDocument({
      documentName: diagram.id,
      document: seedDoc,
    } as any);

    // 验证标题与二进制状态均已落盘
    expect(repo.getDiagramById(diagram.id)?.title).toBe('协同修改后标题');

    const targetDoc = new Y.Doc();
    await ext.onLoadDocument({
      documentName: diagram.id,
      document: targetDoc,
    } as any);

    expect(targetDoc.getMap('meta').get('title')).toBe('协同修改后标题');
    expect(targetDoc.getMap('nodes').has('n1')).toBe(true);
  });

  it('onLoadDocument 对不存在的图表抛出错误且 WS 建连不创建孤立内存房间', async () => {
    const missingDoc = new Y.Doc();
    await expect(
      ext.onLoadDocument({
        documentName: 'not-exist-diagram',
        document: missingDoc,
      } as any),
    ).rejects.toThrow('图表不存在');
    missingDoc.destroy();

    const server = await buildServer({ dbPath: ':memory:' });
    await server.app.listen({ port: 0, host: '127.0.0.1' });
    const addr = server.app.server.address() as { port: number };

    const clientDoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${addr.port}/collaboration`,
      name: 'ghost-diagram-id',
      document: clientDoc,
      WebSocketPolyfill: WebSocket as any,
    });

    const outcome = await new Promise<'rejected' | 'synced'>((resolve) => {
      provider.on('authenticationFailed', () => {
        provider.destroy();
        resolve('rejected');
      });
      provider.on('close', () => {
        provider.destroy();
        resolve('rejected');
      });
      provider.on('synced', () => {
        provider.destroy();
        resolve('synced');
      });
    });

    expect(outcome).toBe('rejected');
    expect(server.hocuspocus.getDocumentsCount()).toBe(0);
    await server.app.close();
  });

  it('WebSocket 拒绝非二进制文本帧、兜底畸形消息且限制 maxPayload 防止进程崩溃', async () => {
    const server = await buildServer({ dbPath: ':memory:' });
    await server.app.listen({ port: 0, host: '127.0.0.1' });
    const addr = server.app.server.address() as { port: number };
    const diagram = server.repo.createDiagram({ title: 'WS边界图' });

    // 1. 文本帧被拒绝并关闭（code 1003）
    const textClose = await new Promise<{ code: number }>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/collaboration/${diagram.id}`);
      ws.on('open', () => ws.send('invalid-text-frame'));
      ws.on('close', (code) => resolve({ code }));
    });
    expect(textClose.code).toBe(1003);

    // 2. 畸形二进制帧由 try/catch 安全处理关闭而不崩溃
    const malformedClose = await new Promise<{ code: number }>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/collaboration/${diagram.id}`);
      ws.on('open', () => ws.send(Buffer.from([0xff, 0xff, 0xff, 0xff])));
      ws.on('close', (code) => resolve({ code }));
    });
    expect(malformedClose.code).toBeGreaterThanOrEqual(1000);

    // 3. 超出 maxPayload (16MB) 被 ws 层立即断开（1009 或底层 socket 关闭 1006）
    const oversizeClose = await new Promise<{ code: number }>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/collaboration/${diagram.id}`);
      ws.on('open', () => ws.send(Buffer.alloc(16 * 1024 * 1024 + 1)));
      ws.on('close', (code) => resolve({ code }));
    });
    expect([1006, 1009]).toContain(oversizeClose.code);

    // 4. 服务依然健康可用
    const healthRes = await server.app.inject({ method: 'GET', url: `/api/diagrams/${diagram.id}` });
    expect(healthRes.statusCode).toBe(200);

    await server.app.close();
  });
});

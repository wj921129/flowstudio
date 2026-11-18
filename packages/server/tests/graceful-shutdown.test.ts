import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { buildServer } from '../src/server.js';
import { registerShutdownSignals } from '../src/index.js';

describe('服务优雅停机与防抖落库刷新', () => {
  let tmpDbPath: string;

  beforeEach(() => {
    tmpDbPath = path.join(
      os.tmpdir(),
      `flowstudio-shutdown-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`,
    );
  });

  afterEach(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        if (fs.existsSync(tmpDbPath + suffix)) {
          fs.unlinkSync(tmpDbPath + suffix);
        }
      } catch {
        // 忽略清理异常
      }
    }
  });

  it('在活跃协作编辑防抖窗口内触发 app.close() 后，重开服务仍完整保留最后一次编辑', async () => {
    const server1 = await buildServer({ dbPath: tmpDbPath });
    await server1.app.listen({ port: 0, host: '127.0.0.1' });
    const addr1 = server1.app.server.address() as { port: number };

    const createRes = await server1.app.inject({
      method: 'POST',
      url: '/api/diagrams',
      payload: { title: '防抖停机测试图' },
    });
    const diagramId = createRes.json().id as string;

    const clientDoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${addr1.port}/collaboration`,
      name: diagramId,
      document: clientDoc,
      WebSocketPolyfill: WebSocket as any,
    });

    await new Promise<void>((resolve) => {
      if (provider.isSynced) resolve();
      else provider.on('synced', () => resolve());
    });

    // 在防抖窗口（500ms）内写入编辑，未等待防抖定时器到期即关闭服务
    clientDoc.transact(() => {
      const nodeMap = new Y.Map();
      nodeMap.set('id', 'node-unsaved');
      nodeMap.set('type', 'process');
      nodeMap.set('data', { label: '防抖窗内新节点', type: 'process' });
      clientDoc.getMap('nodes').set('node-unsaved', nodeMap);
    }, 'test-client');

    // 确认服务端内存文档已收到增量（仍在防抖窗口内，尚未落库）
    const deadline = Date.now() + 300;
    while (Date.now() < deadline) {
      if (server1.writer.getLiveDocument(diagramId)?.getMap('nodes').has('node-unsaved')) {
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(server1.writer.getLiveDocument(diagramId)?.getMap('nodes').has('node-unsaved')).toBe(true);

    // 不断开客户端、不等待防抖直接停机
    await server1.app.close();
    provider.destroy();

    // 重开服务并连接同一个 SQLite 文件，验证数据完整保留
    const server2 = await buildServer({ dbPath: tmpDbPath });
    const persisted = await server2.writer.readDocument(diagramId, (doc) =>
      doc.getMap('nodes').has('node-unsaved'),
    );
    expect(persisted).toBe(true);
    await server2.app.close();
  }, 15000);

  it('在途异步 onStoreDocument 执行期间触发新编辑并立即停机，等待全部写盘完成后再关闭 SQLite', async () => {
    const server1 = await buildServer({
      dbPath: tmpDbPath,
      autoSnapshotIntervalMs: 20,
    });

    let storeStartedResolve!: () => void;
    const firstStoreStarted = new Promise<void>((r) => {
      storeStartedResolve = r;
    });
    let storeCount = 0;
    let firstStoreFinished = false;

    // 注入高优先级异步前置存储钩子，模拟耗时的异步落库前处理
    server1.hocuspocus.configure({
      extensions: [
        ...server1.hocuspocus.configuration.extensions,
        {
          priority: 200,
          async onStoreDocument() {
            storeCount += 1;
            if (storeCount === 1) {
              storeStartedResolve();
            }
            await new Promise((r) => setTimeout(r, 80));
            if (storeCount === 1) {
              firstStoreFinished = true;
            }
          },
        },
      ],
    });

    await server1.app.listen({ port: 0, host: '127.0.0.1' });
    const addr1 = server1.app.server.address() as { port: number };

    const createRes = await server1.app.inject({
      method: 'POST',
      url: '/api/diagrams',
      payload: { title: '异步落库竞态测试' },
    });
    const diagramId = createRes.json().id as string;

    const clientDoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${addr1.port}/collaboration`,
      name: diagramId,
      document: clientDoc,
      WebSocketPolyfill: WebSocket as any,
    });

    await new Promise<void>((resolve) => {
      if (provider.isSynced) resolve();
      else provider.on('synced', () => resolve());
    });

    // 第一次编辑：等待其进入在途异步 onStoreDocument
    clientDoc.transact(() => {
      clientDoc.getMap('nodes').set('n1', new Y.Map([['id', 'n1']]));
    }, 'client-1');

    await firstStoreStarted;
    expect(firstStoreFinished).toBe(false);

    // 在第一次异步 onStoreDocument 尚未完成时写入第二次编辑，并立即停机
    clientDoc.transact(() => {
      clientDoc.getMap('nodes').set('n2', new Y.Map([['id', 'n2']]));
    }, 'client-2');

    const deadline = Date.now() + 300;
    while (Date.now() < deadline) {
      if (server1.writer.getLiveDocument(diagramId)?.getMap('nodes').has('n2')) {
        break;
      }
      await new Promise((r) => setTimeout(r, 5));
    }

    await server1.app.close();
    provider.destroy();

    expect(server1.autoSnapshot.getStatus().running).toBe(false);
    expect(firstStoreFinished).toBe(true);

    // 验证两次编辑均已真实写入 SQLite，且无竞态丢数据
    const server2 = await buildServer({ dbPath: tmpDbPath });
    const keys = await server2.writer.readDocument(diagramId, (doc) => [
      doc.getMap('nodes').has('n1'),
      doc.getMap('nodes').has('n2'),
    ]);
    expect(keys).toEqual([true, true]);
    await server2.app.close();
  }, 15000);

  it('测试环境下导入入口不自动挂载进程信号，且信号监听具备防重入与完整走完停机钩子能力', async () => {
    const server1 = await buildServer({ dbPath: tmpDbPath });
    await server1.app.listen({ port: 0, host: '127.0.0.1' });
    const addr1 = server1.app.server.address() as { port: number };

    const createRes = await server1.app.inject({
      method: 'POST',
      url: '/api/diagrams',
      payload: { title: '信号停机测试图' },
    });
    const diagramId = createRes.json().id as string;

    const clientDoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${addr1.port}/collaboration`,
      name: diagramId,
      document: clientDoc,
      WebSocketPolyfill: WebSocket as any,
    });
    await new Promise<void>((resolve) => {
      if (provider.isSynced) resolve();
      else provider.on('synced', () => resolve());
    });

    clientDoc.transact(() => {
      clientDoc.getMap('nodes').set('sig-node', new Y.Map([['id', 'sig-node']]));
    }, 'sig-client');

    const deadline = Date.now() + 300;
    while (Date.now() < deadline) {
      if (server1.writer.getLiveDocument(diagramId)?.getMap('nodes').has('sig-node')) break;
      await new Promise((r) => setTimeout(r, 5));
    }

    const emitter = new EventEmitter();
    const exitCodes: number[] = [];
    let closeCalls = 0;
    const origClose = server1.app.close.bind(server1.app);
    server1.app.close = (async () => {
      closeCalls += 1;
      return origClose();
    }) as any;

    const exitPromise = new Promise<void>((resolve) => {
      registerShutdownSignals(server1.app, {
        target: emitter,
        exit: (code) => {
          exitCodes.push(code);
          resolve();
        },
      });
    });

    // 连续触发 SIGINT 与 SIGTERM，验证防重入
    emitter.emit('SIGINT', 'SIGINT');
    emitter.emit('SIGTERM', 'SIGTERM');
    emitter.emit('SIGINT', 'SIGINT');

    await exitPromise;
    provider.destroy();

    expect(closeCalls).toBe(1);
    expect(exitCodes).toEqual([0]);
    expect(emitter.listenerCount('SIGINT')).toBe(0);
    expect(emitter.listenerCount('SIGTERM')).toBe(0);

    const server2 = await buildServer({ dbPath: tmpDbPath });
    const persisted = await server2.writer.readDocument(diagramId, (doc) =>
      doc.getMap('nodes').has('sig-node'),
    );
    expect(persisted).toBe(true);
    await server2.app.close();
  }, 15000);

  it('NODE_ENV=test 导入入口不挂载 process 信号，停机异常时退出码为 1 并清理监听', async () => {
    const beforeSigint = process.listenerCount('SIGINT');
    const beforeSigterm = process.listenerCount('SIGTERM');
    vi.resetModules();
    await import('../src/index.js');
    expect(process.listenerCount('SIGINT')).toBe(beforeSigint);
    expect(process.listenerCount('SIGTERM')).toBe(beforeSigterm);

    const emitter = new EventEmitter();
    const exitCodes: number[] = [];
    const fakeApp = {
      close: async () => {
        throw new Error('close failed');
      },
    } as any;

    const exitPromise = new Promise<void>((resolve) => {
      registerShutdownSignals(fakeApp, {
        target: emitter,
        exit: (code) => {
          exitCodes.push(code);
          resolve();
        },
      });
    });

    emitter.emit('SIGTERM', 'SIGTERM');
    await exitPromise;

    expect(exitCodes).toEqual([1]);
    expect(emitter.listenerCount('SIGINT')).toBe(0);
    expect(emitter.listenerCount('SIGTERM')).toBe(0);
  });
});

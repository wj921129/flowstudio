import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { buildServer } from '../src/server.js';

describe('M2 Quality Gate: 5 Concurrent Clients & Server Restart Persistence', () => {
  let tmpDbPath: string;

  beforeEach(() => {
    tmpDbPath = path.join(os.tmpdir(), `flowstudio-m2-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`);
  });

  afterEach(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        if (fs.existsSync(tmpDbPath + suffix)) {
          fs.unlinkSync(tmpDbPath + suffix);
        }
      } catch {
        // ignore cleanup error
      }
    }
  });

  it('syncs 5 concurrent clients without data loss and survives server restart', async () => {
    // 1. 启动第一代 Server
    const server1 = await buildServer({ dbPath: tmpDbPath });
    await server1.app.listen({ port: 0, host: '127.0.0.1' });
    const addr1 = server1.app.server.address() as { port: number };
    const wsUrl1 = `ws://127.0.0.1:${addr1.port}/collaboration`;

    const createRes = await server1.app.inject({
      method: 'POST',
      url: '/api/diagrams',
      payload: { title: '五人并发压测图' },
    });
    const diagramId = createRes.json().id as string;

    // 2. 同时建立 5 个独立客户端连接
    const clients = Array.from({ length: 5 }, (_, idx) => {
      const doc = new Y.Doc();
      const provider = new HocuspocusProvider({
        url: wsUrl1,
        name: diagramId,
        document: doc,
        WebSocketPolyfill: WebSocket as any,
      });
      return { id: `client-${idx + 1}`, doc, provider };
    });

    await Promise.all(
      clients.map(
        (c) =>
          new Promise<void>((resolve) => {
            if (c.provider.isSynced) {
              resolve();
            } else {
              c.provider.on('synced', () => {
                resolve();
              });
            }
          })
      )
    );


    // 3. 5 个客户端并发写入各自节点
    clients.forEach((c, idx) => {
      c.doc.transact(() => {
        const nodeMap = new Y.Map();
        nodeMap.set('id', `node-${idx + 1}`);
        nodeMap.set('type', 'process');
        nodeMap.set('position', { x: idx * 150, y: 100 });
        nodeMap.set('data', { label: `节点-${idx + 1}`, type: 'process' });
        c.doc.getMap('nodes').set(`node-${idx + 1}`, nodeMap);
      }, c.id);
    });

    // 等待全网收敛与防抖落盘
    await new Promise((r) => setTimeout(r, 1200));

    for (const c of clients) {
      expect(c.doc.getMap('nodes').size).toBe(5);
      c.provider.destroy();
    }

    // 4. 关闭第一代 Server（模拟服务重启）
    await server1.app.close();

    // 5. 启动第二代 Server 挂载同一个 SQLite 文件，新客户端连接验证数据完整恢复
    const server2 = await buildServer({ dbPath: tmpDbPath });
    await server2.app.listen({ port: 0, host: '127.0.0.1' });
    const addr2 = server2.app.server.address() as { port: number };

    const recoveryDoc = new Y.Doc();
    const recoveryProvider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${addr2.port}/collaboration`,
      name: diagramId,
      document: recoveryDoc,
      WebSocketPolyfill: WebSocket as any,
    });

    await new Promise<void>((resolve) => {
      if (recoveryProvider.isSynced) resolve();
      else recoveryProvider.on('synced', () => resolve());
    });

    expect(recoveryDoc.getMap('nodes').size).toBe(5);
    for (let i = 1; i <= 5; i++) {
      expect(recoveryDoc.getMap('nodes').has(`node-${i}`)).toBe(true);
    }

    recoveryProvider.destroy();
    await server2.app.close();
  }, 15000);
});


import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { buildServer } from '../src/server.js';

type Server = Awaited<ReturnType<typeof buildServer>>;

async function callTool(server: Server, id: number, name: string, args: Record<string, unknown>) {
  const res = await server.app.inject({
    method: 'POST',
    url: '/mcp',
    payload: {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args },
    },
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.json().result.content[0].text);
}

async function waitUntil<T>(
  probe: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeout = 4000,
  interval = 50,
): Promise<T> {
  const startedAt = Date.now();
  let last = await probe();
  while (!predicate(last) && Date.now() - startedAt < timeout) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    last = await probe();
  }
  return last;
}

describe('MCP get_selection 实时 Awareness 选区感知', () => {
  let tmpDbPath: string;

  beforeEach(() => {
    tmpDbPath = path.join(os.tmpdir(), `flowstudio-awareness-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`);
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

  it('从在线客户端 Awareness 读取真实选中节点并支持昵称过滤', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    await server.app.listen({ port: 0, host: '127.0.0.1' });
    const addr = server.app.server.address() as { port: number };

    const created = await callTool(server, 1, 'create_diagram', { title: '选区感知图' });
    const diagramId = created.id as string;

    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${addr.port}/collaboration`,
      name: diagramId,
      document: doc,
      WebSocketPolyfill: WebSocket as any,
    });

    await new Promise<void>((resolve) => {
      if (provider.isSynced) resolve();
      else provider.on('synced', () => resolve());
    });

    provider.setAwarenessField('user', {
      clientId: 'client-wang',
      nickname: '王工',
      color: '#6366F1',
      cursor: { x: 320, y: 180 },
      selectedNodeIds: ['node-1', 'node-2'],
      viewport: { x: 0, y: 0, zoom: 1.2 },
      spotlightNodeIds: ['node-1'],
      isAi: false,
    });

    const result = await waitUntil(
      () => callTool(server, 2, 'get_selection', { diagramId }),
      (value) => Array.isArray(value.selections) && value.selections.length > 0,
    );

    expect(result.selections).toContainEqual({
      clientId: 'client-wang',
      nickname: '王工',
      selectedNodeIds: ['node-1', 'node-2'],
    });
    expect(result.message).toContain('1 位在线同事');

    // 昵称过滤：不匹配时返回空选区
    const filtered = await callTool(server, 3, 'get_selection', {
      diagramId,
      nickname: '李四',
    });
    expect(filtered.selections).toEqual([]);
    expect(filtered.message).toContain('无在线同事选中节点');

    provider.destroy();
    await server.app.close();
  }, 20000);

  it('无客户端在线时返回空选区而非报错', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const created = await callTool(server, 1, 'create_diagram', { title: '离线选区图' });
    const diagramId = created.id as string;

    const result = await callTool(server, 2, 'get_selection', { diagramId });
    expect(result.selections).toEqual([]);
    expect(result.message).toContain('无在线同事选中节点');

    await server.app.close();
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildServer } from '../src/server.js';

describe('MCP stdio Bridge Script (flowstudio-mcp.cjs)', () => {
  let tmpDbPath: string;

  beforeEach(() => {
    tmpDbPath = path.join(os.tmpdir(), `flowstudio-stdio-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`);
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

  it('relays JSON-RPC stdio calls to HTTP MCP endpoint and receives tool definitions', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    await server.app.listen({ port: 0, host: '127.0.0.1' });
    const addr = server.app.server.address() as { port: number };
    const mcpHttpUrl = `http://127.0.0.1:${addr.port}/mcp`;

    const scriptPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../scripts/flowstudio-mcp.cjs',
    );

    // 拉起 stdio 桥接进程
    const child = spawn(process.execPath, [scriptPath, '--url', mcpHttpUrl], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    const responses: any[] = [];
    let buffer = '';

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) {
          responses.push(JSON.parse(line.trim()));
        }
      }
    });

    // 1. 发送 initialize
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      }) + '\n'
    );

    // 2. 发送 tools/list
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      }) + '\n'
    );

    // 等待响应到达
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (responses.length >= 2) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });

    // 验证 initialize
    const initRes = responses.find((r) => r.id === 1);
    expect(initRes).toBeDefined();
    expect(initRes.result.serverInfo.name).toBe('flowstudio-mcp-server');

    // 验证 tools/list
    const toolsRes = responses.find((r) => r.id === 2);
    expect(toolsRes).toBeDefined();
    expect(toolsRes.result.tools.length).toBe(8);

    child.kill();
    await server.app.close();
  });
});

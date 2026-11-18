import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 获取本机首选的局域网物理 IPv4 地址
 */
export function getLocalNetworkIp(): string {
  const interfaces = os.networkInterfaces();
  const candidates: string[] = [];

  for (const name of Object.keys(interfaces)) {
    const ifaceList = interfaces[name];
    if (!ifaceList) continue;

    for (const iface of ifaceList) {
      if (iface.family === 'IPv4' && !iface.internal) {
        // 优先匹配标准内网网段
        if (
          iface.address.startsWith('192.168.') ||
          iface.address.startsWith('10.') ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(iface.address)
        ) {
          return iface.address;
        }
        candidates.push(iface.address);
      }
    }
  }

  return candidates[0] || '127.0.0.1';
}

export interface ShutdownSignalOptions {
  target?: Pick<NodeJS.EventEmitter, 'on' | 'off'>;
  exit?: (code: number) => void;
}

export function registerShutdownSignals(
  app: FastifyInstance,
  options: ShutdownSignalOptions = {},
): () => void {
  const target = options.target ?? process;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let closing: Promise<void> | null = null;

  const cleanup = () => {
    target.off('SIGINT', onSignal);
    target.off('SIGTERM', onSignal);
  };

  const onSignal = (signal: NodeJS.Signals) => {
    if (closing) return;
    console.log(`[FlowStudio] 收到退出信号 ${signal}，正在优雅停机...`);
    closing = (async () => {
      try {
        await app.close();
        cleanup();
        exit(0);
      } catch (err) {
        console.error('[FlowStudio] 优雅停机失败:', err);
        cleanup();
        exit(1);
      }
    })();
  };

  target.on('SIGINT', onSignal);
  target.on('SIGTERM', onSignal);
  return cleanup;
}

async function main() {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  const dbPath = process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'flowstudio.sqlite');
  const webDistPath = process.env.WEB_DIST || path.resolve(__dirname, '../../web/dist');
  const autoSnapshotIntervalMs = Number(process.env.AUTO_SNAPSHOT_INTERVAL_MS) || undefined;

  const { app } = await buildServer({ dbPath, webDistPath, autoSnapshotIntervalMs });
  const unregisterSignals = registerShutdownSignals(app);

  try {
    await app.listen({ port, host });
    const lanIp = getLocalNetworkIp();

    console.log(`\n========================================================`);
    console.log(`  🚀 FlowStudio 在线协作画图平台单进程服务已启动！`);
    console.log(`  💻 本机访问:   http://127.0.0.1:${port}`);
    console.log(`  🌐 局域网访问: http://${lanIp}:${port}`);
    console.log(`  🤖 AI MCP 端点: http://${lanIp}:${port}/mcp`);
    console.log(`  ⚡ 协同 WS:    ws://${lanIp}:${port}/collaboration`);
    console.log(`  📁 SQLite 数据: ${dbPath}`);
    console.log(`========================================================\n`);
  } catch (err) {
    unregisterSignals();
    await app.close().catch(() => {});
    console.error(`[FlowStudio] 启动失败:`, err);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  main();
}

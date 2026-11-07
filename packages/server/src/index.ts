import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from './server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  const dbPath = process.env.DB_PATH || path.resolve(process.cwd(), 'flowstudio.sqlite');
  const webDistPath = process.env.WEB_DIST || path.resolve(__dirname, '../../web/dist');

  console.log(`[FlowStudio] 正在启动服务端...`);
  console.log(`[FlowStudio] 数据文件路径: ${dbPath}`);

  const { app } = await buildServer({ dbPath, webDistPath });

  try {
    await app.listen({ port, host });
    console.log(`[FlowStudio] 服务已启动: http://${host}:${port}`);
    console.log(`[FlowStudio] 协同 WebSocket: ws://${host}:${port}/collaboration`);
    console.log(`[FlowStudio] 图表 API: http://${host}:${port}/api/diagrams`);
  } catch (err) {
    console.error(`[FlowStudio] 启动失败:`, err);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  main();
}

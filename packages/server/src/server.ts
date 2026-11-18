import fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import * as fs from 'node:fs';
import { initDatabase } from './db/database.js';
import { DiagramRepository } from './db/diagram-repository.js';
import { createCollaborationServer, closeCollaborationServer } from './collaboration/hocuspocus.js';
import { DocumentWriter } from './collaboration/document-writer.js';
import { AutoSnapshotScheduler } from './collaboration/auto-snapshot.js';
import { SaveStatusTracker } from './collaboration/save-status.js';
import { diagramRoutes } from './routes/diagrams.js';
import { mcpPlugin } from './mcp/mcp-server.js';
import { AiBatchManager } from './collaboration/ai-batch-manager.js';
import type { Hocuspocus } from '@hocuspocus/server';
import type * as WebSocket from 'ws';

export interface BuildServerOptions {
  dbPath?: string;
  webDistPath?: string;
  autoSnapshotIntervalMs?: number;
}

export interface ServerContext {
  app: FastifyInstance;
  repo: DiagramRepository;
  hocuspocus: Hocuspocus;
  writer: DocumentWriter;
  saveStatus: SaveStatusTracker;
  aiBatchManager: AiBatchManager;
  autoSnapshot: AutoSnapshotScheduler;
}


export async function buildServer(options: BuildServerOptions = {}): Promise<ServerContext> {
  const app = fastify({ logger: false });

  // 初始化数据库与协同服务
  const db = initDatabase(options.dbPath);
  const repo = new DiagramRepository(db);
  const saveStatus = new SaveStatusTracker(repo);
  const hocuspocus = createCollaborationServer(repo, { saveStatus });
  const writer = new DocumentWriter(repo, hocuspocus, saveStatus);
  const aiBatchManager = new AiBatchManager(repo, writer);
  const autoSnapshot = new AutoSnapshotScheduler(repo, writer, {
    intervalMs: options.autoSnapshotIntervalMs,
  });
  if (options.autoSnapshotIntervalMs) {
    autoSnapshot.start();
  }

  // 跨域支持
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // WebSocket 支持（限制单帧最大负载 16MB）
  await app.register(websocket, {
    options: {
      maxPayload: 16 * 1024 * 1024,
    },
  });

  // 注册 REST API 路由
  await app.register(diagramRoutes, {
    prefix: '/api/diagrams',
    repo,
    hocuspocus,
    aiBatchManager,
    writer,
    saveStatus,
    autoSnapshot,
  });

  // 注册 MCP 端点 (JSON-RPC 2.0 / Streamable HTTP)
  await app.register(mcpPlugin, {
    prefix: '/mcp',
    repo,
    batchManager: aiBatchManager,
    writer,
  });

  // 辅助函数：将 Fastify WebSocket 连接转发至 Hocuspocus ClientConnection
  const bindHocuspocusSocket = (socket: WebSocket.WebSocket, reqRaw: any) => {
    try {
      const clientConnection = hocuspocus.handleConnection(socket, reqRaw);

      socket.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
        if (!isBinary) {
          app.log.warn('[WebSocket] 拒绝非二进制协同消息帧');
          if (socket.readyState === socket.OPEN) {
            socket.close(1003, '仅支持二进制协同帧');
          }
          return;
        }
        try {
          let uint8: Uint8Array;
          if (data instanceof Uint8Array) {
            uint8 = data;
          } else if (Array.isArray(data)) {
            uint8 = new Uint8Array(Buffer.concat(data));
          } else {
            uint8 = new Uint8Array(data);
          }
          clientConnection.handleMessage(uint8);
        } catch (err) {
          app.log.error(err, '[WebSocket] 处理协同消息异常');
          if (socket.readyState === socket.OPEN) {
            socket.close(1011, '协同消息处理异常');
          }
        }
      });

      socket.on('close', (code: number, reason: Buffer) => {
        clientConnection.handleClose({ code, reason: reason ? reason.toString() : '' });
      });

      socket.on('error', (err: any) => {
        app.log.error(err, '[WebSocket] Client connection error');
      });

      socket.on('pong', () => {
        clientConnection.touch();
      });
    } catch (err) {
      app.log.error(err, '[WebSocket] Failed to bind Hocuspocus socket');
    }
  };



  // 注册 Hocuspocus WebSocket 协同路由
  app.get('/collaboration', { websocket: true }, (socket, req) => {
    bindHocuspocusSocket(socket, req.raw);
  });

  app.get('/collaboration/:documentName', { websocket: true }, (socket, req) => {
    bindHocuspocusSocket(socket, req.raw);
  });

  // 静态文件托管（若配置且存在）
  const hasWebDist = Boolean(options.webDistPath && fs.existsSync(options.webDistPath));
  if (hasWebDist) {
    await app.register(fastifyStatic, {
      root: options.webDistPath!,
      prefix: '/',
      setHeaders: (res, pathName) => {
        if (pathName.endsWith('.html')) {
          res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.header('Pragma', 'no-cache');
          res.header('Expires', '0');
        }
      },
    });
  }

  app.setNotFoundHandler((req, reply) => {
    const pathname = req.url.split('?')[0];
    if (
      req.method !== 'GET' ||
      pathname === '/api' ||
      pathname.startsWith('/api/') ||
      pathname === '/mcp' ||
      pathname.startsWith('/mcp/')
    ) {
      return reply.status(404).send({ error: '接口不存在' });
    }
    if (hasWebDist) {
      reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
      reply.header('Pragma', 'no-cache');
      reply.header('Expires', '0');
      return reply.sendFile('index.html');
    }
    return reply.status(404).send({ error: '接口不存在' });
  });

  // 关闭钩子
  app.addHook('onClose', async () => {
    autoSnapshot.stop();
    await closeCollaborationServer(hocuspocus);
    db.close();
  });

  return { app, repo, hocuspocus, writer, saveStatus, aiBatchManager, autoSnapshot };
}

import fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import * as fs from 'node:fs';
import { initDatabase } from './db/database.js';
import { DiagramRepository } from './db/diagram-repository.js';
import { createCollaborationServer } from './collaboration/hocuspocus.js';
import { DocumentWriter } from './collaboration/document-writer.js';
import { AutoSnapshotScheduler } from './collaboration/auto-snapshot.js';
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
  aiBatchManager: AiBatchManager;
  autoSnapshot: AutoSnapshotScheduler;
}


export async function buildServer(options: BuildServerOptions = {}): Promise<ServerContext> {
  const app = fastify({ logger: false });

  // 初始化数据库与协同服务
  const db = initDatabase(options.dbPath);
  const repo = new DiagramRepository(db);
  const hocuspocus = createCollaborationServer(repo);
  const writer = new DocumentWriter(repo, hocuspocus);
  const aiBatchManager = new AiBatchManager(repo, writer);
  const autoSnapshot = new AutoSnapshotScheduler(repo, writer, {
    intervalMs: options.autoSnapshotIntervalMs,
  });
  autoSnapshot.start();

  // 跨域支持
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // WebSocket 支持
  await app.register(websocket);

  // 注册 REST API 路由
  await app.register(diagramRoutes, {
    prefix: '/api/diagrams',
    repo,
    aiBatchManager,
    writer,
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

      socket.on('message', (data: any) => {
        let uint8: Uint8Array;
        if (data instanceof Uint8Array) {
          uint8 = data;
        } else if (Array.isArray(data)) {
          uint8 = new Uint8Array(Buffer.concat(data));
        } else {
          uint8 = new Uint8Array(data);
        }
        clientConnection.handleMessage(uint8);
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
  if (options.webDistPath && fs.existsSync(options.webDistPath)) {
    await app.register(fastifyStatic, {
      root: options.webDistPath,
      prefix: '/',
      setHeaders: (res, pathName) => {
        if (pathName.endsWith('.html')) {
          res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.header('Pragma', 'no-cache');
          res.header('Expires', '0');
        }
      },
    });

    app.setNotFoundHandler((_req, reply) => {
      reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
      reply.header('Pragma', 'no-cache');
      reply.header('Expires', '0');
      reply.sendFile('index.html');
    });
  }

  // 关闭钩子
  app.addHook('onClose', async () => {
    autoSnapshot.stop();
    if (typeof (hocuspocus as any).destroy === 'function') {
      await (hocuspocus as any).destroy();
    }
    db.close();
  });

  return { app, repo, hocuspocus, writer, aiBatchManager, autoSnapshot };
}

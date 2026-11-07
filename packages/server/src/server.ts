import fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import * as fs from 'node:fs';
import { initDatabase } from './db/database.js';
import { DiagramRepository } from './db/diagram-repository.js';
import { createCollaborationServer } from './collaboration/hocuspocus.js';
import { diagramRoutes } from './routes/diagrams.js';
import type { Hocuspocus } from '@hocuspocus/server';
import type * as WebSocket from 'ws';

export interface BuildServerOptions {
  dbPath?: string;
  webDistPath?: string;
}

export interface ServerContext {
  app: FastifyInstance;
  repo: DiagramRepository;
  hocuspocus: Hocuspocus;
}


export async function buildServer(options: BuildServerOptions = {}): Promise<ServerContext> {
  const app = fastify({ logger: false });

  // 初始化数据库与协同服务
  const db = initDatabase(options.dbPath);
  const repo = new DiagramRepository(db);
  const hocuspocus = createCollaborationServer(repo);

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
    });

    app.setNotFoundHandler((_req, reply) => {
      reply.sendFile('index.html');
    });
  }

  // 关闭钩子
  app.addHook('onClose', async () => {
    if (typeof (hocuspocus as any).destroy === 'function') {
      await (hocuspocus as any).destroy();
    }
    db.close();
  });

  return { app, repo, hocuspocus };
}

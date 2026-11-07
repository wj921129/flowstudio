import fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import * as fs from 'node:fs';
import { initDatabase } from './db/database.js';
import { DiagramRepository } from './db/diagram-repository.js';
import { createCollaborationServer } from './collaboration/hocuspocus.js';
import { diagramRoutes } from './routes/diagrams.js';
import type { Server as HocuspocusServer } from '@hocuspocus/server';

export interface BuildServerOptions {
  dbPath?: string;
  webDistPath?: string;
}

export interface ServerContext {
  app: FastifyInstance;
  repo: DiagramRepository;
  hocuspocus: HocuspocusServer;
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

  // 注册 Hocuspocus WebSocket 协同路由
  app.get('/collaboration', { websocket: true }, (socket, req) => {
    hocuspocus.handleConnection(socket, req.raw);
  });

  app.get('/collaboration/:documentName', { websocket: true }, (socket, req) => {
    const { documentName } = req.params as { documentName?: string };
    hocuspocus.handleConnection(socket, req.raw, documentName);
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
    await hocuspocus.destroy();
    db.close();
  });

  return { app, repo, hocuspocus };
}

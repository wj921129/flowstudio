import type { FastifyPluginAsync } from 'fastify';
import { createDiagramInputSchema, updateDiagramInputSchema } from '@flowstudio/shared';
import type { DiagramRepository } from '../db/diagram-repository.js';

interface DiagramRouteOptions {
  repo: DiagramRepository;
}

export const diagramRoutes: FastifyPluginAsync<DiagramRouteOptions> = async (fastify, opts) => {
  const { repo } = opts;

  // 查询列表（支持关键字搜索）
  fastify.get('/', async (request) => {
    const { q } = request.query as { q?: string };
    const diagrams = repo.listDiagrams(q);
    return { diagrams };
  });

  // 创建新图表
  fastify.post('/', async (request, reply) => {
    const parsed = createDiagramInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: '请求参数校验失败',
        details: parsed.error.issues,
      });
    }

    const created = repo.createDiagram(parsed.data);
    return reply.status(201).send(created);
  });

  // 获取单个图表元数据
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const diagram = repo.getDiagramById(id);
    if (!diagram) {
      return reply.status(404).send({ error: '图表不存在' });
    }
    return diagram;
  });

  // 更新图表元数据（重命名、修改描述、更新缩略图）
  fastify.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateDiagramInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: '请求参数校验失败',
        details: parsed.error.issues,
      });
    }

    const updated = repo.updateDiagram(id, parsed.data);
    if (!updated) {
      return reply.status(404).send({ error: '图表不存在' });
    }
    return updated;
  });

  // 复制图表
  fastify.post('/:id/duplicate', async (request, reply) => {
    const { id } = request.params as { id: string };
    const duplicated = repo.duplicateDiagram(id);
    if (!duplicated) {
      return reply.status(404).send({ error: '原图表不存在，无法复制' });
    }
    return reply.status(201).send(duplicated);
  });

  // 删除图表
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = repo.deleteDiagram(id);
    if (!deleted) {
      return reply.status(404).send({ error: '图表不存在' });
    }
    return reply.status(204).send();
  });
};

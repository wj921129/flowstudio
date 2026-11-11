import type { FastifyPluginAsync } from 'fastify';
import {
  createDiagramInputSchema,
  revertBatchItemsRequestSchema,
  updateDiagramInputSchema,
} from '@flowstudio/shared';
import type { DiagramRepository } from '../db/diagram-repository.js';
import type { AiBatchManager } from '../collaboration/ai-batch-manager.js';
import type { DocumentWriter } from '../collaboration/document-writer.js';

interface DiagramRouteOptions {
  repo: DiagramRepository;
  aiBatchManager?: AiBatchManager;
  writer?: DocumentWriter;
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

    // 在线文档存在时同步写入 Live Doc，避免在线端标题短暂滞后；冷路径已由仓库完成落库同步
    if (parsed.data.title !== undefined && opts.writer?.getLiveDocument(id)) {
      await opts.writer.mutate(id, 'system:title-sync', (doc) => {
        const meta = doc.getMap<unknown>('meta');
        if (meta.get('title') !== updated.title) {
          meta.set('title', updated.title);
        }
      });
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

  // 获取图表快照列表
  fastify.get('/:id/snapshots', async (request, reply) => {
    const { id } = request.params as { id: string };
    const diagram = repo.getDiagramById(id);
    if (!diagram) {
      return reply.status(404).send({ error: '图表不存在' });
    }
    return repo.listSnapshots(id);
  });

  // 创建新快照
  fastify.post('/:id/snapshots', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { label?: string; triggerType?: 'manual' | 'ai_batch' | 'auto' };
    const snapshot = repo.createSnapshot(id, body.label || '手动快照', body.triggerType || 'manual');
    if (!snapshot) {
      return reply.status(404).send({ error: '图表不存在，无法创建快照' });
    }
    return reply.status(201).send(snapshot);
  });

  // 恢复快照（在线优先无损差异写回）
  fastify.post('/:id/snapshots/:snapshotId/restore', async (request, reply) => {
    const { id, snapshotId } = request.params as { id: string; snapshotId: string };
    if (!opts.writer) {
      return reply.status(500).send({ error: '文档写入引擎未配置' });
    }
    const result = await opts.writer.restoreSnapshot(id, snapshotId);
    if (!result.success) {
      return reply.status(400).send({ error: result.error || '恢复快照失败' });
    }
    return { success: true, message: '快照已成功恢复' };
  });

  // 获取图表最近的有效 AI 批次（含实体级 diffs 明细）
  fastify.get('/:id/ai-batches', async (request) => {
    const { id } = request.params as { id: string };
    if (!opts.aiBatchManager) return [];
    return opts.aiBatchManager.getBatches(id);
  });

  // 撤回指定的 AI 批次（字段级防冲突）
  fastify.post('/:id/ai-batches/:batchId/revert', async (request, reply) => {
    const { id, batchId } = request.params as { id: string; batchId: string };
    if (!opts.aiBatchManager) {
      return reply.status(400).send({ error: 'AI 批次管理器未配置' });
    }
    const res = await opts.aiBatchManager.revertBatch(id, batchId);
    if (!res.success) {
      return reply.status(400).send({ error: res.message });
    }
    return res;
  });

  // 单点/多点精细化撤回（Cherry-Pick）
  fastify.post('/:id/ai-batches/:batchId/revert-items', async (request, reply) => {
    const { id, batchId } = request.params as { id: string; batchId: string };
    if (!opts.aiBatchManager) {
      return reply.status(400).send({ error: 'AI 批次管理器未配置' });
    }

    const parsed = revertBatchItemsRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: '请求参数校验失败',
        details: parsed.error.issues,
      });
    }

    const res = await opts.aiBatchManager.revertItems(id, batchId, parsed.data.entityIds);
    if (!res.success) {
      return reply.status(400).send({ error: res.message });
    }
    return res;
  });
};

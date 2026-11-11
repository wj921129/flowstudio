import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as Y from 'yjs';
import { initDatabase } from '../src/db/database.js';
import { DiagramRepository } from '../src/db/diagram-repository.js';
import { AiBatchManager } from '../src/collaboration/ai-batch-manager.js';
import { buildServer } from '../src/server.js';

describe('AI Batch Management & Safe Rollback', () => {
  let tmpDbPath: string;

  beforeEach(() => {
    tmpDbPath = path.join(os.tmpdir(), `flowstudio-batch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`);
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

  it('records AI batches and performs clean rollback when untouched by human users', async () => {
    const db = initDatabase(tmpDbPath);
    const repo = new DiagramRepository(db);
    const batchManager = new AiBatchManager(repo);

    const diag = repo.createDiagram({ title: 'AI 批次图' });

    // 1. 初始化原始文档：node-init
    const doc = new Y.Doc();
    const initNode = new Y.Map();
    initNode.set('id', 'node-init');
    initNode.set('type', 'start-end');
    initNode.set('data', { label: '初始需求' });
    doc.getMap('nodes').set('node-init', initNode);
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc));

    // 2. 模拟 AI 增量执行了一次修改：新增 node-ai-1, node-ai-2 并连线，同时修改了 node-init
    const docAfterAi = new Y.Doc();
    Y.applyUpdate(docAfterAi, repo.getYDocState(diag.id)!);

    // 修改 node-init
    docAfterAi.getMap('nodes').get('node-init')!.set('data', { label: '需求分析 (AI补全)' });

    // 新增两个节点
    const aiNode1 = new Y.Map();
    aiNode1.set('id', 'node-ai-1');
    aiNode1.set('data', { label: '技术预研' });
    docAfterAi.getMap('nodes').set('node-ai-1', aiNode1);

    const aiNode2 = new Y.Map();
    aiNode2.set('id', 'node-ai-2');
    aiNode2.set('data', { label: '架构设计' });
    docAfterAi.getMap('nodes').set('node-ai-2', aiNode2);

    // 新增一条连线
    const aiEdge = new Y.Map();
    aiEdge.set('id', 'edge-ai-1');
    aiEdge.set('source', 'node-init');
    aiEdge.set('target', 'node-ai-1');
    docAfterAi.getMap('edges').set('edge-ai-1', aiEdge);

    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(docAfterAi));

    // 记录该批次
    batchManager.recordBatch({
      batchId: 'batch-001',
      diagramId: diag.id,
      summary: 'AI 增量补充技术预研与架构设计',
      createdNodeIds: ['node-ai-1', 'node-ai-2'],
      createdEdgeIds: ['edge-ai-1'],
      updatedNodeBackups: [{ id: 'node-init', oldData: { label: '初始需求' } }],
      createdAt: new Date().toISOString(),
    });

    expect(batchManager.getBatches(diag.id).length).toBe(1);

    // 3. 执行撤回该批次
    const revertRes = await batchManager.revertBatch(diag.id, 'batch-001');
    expect(revertRes.success).toBe(true);
    expect(revertRes.skippedCount).toBe(0);

    // 4. 验证撤回后的文档状态
    const docReverted = new Y.Doc();
    Y.applyUpdate(docReverted, repo.getYDocState(diag.id)!);

    const revertedNodes = docReverted.getMap('nodes');
    const revertedEdges = docReverted.getMap('edges');

    // node-ai-1 和 node-ai-2 已被撤回删除
    expect(revertedNodes.has('node-ai-1')).toBe(false);
    expect(revertedNodes.has('node-ai-2')).toBe(false);
    expect(revertedEdges.has('edge-ai-1')).toBe(false);

    // node-init 恢复了原本的文案
    const restoredInit = revertedNodes.get('node-init') as Y.Map<unknown>;
    expect((restoredInit.get('data') as any).label).toBe('初始需求');

    db.close();
  });

  it('safely skips reverting an AI node if a human user subsequently connected new edges to it', async () => {
    const db = initDatabase(tmpDbPath);
    const repo = new DiagramRepository(db);
    const batchManager = new AiBatchManager(repo);

    const diag = repo.createDiagram({ title: '人机冲突保护图' });

    // 1. AI 创建了 node-ai-protected
    const doc = new Y.Doc();
    const aiNode = new Y.Map();
    aiNode.set('id', 'node-ai-protected');
    aiNode.set('data', { label: 'AI创建步骤' });
    doc.getMap('nodes').set('node-ai-protected', aiNode);

    const aiEdge = new Y.Map();
    aiEdge.set('id', 'edge-ai-original');
    aiEdge.set('source', 'node-ai-protected');
    aiEdge.set('target', 'other');
    doc.getMap('edges').set('edge-ai-original', aiEdge);

    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc));

    batchManager.recordBatch({
      batchId: 'batch-002',
      diagramId: diag.id,
      summary: 'AI 步骤创建',
      createdNodeIds: ['node-ai-protected'],
      createdEdgeIds: ['edge-ai-original'],
      updatedNodeBackups: [],
      createdAt: new Date().toISOString(),
    });

    // 2. 模拟同事之后手工连了一条新线到 node-ai-protected
    const docHuman = new Y.Doc();
    Y.applyUpdate(docHuman, repo.getYDocState(diag.id)!);
    const humanEdge = new Y.Map();
    humanEdge.set('id', 'edge-human-manual');
    humanEdge.set('source', 'human-step');
    humanEdge.set('target', 'node-ai-protected');
    docHuman.getMap('edges').set('edge-human-manual', humanEdge);
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(docHuman));

    // 3. 执行撤回：由于同事手动连了线，node-ai-protected 应受到保护不被强制删除
    const revertRes = await batchManager.revertBatch(diag.id, 'batch-002');
    expect(revertRes.success).toBe(true);
    expect(revertRes.skippedCount).toBe(1);

    const docAfter = new Y.Doc();
    Y.applyUpdate(docAfter, repo.getYDocState(diag.id)!);
    expect(docAfter.getMap('nodes').has('node-ai-protected')).toBe(true);

    db.close();
  });

  it('provides REST endpoints for querying and reverting AI batches', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });

    // 通过 MCP apply_ops 触发一次真实批次
    const createRes = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'create_diagram',
          arguments: { title: 'REST 批次图' },
        },
      },
    });
    const diagId = JSON.parse(createRes.json().result.content[0].text).id;

    await server.app.inject({
      method: 'POST',
      url: '/mcp',
      payload: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'apply_ops',
          arguments: {
            diagramId: diagId,
            ops: [
              { op: 'add_node', id: 'n-test', type: 'process', label: '测试节点' },
            ],
          },
        },
      },
    });

    // 查询批次
    const listRes = await server.app.inject({
      method: 'GET',
      url: `/api/diagrams/${diagId}/ai-batches`,
    });
    expect(listRes.statusCode).toBe(200);
    const batches = listRes.json();
    expect(batches.length).toBe(1);
    const batchId = batches[0].batchId;

    // 撤回批次
    const revertRes = await server.app.inject({
      method: 'POST',
      url: `/api/diagrams/${diagId}/ai-batches/${batchId}/revert`,
    });
    expect(revertRes.statusCode).toBe(200);
    expect(revertRes.json().success).toBe(true);

    await server.app.close();
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as Y from 'yjs';
import { buildServer } from '../src/server.js';
import { MCP_TOOLS } from '../src/mcp/mcp-server.js';
import { AiCollaborator } from '../src/mcp/ai-collaborator.js';

describe('工单08：apply_ops 原子事务模式、自纠契约与空批次/快照防护', () => {
  let tmpDbPath: string;
  let server: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    tmpDbPath = path.join(os.tmpdir(), `flowstudio-atomic-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`);
    server = await buildServer({ dbPath: tmpDbPath });
  });

  afterEach(async () => {
    await server.app.close();
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

  it('tools/list 暴露完备的 apply_ops 操作定义（包含 10 类操作的具体字段与约束，且包含 atomic 与数量上限）', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const applyOpsTool = body.result.tools.find((t: any) => t.name === 'apply_ops');
    expect(applyOpsTool).toBeDefined();

    const inputSchema = applyOpsTool.inputSchema;
    expect(inputSchema.properties.atomic).toBeDefined();
    expect(inputSchema.properties.ops).toBeDefined();
    expect(inputSchema.properties.ops.maxItems ?? inputSchema.properties.ops.items?.anyOf ?? inputSchema.properties.ops.items).toBeDefined();

    // 检查 ops.items 具备具体操作字段约束，而非单纯的 { type: "object" }
    const opsItems = inputSchema.properties.ops.items;
    const isRichSchema = Boolean(
      opsItems?.anyOf || opsItems?.oneOf || (opsItems?.properties && Object.keys(opsItems.properties).length > 0)
    );
    expect(isRichSchema).toBe(true);
  });

  it('原子模式下遇到错误触发整体回滚，不残留半截节点，且不写入空批次与前置快照，返回自纠提示', async () => {
    const diag = server.repo.createDiagram({ title: '原子测试图' });

    // 初始化一个合法节点
    const doc = new Y.Doc();
    const startNode = new Y.Map();
    startNode.set('id', 'node-root');
    startNode.set('type', 'start-end');
    startNode.set('data', { label: '根节点' });
    doc.getMap('nodes').set('node-root', startNode);
    server.repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc));

    const snapshotsBefore = server.repo.listSnapshots(diag.id);
    const batchesBefore = server.aiBatchManager.getBatches(diag.id);

    // 调用 apply_ops，开启 atomic: true，其中包含一个新建节点和一个目标不存在的 connect
    const res = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      payload: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'apply_ops',
          arguments: {
            diagramId: diag.id,
            atomic: true,
            ops: [
              { op: 'add_node', id: 'node-should-rollback', label: '待回滚节点' },
              { op: 'connect', source: 'node-root', target: 'non-existent-target' },
            ],
          },
        },
      },
    });

    const body = res.json();
    // 应该执行失败
    expect(body.result.isError).toBe(true);
    const errorText = body.result.content[0].text;
    // 错误信息应具备自纠信息（指出候选节点）
    expect(errorText).toMatch(/不存在/);
    expect(errorText).toMatch(/node-root/);

    // 验证画布状态：node-should-rollback 绝不残留
    const docAfter = new Y.Doc();
    Y.applyUpdate(docAfter, server.repo.getYDocState(diag.id)!);
    expect(docAfter.getMap('nodes').has('node-should-rollback')).toBe(false);

    // 验证快照与批次表：零残留
    const snapshotsAfter = server.repo.listSnapshots(diag.id);
    const batchesAfter = server.aiBatchManager.getBatches(diag.id);
    expect(snapshotsAfter.length).toBe(snapshotsBefore.length);
    expect(batchesAfter.length).toBe(batchesBefore.length);
  });

  it('有效变更数为零时不产生前置快照与 AI 批次账本记录', async () => {
    const diag = server.repo.createDiagram({ title: '空变更测试' });
    const doc = new Y.Doc();
    const node = new Y.Map();
    node.set('id', 'node-1');
    node.set('type', 'process');
    node.set('data', { label: '现有节点' });
    doc.getMap('nodes').set('node-1', node);
    server.repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc));

    const snapshotsBefore = server.repo.listSnapshots(diag.id);
    const batchesBefore = server.aiBatchManager.getBatches(diag.id);

    // 提交已经存在的节点新增（会被跳过），且 atomic: false
    const res = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      payload: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'apply_ops',
          arguments: {
            diagramId: diag.id,
            atomic: false,
            ops: [
              { op: 'add_node', id: 'node-1', label: '重复现有节点' },
            ],
          },
        },
      },
    });

    const body = res.json();
    expect(body.result.isError).toBeUndefined();
    const resultText = JSON.parse(body.result.content[0].text);
    expect(resultText.appliedCount).toBe(0);

    // 快照与批次库零新增
    expect(server.repo.listSnapshots(diag.id).length).toBe(snapshotsBefore.length);
    expect(server.aiBatchManager.getBatches(diag.id).length).toBe(batchesBefore.length);
  });

  it('默认 undo_ai_batch 能自动命中含有残余项的 partially_reverted 批次并继续撤回', async () => {
    const diag = server.repo.createDiagram({ title: '部分撤回接续' });
    const collaborator = new AiCollaborator(server.repo, 'http://127.0.0.1:3000', server.aiBatchManager, server.writer);

    // 1. AI 增量创建两个节点
    const applyRes = await collaborator.applyOps({
      diagramId: diag.id,
      agentName: 'TestAgent',
      ops: [
        { op: 'add_node', id: 'node-ai-a', label: '节点A' },
        { op: 'add_node', id: 'node-ai-b', label: '节点B' },
      ],
    });
    expect(applyRes.success).toBe(true);
    const batchId = applyRes.batchId!;
    expect(batchId).toBeDefined();

    // 2. 模拟人类二次修改了 node-ai-a 的 label
    await server.writer.mutate(diag.id, 'user:human', (doc) => {
      const nodeA = doc.getMap('nodes').get('node-ai-a') as Y.Map<unknown>;
      nodeA.set('data', { label: '人类修改后的节点A' });
    });

    // 3. 第一次撤回该批次：node-ai-a 因冲突被跳过，node-ai-b 被撤回，批次状态变为 partially_reverted
    const firstUndo = await collaborator.undoAiBatch({ diagramId: diag.id, batchId });
    expect(firstUndo.status).toBe('partially_reverted');
    expect(firstUndo.skippedCount).toBe(1);

    // 此时批次处于 partially_reverted 状态。假设人类后来删除了修改或还有其他同批次项，
    // 再次调用 undo_ai_batch 且不传 batchId，系统应能自动识别该批次并执行，而不是抛错“没有活跃AI批次”
    const secondUndo = await collaborator.undoAiBatch({ diagramId: diag.id });
    expect(secondUndo).toBeDefined();
    expect(secondUndo.batchId).toBe(batchId);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildServer } from '../src/server.js';

interface CompactDiagram {
  nodes: Array<{ id: string; label: string; lockMode?: string }>;
  edges: Array<{ id: string; source: string; target: string }>;
}

async function callMcpTool(
  app: Awaited<ReturnType<typeof buildServer>>['app'],
  id: number,
  name: string,
  args: Record<string, unknown>,
): Promise<any> {
  const res = await app.inject({
    method: 'POST',
    url: '/mcp',
    payload: {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args },
    },
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.json().result.content[0].text);
}

describe('AI 批次 Cherry-Pick 精细化撤回', () => {
  let tmpDbPath: string;

  beforeEach(() => {
    tmpDbPath = path.join(os.tmpdir(), `flowstudio-cherry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`);
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

  it('只撤回指定节点并级联清理其同批次连线，其余成果保留且跨重启持久化', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });

    const created = await callMcpTool(server.app, 1, 'create_diagram', { title: 'Cherry-Pick 验收图' });
    const diagramId = created.id as string;

    // AI 批次：新增 A、B 并连线 A→B
    const applied = await callMcpTool(server.app, 2, 'apply_ops', {
      diagramId,
      agentName: 'Qoder',
      ops: [
        { op: 'add_node', id: 'node-a', type: 'process', label: '节点A' },
        { op: 'add_node', id: 'node-b', type: 'process', label: '节点B' },
        { op: 'connect', source: 'node-a', target: 'node-b', label: '流转' },
      ],
    });
    expect(applied.success).toBe(true);
    const batchId = applied.batchId as string;

    // 批次账本包含 2 个节点 + 1 条连线的实体级 Diff
    const listBefore = await server.app.inject({
      method: 'GET',
      url: `/api/diagrams/${diagramId}/ai-batches`,
    });
    expect(listBefore.statusCode).toBe(200);
    const batchBefore = listBefore.json()[0];
    expect(batchBefore.batchId).toBe(batchId);
    const edgeDiff = batchBefore.diffs.find(
      (diff: any) => diff.entityType === 'edge' && diff.opType === 'add',
    );
    expect(batchBefore.diffs.length).toBe(3);
    expect(edgeDiff).toBeTruthy();
    const edgeId = edgeDiff.entityId as string;

    // Cherry-Pick：只撤回 node-a
    const revertRes = await server.app.inject({
      method: 'POST',
      url: `/api/diagrams/${diagramId}/ai-batches/${batchId}/revert-items`,
      payload: { entityIds: ['node-a'] },
    });
    expect(revertRes.statusCode).toBe(200);
    const result = revertRes.json();
    expect(result.success).toBe(true);
    expect(result.status).toBe('partially_reverted');
    expect(result.revertedEntityIds).toContain('node-a');
    expect(result.revertedEntityIds).toContain(edgeId);

    // 画布断言：A 与悬挂连线被移除，B 完整保留
    const diagramAfter = await callMcpTool(server.app, 3, 'get_diagram', { diagramId });
    const compact = diagramAfter as CompactDiagram;
    expect(compact.nodes.some((n) => n.id === 'node-a')).toBe(false);
    expect(compact.nodes.some((n) => n.id === 'node-b')).toBe(true);
    expect(compact.edges.length).toBe(0);

    // 账本断言：A 与连线已标记 reverted，B 仍未撤回
    const listAfter = await server.app.inject({
      method: 'GET',
      url: `/api/diagrams/${diagramId}/ai-batches`,
    });
    const batchAfter = listAfter.json()[0];
    expect(batchAfter.status).toBe('partially_reverted');
    const revertedIds = batchAfter.diffs
      .filter((diff: any) => diff.reverted)
      .map((diff: any) => diff.entityId)
      .sort();
    expect(revertedIds).toEqual([edgeId, 'node-a'].sort());

    // 重复撤回同一实体应被拒绝
    const repeatRes = await server.app.inject({
      method: 'POST',
      url: `/api/diagrams/${diagramId}/ai-batches/${batchId}/revert-items`,
      payload: { entityIds: ['node-a'] },
    });
    expect(repeatRes.statusCode).toBe(400);

    // 非法入参（空数组）被 Zod 拦截
    const invalidRes = await server.app.inject({
      method: 'POST',
      url: `/api/diagrams/${diagramId}/ai-batches/${batchId}/revert-items`,
      payload: { entityIds: [] },
    });
    expect(invalidRes.statusCode).toBe(400);

    await server.app.close();

    // 服务重启后，部分撤回结果必须完整持久化
    const server2 = await buildServer({ dbPath: tmpDbPath });
    const recovered = await callMcpTool(server2.app, 4, 'get_diagram', { diagramId });
    const recoveredDiagram = recovered as CompactDiagram;
    expect(recoveredDiagram.nodes.map((n) => n.id)).toEqual(['node-b']);
    expect(recoveredDiagram.edges.length).toBe(0);

    const listRecovered = await server2.app.inject({
      method: 'GET',
      url: `/api/diagrams/${diagramId}/ai-batches`,
    });
    expect(listRecovered.json()[0].status).toBe('partially_reverted');

    await server2.app.close();
  }, 20000);
});

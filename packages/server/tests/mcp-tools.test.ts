import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildServer } from '../src/server.js';

describe('Server MCP Endpoint & 7 AI Collaborative Tools', () => {
  let tmpDbPath: string;

  beforeEach(() => {
    tmpDbPath = path.join(os.tmpdir(), `flowstudio-mcp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`);
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

  it('handles MCP initialize handshake and lists 7 tools', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });

    // 1. 初始化握手
    const initRes = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      },
    });
    expect(initRes.statusCode).toBe(200);
    const initData = initRes.json();
    expect(initData.result.serverInfo.name).toBe('flowstudio-mcp-server');

    // 2. 工具列表查询
    const listRes = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      payload: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      },
    });
    expect(listRes.statusCode).toBe(200);
    const tools = listRes.json().result.tools;
    expect(tools.length).toBe(14);

    const toolNames = tools.map((t: any) => t.name);
    expect(toolNames).toContain('list_diagrams');
    expect(toolNames).toContain('create_diagram');
    expect(toolNames).toContain('get_diagram');
    expect(toolNames).toContain('get_selection');
    expect(toolNames).toContain('scaffold_diagram');
    expect(toolNames).toContain('apply_ops');
    expect(toolNames).toContain('auto_layout');
    expect(toolNames).toContain('list_templates');
    expect(toolNames).toContain('undo_ai_batch');
    expect(toolNames).toContain('list_snapshots');
    expect(toolNames).toContain('restore_snapshot');
    expect(toolNames).toContain('search_nodes');
    expect(toolNames).toContain('rename_diagram');
    expect(toolNames).toContain('delete_diagram');

    await server.app.close();
  });

  it('returns 202 with empty body for notifications/initialized', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const res = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      payload: { jsonrpc: '2.0', method: 'notifications/initialized' },
    });
    expect(res.statusCode).toBe(202);
    expect(res.body).toBe('');
    await server.app.close();
  });

  it('answers ping with matching id and empty result', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const res = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      payload: { jsonrpc: '2.0', id: 7, method: 'ping' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ jsonrpc: '2.0', id: 7, result: {} });
    await server.app.close();
  });

  it('runs complete AI collaboration workflow: create -> scaffold -> get -> apply_ops -> auto_snapshot', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });

    // 1. 创建图表
    const createRes = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      payload: {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'create_diagram',
          arguments: { title: 'AI 协同采购图' },
        },
      },
    });
    expect(createRes.statusCode).toBe(200);
    const created = JSON.parse(createRes.json().result.content[0].text);
    expect(created.id).toBeDefined();
    const diagramId = created.id;

    // 2. 生成泳道骨架 scaffold_diagram
    const scaffoldRes = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      payload: {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'scaffold_diagram',
          arguments: {
            diagramId,
            title: '供应链采购协同流程',
            spec: {
              paradigm: 'swimlane',
              lanes: [
                { id: 'lane-dept', label: '业务部门' },
                { id: 'lane-finance', label: '财务中心' },
              ],
              nodes: [
                { id: 'n-submit', type: 'start-end', label: '提交采购单', laneId: 'lane-dept' },
                { id: 'n-approve', type: 'decision', label: '财务预算审批', laneId: 'lane-finance' },
                { id: 'n-pay', type: 'process', label: '银行出纳打款', laneId: 'lane-finance' },
              ],
              edges: [
                { from: 'n-submit', to: 'n-approve', label: '提审' },
                { from: 'n-approve', to: 'n-pay', label: '通过' },
              ],
            },
          },
        },
      },
    });
    expect(scaffoldRes.statusCode).toBe(200);
    const scaffoldResult = JSON.parse(scaffoldRes.json().result.content[0].text);
    expect(scaffoldResult.success).toBe(true);

    // 3. 读取图表 get_diagram
    const getRes = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      payload: {
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
          name: 'get_diagram',
          arguments: { diagramId },
        },
      },
    });
    expect(getRes.statusCode).toBe(200);
    const diagram = JSON.parse(getRes.json().result.content[0].text);
    expect(diagram.title).toBe('供应链采购协同流程');
    expect(diagram.lanes.length).toBe(2);
    expect(diagram.nodes.length).toBe(3);
    expect(diagram.edges.length).toBe(2);

    // 4. 增量操作 apply_ops
    const opsRes = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      payload: {
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/call',
        params: {
          name: 'apply_ops',
          arguments: {
            diagramId,
            ops: [
              // 更新审批节点文案
              { op: 'update_node', id: 'n-approve', label: '风控与财务会签审批' },
              // 新增归档节点
              { op: 'add_node', id: 'n-archive', type: 'database', label: '凭证归档', laneId: 'lane-finance' },
              // 建立连线
              { op: 'connect', source: 'n-pay', target: 'n-archive', label: '记账完成' },
            ],
          },
        },
      },
    });
    expect(opsRes.statusCode).toBe(200);
    const opsResult = JSON.parse(opsRes.json().result.content[0].text);
    expect(opsResult.success).toBe(true);
    expect(opsResult.appliedCount).toBe(3);

    // 5. 再次验证读取
    const getUpdatedRes = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      payload: {
        jsonrpc: '2.0',
        id: 14,
        method: 'tools/call',
        params: {
          name: 'get_diagram',
          arguments: { diagramId },
        },
      },
    });
    const updatedDiag = JSON.parse(getUpdatedRes.json().result.content[0].text);
    expect(updatedDiag.nodes.length).toBe(4);
    expect(updatedDiag.edges.length).toBe(3);

    // 6. 验证前置自动快照
    const snapListRes = await server.app.inject({
      method: 'GET',
      url: `/api/diagrams/${diagramId}/snapshots`,
    });
    const snapshots = snapListRes.json();
    // 至少包含了 scaffold 和 apply_ops 两次 AI 批次前自动快照
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    expect(snapshots.some((s: any) => s.triggerType === 'ai_batch')).toBe(true);

    await server.app.close();
  });

  it('supports search_nodes, rename_diagram, undo_ai_batch, list_snapshots, restore_snapshot, delete_diagram', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const callTool = async (id: number, name: string, args: Record<string, unknown>) => {
      const res = await server.app.inject({
        method: 'POST',
        url: '/mcp',
        payload: { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.result.isError).toBeUndefined();
      return JSON.parse(body.result.content[0].text);
    };

    const created = await callTool(1, 'create_diagram', { title: '初始名称' });
    const diagramId = created.id;

    const renamed = await callTool(2, 'rename_diagram', { diagramId, title: '支付核心链路' });
    expect(renamed.title).toBe('支付核心链路');

    const ops1 = await callTool(3, 'apply_ops', {
      diagramId,
      ops: [
        { op: 'add_node', id: 'n1', type: 'start-end', label: '发起支付' },
        { op: 'add_node', id: 'n2', type: 'process', label: '风控校验' },
        { op: 'connect', source: 'n1', target: 'n2', label: '提交' },
      ],
    });
    expect(ops1.appliedCount).toBe(3);

    const searchRes = await callTool(4, 'search_nodes', { diagramId, query: '风控' });
    expect(searchRes.totalMatched).toBe(1);
    expect(searchRes.nodes[0].id).toBe('n2');
    expect(searchRes.relatedEdges.length).toBe(1);

    const undoRes = await callTool(5, 'undo_ai_batch', { diagramId });
    expect(undoRes.success).toBe(true);

    const afterUndo = await callTool(6, 'get_diagram', { diagramId });
    expect(afterUndo.nodes.length).toBe(0);

    const snaps = await callTool(7, 'list_snapshots', { diagramId });
    expect(snaps.length).toBeGreaterThanOrEqual(1);

    await callTool(8, 'apply_ops', {
      diagramId,
      ops: [{ op: 'add_node', id: 'n3', type: 'process', label: '恢复前节点' }],
    });

    const restored = await callTool(9, 'restore_snapshot', { diagramId, snapshotId: snaps[0].id });
    expect(restored.success).toBe(true);
    const afterRestore = await callTool(10, 'get_diagram', { diagramId });
    expect(afterRestore.nodes.length).toBe(0);

    const deleted = await callTool(11, 'delete_diagram', { diagramId });
    expect(deleted.success).toBe(true);
    const all = await callTool(12, 'list_diagrams', {});
    expect(all.some((d: any) => d.id === diagramId)).toBe(false);

    await server.app.close();
  });

  it('emits semantic soft warnings for isolated nodes, unlabeled decision branches, and unlaned nodes', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const callTool = async (id: number, name: string, args: Record<string, unknown>) => {
      const res = await server.app.inject({
        method: 'POST',
        url: '/mcp',
        payload: { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
      });
      return JSON.parse(res.json().result.content[0].text);
    };

    const created = await callTool(1, 'create_diagram', { title: '语义体检测试' });
    const diagramId = created.id;

    const opsRes = await callTool(2, 'apply_ops', {
      diagramId,
      ops: [
        { op: 'add_lane', id: 'lane-a', label: '网关' },
        { op: 'add_node', id: 'd1', type: 'decision', label: '是否有效', laneId: 'lane-a' },
        { op: 'add_node', id: 'p1', type: 'process', label: '处理请求', laneId: 'lane-a' },
        { op: 'add_node', id: 'p2', type: 'process', label: '拒绝请求', laneId: 'lane-a' },
        { op: 'add_node', id: 'orphan', type: 'process', label: '游离孤立节点' },
        { op: 'connect', source: 'd1', target: 'p1', label: '是' },
        { op: 'connect', source: 'd1', target: 'p2' },
      ],
    });

    expect(opsRes.success).toBe(true);
    expect(opsRes.warnings.some((w: string) => w.includes('孤立节点'))).toBe(true);
    expect(opsRes.warnings.some((w: string) => w.includes('缺少条件标签'))).toBe(true);
    expect(opsRes.warnings.some((w: string) => w.includes('未归属泳道'))).toBe(true);

    await server.app.close();
  });
});

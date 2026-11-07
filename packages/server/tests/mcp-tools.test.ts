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
    expect(tools.length).toBe(7);

    const toolNames = tools.map((t: any) => t.name);
    expect(toolNames).toContain('list_diagrams');
    expect(toolNames).toContain('create_diagram');
    expect(toolNames).toContain('get_diagram');
    expect(toolNames).toContain('get_selection');
    expect(toolNames).toContain('scaffold_diagram');
    expect(toolNames).toContain('apply_ops');
    expect(toolNames).toContain('auto_layout');

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
              { source: 'n-submit', target: 'n-approve', label: '提审' },
              { source: 'n-approve', target: 'n-pay', label: '通过' },
            ],
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
});

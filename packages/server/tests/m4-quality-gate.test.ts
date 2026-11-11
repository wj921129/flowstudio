import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { buildServer } from '../src/server.js';

async function waitUntil(predicate: () => boolean, timeout = 3000, interval = 25): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return predicate();
}

describe('M4 Quality Gate: End-to-End Human-AI Co-Governance Verification', () => {
  let tmpDbPath: string;

  beforeEach(() => {
    tmpDbPath = path.join(os.tmpdir(), `flowstudio-m4-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`);
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

  it('proves the golden rule: Scaffold -> Human edits -> AI increments -> Revert AI batch without wiping human changes', async () => {
    // 1. 启动完整的 FlowStudio 单进程服务
    const server = await buildServer({ dbPath: tmpDbPath });
    await server.app.listen({ port: 0, host: '127.0.0.1' });
    const addr = server.app.server.address() as { port: number };
    const wsUrl = `ws://127.0.0.1:${addr.port}/collaboration`;

    // 2. Agent 通过 MCP create_diagram 创建图表
    const createRes = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'create_diagram',
          arguments: { title: '人机共治理程碑验收图' },
        },
      },
    });
    expect(createRes.statusCode).toBe(200);
    const diagId = JSON.parse(createRes.json().result.content[0].text).id;

    // 3. Agent 调用 scaffold_diagram 生成骨架
    const scaffoldRes = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      payload: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'scaffold_diagram',
          arguments: {
            diagramId: diagId,
            title: '风控信审全流程',
            lanes: [
              { id: 'lane-user', label: '申请人' },
              { id: 'lane-risk', label: '风控系统' },
            ],
            nodes: [
              { id: 'step-apply', type: 'start-end', label: '用户提交申请', laneId: 'lane-user' },
              { id: 'step-score', type: 'process', label: '自动化模型评分', laneId: 'lane-risk' },
            ],
            edges: [
              { source: 'step-apply', target: 'step-score', label: '推送数据' },
            ],
          },
        },
      },
    });
    expect(scaffoldRes.statusCode).toBe(200);

    // 4. 同事在浏览器中打开该图（真实的 WebSocket 协同客户端连接）
    const humanDoc = new Y.Doc();
    const humanProvider = new HocuspocusProvider({
      url: wsUrl,
      name: diagId,
      document: humanDoc,
      WebSocketPolyfill: WebSocket as any,
    });

    await new Promise<void>((resolve) => {
      if (humanProvider.isSynced) resolve();
      else humanProvider.on('synced', () => resolve());
    });

    // 验证客户端已同步到 AI 生成的骨架
    expect(humanDoc.getMap('nodes').has('step-apply')).toBe(true);
    expect(humanDoc.getMap('nodes').has('step-score')).toBe(true);

    // 5. 同事手工进行重大修改：
    // - 将 step-apply 的 label 改为专属业务文案
    // - 手工新建一个自己的步骤节点 step-human-manual，并手工连线到 step-score
    humanDoc.transact(() => {
      const applyNode = humanDoc.getMap('nodes').get('step-apply') as Y.Map<unknown>;
      const applyData = (applyNode.get('data') as Record<string, unknown>) || {};
      applyNode.set('data', { ...applyData, label: '【同事手工修改】实名并提交申请' });

      const humanNode = new Y.Map();
      humanNode.set('id', 'step-human-manual');
      humanNode.set('type', 'comment');
      humanNode.set('data', { label: '【人工复核备注】需核实征信' });
      humanDoc.getMap('nodes').set('step-human-manual', humanNode);

      const humanEdge = new Y.Map();
      humanEdge.set('id', 'edge-human-manual');
      humanEdge.set('source', 'step-human-manual');
      humanEdge.set('target', 'step-score');
      humanDoc.getMap('edges').set('edge-human-manual', humanEdge);
    }, 'colleague-local-id');

    // 等待落盘收敛
    await new Promise((r) => setTimeout(r, 600));

    // 6. Agent 随后再次介入，调用 apply_ops 增量补充步骤
    const applyOpsRes = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      payload: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'apply_ops',
          arguments: {
            diagramId: diagId,
            ops: [
              { op: 'add_node', id: 'step-ai-anti-fraud', type: 'decision', label: 'AI反欺诈检测', laneId: 'lane-risk' },
              { op: 'connect', source: 'step-score', target: 'step-ai-anti-fraud', label: '触发复测' },
            ],
          },
        },
      },
    });
    expect(applyOpsRes.statusCode).toBe(200);
    const applyOpsJson = JSON.parse(applyOpsRes.json().result.content[0].text);
    expect(applyOpsJson.success).toBe(true);
    expect(applyOpsJson.live).toBe(true);
    const aiBatchId = applyOpsJson.batchId;

    // 在线断言（AC1）：无需刷新、无需重连，人类客户端应实时收到 AI 增量变更
    const liveAiNodeVisible = await waitUntil(() =>
      humanDoc.getMap('nodes').has('step-ai-anti-fraud'),
    );
    expect(liveAiNodeVisible).toBe(true);

    // 7. 模拟用户对 AI 本次增量修改不满意，点击“撤回此次 AI 修改”
    const revertRes = await server.app.inject({
      method: 'POST',
      url: `/api/diagrams/${diagId}/ai-batches/${aiBatchId}/revert`,
    });
    expect(revertRes.statusCode).toBe(200);
    expect(revertRes.json().success).toBe(true);

    // 在线断言（AC3）：撤回同样通过 Live Doc 实时广播到在线客户端
    const liveAiNodeRemoved = await waitUntil(() =>
      !humanDoc.getMap('nodes').has('step-ai-anti-fraud'),
    );
    expect(liveAiNodeRemoved).toBe(true);

    // 等待协同消息广播并同步至客户端
    await new Promise((r) => setTimeout(r, 300));

    // 8. 终极断言：
    // - AI 增量添加的 step-ai-anti-fraud 已被完全移除
    expect(humanDoc.getMap('nodes').has('step-ai-anti-fraud')).toBe(false);

    // - 同事手工修改的 step-apply 专属文案绝对没有被冲掉！
    const currentApplyNode = humanDoc.getMap('nodes').get('step-apply') as Y.Map<unknown>;
    expect((currentApplyNode.get('data') as any).label).toBe('【同事手工修改】实名并提交申请');

    // - 同事手工添加的 step-human-manual 和连线 100% 完整保留！
    expect(humanDoc.getMap('nodes').has('step-human-manual')).toBe(true);
    expect(humanDoc.getMap('edges').has('edge-human-manual')).toBe(true);

    humanProvider.destroy();
    await server.app.close();
  }, 20000);
});

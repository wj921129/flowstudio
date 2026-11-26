import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as Y from 'yjs';
import { buildServer } from '../src/server.js';
import { AiCollaborator } from '../src/mcp/ai-collaborator.js';

describe('工单10：服务端 AI 实时在线感知广播与状态清理', () => {
  let tmpDbPath: string;
  let server: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    tmpDbPath = path.join(os.tmpdir(), `flowstudio-awareness-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`);
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

  it('applyOps 执行期间向在线 awareness 广播 isAi: true 与规划状态，并在完成后清理复位', async () => {
    const diag = server.repo.createDiagram({ title: '在线感知广播测试' });
    const collaborator = new AiCollaborator(server.repo, 'http://127.0.0.1:3000', server.aiBatchManager, server.writer);

    // 建立一个服务端直连（模拟房间处于活跃在线状态）
    const direct = await server.hocuspocus!.openDirectConnection(diag.id);
    const liveDoc = direct.document as unknown as Y.Doc & { awareness: any };

    const recordedAwarenessStates: any[] = [];
    liveDoc.awareness.on('update', () => {
      const states = Array.from(liveDoc.awareness.getStates().values());
      recordedAwarenessStates.push(structuredClone(states));
    });

    // 执行 apply_ops
    const result = await collaborator.applyOps({
      diagramId: diag.id,
      agentName: 'Copilot-Bot',
      ops: [
        { op: 'add_node', id: 'node-ai-target', label: 'AI创建的目标节点' },
      ],
    });

    expect(result.success).toBe(true);

    // 验证在执行期间捕获到了 isAi: true 的 awareness 广播
    const aiBroadcast = recordedAwarenessStates.find((batch) =>
      batch.some((s: any) => s?.user?.isAi === true && s?.user?.agentName === 'Copilot-Bot'),
    );
    expect(aiBroadcast).toBeDefined();
    const aiUser = aiBroadcast.find((s: any) => s?.user?.isAi === true).user;
    expect(aiUser.isAi).toBe(true);
    expect(aiUser.color).toBe('#8b5cf6');
    expect(aiUser.aiPlanning?.isPlanning).toBe(true);
    expect(aiUser.selectedNodeIds).toContain('node-ai-target');

    // 验证操作结束后 awareness 已经清理复位（不留永久在线的 AI 状态）
    const finalStates = Array.from(liveDoc.awareness.getStates().values()) as any[];
    const activeAi = finalStates.find((s: any) => s?.user?.isAi === true && s?.user?.aiPlanning?.isPlanning);
    expect(activeAi).toBeUndefined();

    await direct.disconnect();
  });

  it('applyOps 抛出异常退出时，在 finally 块中确定性清除 AI awareness 状态', async () => {
    const diag = server.repo.createDiagram({ title: '异常时感知清理测试' });
    const collaborator = new AiCollaborator(server.repo, 'http://127.0.0.1:3000', server.aiBatchManager, server.writer);

    const direct = await server.hocuspocus!.openDirectConnection(diag.id);
    const liveDoc = direct.document as unknown as Y.Doc & { awareness: any };

    // 在 atomic: true 模式下提交必定失败的操作
    await expect(
      collaborator.applyOps({
        diagramId: diag.id,
        agentName: 'Error-Bot',
        atomic: true,
        ops: [
          { op: 'connect', source: 'missing-a', target: 'missing-b' },
        ],
      }),
    ).rejects.toThrow();

    // 验证异常退出后，AI 状态不会残留挂在 awareness 中
    const finalStates = Array.from(liveDoc.awareness.getStates().values()) as any[];
    const activeAi = finalStates.find((s: any) => s?.user?.isAi === true && s?.user?.aiPlanning?.isPlanning);
    expect(activeAi).toBeUndefined();

    await direct.disconnect();
  });

  it('scaffoldDiagram 与 autoLayout 执行期间向 awareness 广播并在完成后清理', async () => {
    const diag = server.repo.createDiagram({ title: '骨架与排版感知测试' });
    const collaborator = new AiCollaborator(server.repo, 'http://127.0.0.1:3000', server.aiBatchManager, server.writer);

    const direct = await server.hocuspocus!.openDirectConnection(diag.id);
    const liveDoc = direct.document as unknown as Y.Doc & { awareness: any };

    const recordedStates: any[] = [];
    liveDoc.awareness.on('update', () => {
      recordedStates.push(structuredClone(Array.from(liveDoc.awareness.getStates().values())));
    });

    // 1. scaffoldDiagram
    await collaborator.scaffoldDiagram({
      diagramId: diag.id,
      agentName: 'ScaffoldBot',
      spec: {
        paradigm: 'circuit-flow',
        nodes: [{ id: 'n1', label: '节点1' }],
        edges: [],
      },
    });

    const scaffoldBroadcast = recordedStates.find((batch) =>
      batch.some((s: any) => s?.user?.isAi === true && s?.user?.agentName === 'ScaffoldBot'),
    );
    expect(scaffoldBroadcast).toBeDefined();

    // 2. autoLayout
    await collaborator.autoLayout({
      diagramId: diag.id,
      agentName: 'LayoutBot',
    });

    const layoutBroadcast = recordedStates.find((batch) =>
      batch.some((s: any) => s?.user?.isAi === true && s?.user?.agentName === 'LayoutBot'),
    );
    expect(layoutBroadcast).toBeDefined();

    // 最终无活动残留
    const finalStates = Array.from(liveDoc.awareness.getStates().values()) as any[];
    const activeAi = finalStates.find((s: any) => s?.user?.isAi === true && s?.user?.aiPlanning?.isPlanning);
    expect(activeAi).toBeUndefined();

    await direct.disconnect();
  });
});

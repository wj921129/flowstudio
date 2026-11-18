/**
 * @fileoverview AI 协作者引擎 (AI Collaborator Facade)
 * @description 代表 AI 协作者操作 Y.Doc：全部写入经由 DocumentWriter 在线优先引擎，
 *              记录实体级 Diff 账本，遵守人类锚定锁，并提供真实 Awareness 选区感知。
 *              本模块作为门面汇聚脚手架生成、增量操作执行、正交自动排版与语义巡检。
 */

import * as Y from 'yjs';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { DiagramSpec } from '@flowstudio/shared';
import type { DiagramRepository } from '../db/diagram-repository.js';
import { AiBatchManager } from '../collaboration/ai-batch-manager.js';
import { DocumentWriter } from '../collaboration/document-writer.js';
import { getNodeLockMode } from '../collaboration/entity-state.js';
import type { CompactDiagram, McpOp } from './types.js';
import { executeScaffoldDiagram } from './diagram-scaffolder.js';
import { executeApplyOps } from './op-executor.js';
import { executeAutoLayout } from './diagram-auto-layout.js';

export { inspectDiagramSemantics } from './diagram-inspector.js';
export {
  computeSwimlanePlacement,
  orderLaneIds,
  collectLiveLockState,
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  INSERT_GAP,
  LAYOUT_PADDING,
  LANE_HEADER_SIZE,
} from './swimlane-geometry.js';

const elkInstance = new ELK();

export class AiCollaborator {
  private batchManager: AiBatchManager;
  private writer: DocumentWriter;

  constructor(
    private repo: DiagramRepository,
    private serverBaseUrl: string = 'http://127.0.0.1:3000',
    batchManager?: AiBatchManager,
    writer?: DocumentWriter,
  ) {
    this.writer = writer ?? new DocumentWriter(repo);
    this.batchManager = batchManager ?? new AiBatchManager(repo, this.writer);
  }

  getBatchManager(): AiBatchManager {
    return this.batchManager;
  }

  private newBatchId(prefix = 'ai-batch'): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  private newEntityId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  async listDiagrams() {
    const list = this.repo.listDiagrams();
    return list.map((d) => ({
      id: d.id,
      title: d.title,
      updatedAt: d.updatedAt,
      url: `${this.serverBaseUrl}/#${d.id}`,
    }));
  }

  async createDiagram(title: string) {
    const summary = this.repo.createDiagram({ title: title || '未命名流程图' });
    return {
      id: summary.id,
      title: summary.title,
      url: `${this.serverBaseUrl}/#${summary.id}`,
    };
  }

  async getDiagram(diagramId: string): Promise<CompactDiagram | null> {
    if (!this.repo.getDiagramById(diagramId)) return null;
    return this.writer.readDocument(diagramId, (doc) => this.buildCompact(diagramId, doc));
  }

  private buildCompact(diagramId: string, doc: Y.Doc): CompactDiagram {
    const title = (doc.getMap('meta').get('title') as string) || '未命名流程图';
    const nodesMap = doc.getMap<Y.Map<unknown>>('nodes');
    const edgesMap = doc.getMap<Y.Map<unknown>>('edges');

    const lanes: Array<{ id: string; label: string }> = [];
    const nodes: CompactDiagram['nodes'] = [];
    const edges: CompactDiagram['edges'] = [];

    nodesMap.forEach((nodeMap, id) => {
      const type = (nodeMap.get('type') as string) || 'process';
      const pos = (nodeMap.get('position') as { x: number; y: number }) || { x: 0, y: 0 };
      const data = (nodeMap.get('data') as Record<string, unknown>) || {};
      const parentId = nodeMap.get('parentId') as string | undefined;
      const label = (data.label as string) || (data.laneTitle as string) || id;

      if (type === 'lane') {
        lanes.push({ id, label });
      } else if (type !== 'pool') {
        nodes.push({
          id,
          type,
          label,
          laneId: parentId,
          role: data.role as CompactDiagram['nodes'][number]['role'],
          attachTo: data.attachTo as string | undefined,
          position: pos,
          lockMode: getNodeLockMode(nodeMap),
        });
      }
    });

    edgesMap.forEach((edgeMap, id) => {
      const source = edgeMap.get('source') as string;
      const target = edgeMap.get('target') as string;
      const sourceHandle = (edgeMap.get('sourceHandle') as string | undefined) || undefined;
      const targetHandle = (edgeMap.get('targetHandle') as string | undefined) || undefined;
      const data = (edgeMap.get('data') as Record<string, unknown>) || {};
      const label = (data.label as string) || undefined;
      if (source && target) {
        edges.push({
          id,
          source,
          target,
          ...(sourceHandle ? { sourceHandle } : {}),
          ...(targetHandle ? { targetHandle } : {}),
          label,
          kind: data.kind as CompactDiagram['edges'][number]['kind'],
        });
      }
    });

    const meta = doc.getMap<unknown>('meta');
    return {
      id: diagramId,
      title,
      paradigm: meta.get('paradigm') as string | undefined,
      mainOrder: meta.get('mainOrder') as string[] | undefined,
      lanes,
      nodes,
      edges,
    };
  }

  async getSelection(diagramId: string, nickname?: string) {
    const doc = this.writer.getLiveDocument(diagramId) as
      | (Y.Doc & { awareness?: { getStates: () => Map<number, Record<string, unknown>> } })
      | null;

    if (!doc?.awareness) {
      return {
        diagramId,
        selections: [] as Array<{ clientId: string; nickname: string; selectedNodeIds: string[] }>,
        message: '当前无在线同事选中节点',
      };
    }

    const selections: Array<{ clientId: string; nickname: string; selectedNodeIds: string[] }> = [];
    doc.awareness.getStates().forEach((state, clientId) => {
      const user = (state?.user ?? state) as Record<string, unknown> | undefined;
      if (!user || typeof user !== 'object') return;
      if (nickname && user.nickname !== nickname) return;
      const selectedNodeIds = Array.isArray(user.selectedNodeIds)
        ? (user.selectedNodeIds as string[])
        : [];
      if (selectedNodeIds.length === 0) return;
      selections.push({
        clientId: typeof user.clientId === 'string' ? user.clientId : String(clientId),
        nickname: typeof user.nickname === 'string' ? user.nickname : '匿名同事',
        selectedNodeIds,
      });
    });

    return {
      diagramId,
      selections,
      message: selections.length > 0
        ? `共 ${selections.length} 位在线同事选中了节点`
        : '当前无在线同事选中节点',
    };
  }

  private async withAiAwareness<T>(
    diagramId: string,
    agentName: string | undefined,
    summary: string,
    targetNodeIds: string[],
    action: () => Promise<T>,
  ): Promise<T> {
    const liveDoc = this.writer.getLiveDocument(diagramId) as
      | (Y.Doc & { awareness?: { setLocalState: (s: unknown) => void } })
      | null;

    if (liveDoc?.awareness) {
      liveDoc.awareness.setLocalState({
        user: {
          clientId: 'ai-collaborator',
          nickname: agentName || 'AI Assistant',
          color: '#8b5cf6',
          cursor: null,
          selectedNodeIds: targetNodeIds,
          isAi: true,
          agentName: agentName || 'AI Assistant',
          aiPlanning: {
            isPlanning: true,
            prompt: summary,
            targetNodeIds,
          },
        },
      });
    }

    try {
      return await action();
    } finally {
      if (liveDoc?.awareness) {
        liveDoc.awareness.setLocalState(null);
      }
    }
  }

  async scaffoldDiagram(input: {
    diagramId: string;
    title?: string;
    agentName?: string;
    spec: DiagramSpec;
  }) {
    return executeScaffoldDiagram(
      {
        repo: this.repo,
        writer: this.writer,
        batchManager: this.batchManager,
        serverBaseUrl: this.serverBaseUrl,
        withAiAwareness: this.withAiAwareness.bind(this),
        newBatchId: this.newBatchId.bind(this),
      },
      input,
    );
  }

  async applyOps(input: { diagramId: string; agentName?: string; atomic?: boolean; ops: McpOp[] }) {
    return executeApplyOps(
      {
        repo: this.repo,
        writer: this.writer,
        batchManager: this.batchManager,
        withAiAwareness: this.withAiAwareness.bind(this),
        newBatchId: this.newBatchId.bind(this),
        newEntityId: this.newEntityId.bind(this),
      },
      input,
    );
  }

  async autoLayout(input: { diagramId: string; direction?: 'RIGHT' | 'DOWN'; agentName?: string }) {
    return executeAutoLayout(
      {
        repo: this.repo,
        writer: this.writer,
        batchManager: this.batchManager,
        elkInstance,
        withAiAwareness: this.withAiAwareness.bind(this),
        newBatchId: this.newBatchId.bind(this),
      },
      input,
    );
  }

  async undoAiBatch(input: { diagramId: string; batchId?: string }) {
    if (!this.repo.getDiagramById(input.diagramId)) {
      throw new Error(`图表 ${input.diagramId} 不存在`);
    }
    const batches = this.batchManager.getBatches(input.diagramId);
    const target = input.batchId
      ? batches.find((b) => b.batchId === input.batchId)
      : batches.find(
          (b) =>
            (b.status === 'active' || b.status === 'partially_reverted')
            && b.diffs.some((d: { reverted?: boolean }) => !d.reverted),
        );
    if (!target) {
      throw new Error(input.batchId ? `AI 批次 ${input.batchId} 不存在` : '当前图表没有可撤回的活跃 AI 批次');
    }
    return this.batchManager.revertBatch(input.diagramId, target.batchId);
  }

  async listSnapshots(diagramId: string) {
    if (!this.repo.getDiagramById(diagramId)) {
      throw new Error(`图表 ${diagramId} 不存在`);
    }
    return this.repo.listSnapshots(diagramId);
  }

  async restoreSnapshot(input: { diagramId: string; snapshotId: string }) {
    if (!this.repo.getDiagramById(input.diagramId)) {
      throw new Error(`图表 ${input.diagramId} 不存在`);
    }
    const result = await this.writer.restoreSnapshot(input.diagramId, input.snapshotId);
    if (!result.success) {
      throw new Error(result.error || '恢复快照失败');
    }
    return {
      success: true,
      diagramId: input.diagramId,
      snapshotId: input.snapshotId,
      message: '已无损恢复至指定快照',
    };
  }

  async searchNodes(input: {
    diagramId: string;
    query?: string;
    laneId?: string;
    type?: string;
    limit?: number;
  }) {
    if (!this.repo.getDiagramById(input.diagramId)) {
      throw new Error(`图表 ${input.diagramId} 不存在`);
    }
    const compact = await this.writer.readDocument(input.diagramId, (doc) => this.buildCompact(input.diagramId, doc));
    const q = input.query?.trim().toLowerCase();
    const limit = input.limit ?? 50;
    const matched = compact.nodes
      .filter((n) => {
        if (input.laneId && n.laneId !== input.laneId) return false;
        if (input.type && n.type !== input.type) return false;
        if (q && !n.label.toLowerCase().includes(q) && !n.id.toLowerCase().includes(q)) return false;
        return true;
      })
      .slice(0, limit);
    const matchedIds = new Set(matched.map((n) => n.id));
    const relatedEdges = compact.edges.filter((e) => matchedIds.has(e.source) || matchedIds.has(e.target));
    return {
      diagramId: input.diagramId,
      totalMatched: matched.length,
      nodes: matched,
      relatedEdges,
    };
  }

  async renameDiagram(input: { diagramId: string; title: string }) {
    const trimmed = input.title.trim();
    if (!trimmed) {
      throw new Error('图表标题不能为空');
    }
    const updated = this.repo.updateDiagram(input.diagramId, { title: trimmed });
    if (!updated) {
      throw new Error(`图表 ${input.diagramId} 不存在`);
    }
    const outcome = await this.writer.mutate(input.diagramId, `ai:rename-${input.diagramId}`, (doc) => {
      doc.getMap<unknown>('meta').set('title', trimmed);
    });
    return {
      success: true,
      id: updated.id,
      title: trimmed,
      live: outcome.live,
      url: `${this.serverBaseUrl}/#${updated.id}`,
    };
  }

  async deleteDiagram(diagramId: string) {
    const deleted = this.repo.deleteDiagram(diagramId);
    if (!deleted) {
      throw new Error(`图表 ${diagramId} 不存在`);
    }
    return {
      success: true,
      id: diagramId,
      message: '图表已删除',
    };
  }
}

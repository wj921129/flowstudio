import * as Y from 'yjs';
import type { AiBatchEntityDiff, DiagramSpec, FlowEdge, FlowNode, NodeLockMode } from '@flowstudio/shared';
import { normalizeSpec, renderSpec } from '@flowstudio/shared';
import { diffRendered } from './spec-ops.js';
import type { DiagramRepository } from '../db/diagram-repository.js';
import type { AiBatchManager } from '../collaboration/ai-batch-manager.js';
import type { DocumentWriter } from '../collaboration/document-writer.js';
import { deepEqual, getNodeLockMode, snapshotMap } from '../collaboration/entity-state.js';
import { collectLiveLockState, DEFAULT_NODE_HEIGHT, DEFAULT_NODE_WIDTH } from './swimlane-geometry.js';
import { inspectDiagramSemantics } from './diagram-inspector.js';

export interface ScaffolderContext {
  repo: DiagramRepository;
  writer: DocumentWriter;
  batchManager: AiBatchManager;
  serverBaseUrl: string;
  withAiAwareness: <T>(
    diagramId: string,
    agentName: string | undefined,
    summary: string,
    targetNodeIds: string[],
    action: () => Promise<T>,
  ) => Promise<T>;
  newBatchId: (prefix?: string) => string;
}

export interface ScaffoldInput {
  diagramId: string;
  title?: string;
  agentName?: string;
  spec: DiagramSpec;
}

export async function executeScaffoldDiagram(ctx: ScaffolderContext, input: ScaffoldInput) {
  if (!ctx.repo.getDiagramById(input.diagramId)) {
    throw new Error(`图表 ${input.diagramId} 不存在`);
  }

  const targetNodeIds = (input.spec.nodes || []).map((n: { id?: string }) => n.id).filter(Boolean) as string[];
  return ctx.withAiAwareness(
    input.diagramId,
    input.agentName,
    `AI 正在根据 ${input.spec.paradigm || '默认'} 范式构建图表...`,
    targetNodeIds,
    async () => {
      const existing = await ctx.writer.readDocument(input.diagramId, (doc) => {
        const nodes: FlowNode[] = [];
        const edges: FlowEdge[] = [];
        const locks = new Map<string, NodeLockMode>();
        doc.getMap<Y.Map<unknown>>('nodes').forEach((nodeMap, id) => {
          nodes.push(snapshotMap(nodeMap) as unknown as FlowNode);
          locks.set(id, getNodeLockMode(nodeMap));
        });
        doc.getMap<Y.Map<unknown>>('edges').forEach((edgeMap) => {
          edges.push(snapshotMap(edgeMap) as unknown as FlowEdge);
        });
        return { nodes, edges, locks };
      });

      ctx.writer.createSnapshot(input.diagramId, 'AI 生成骨架前快照', 'ai_batch');

      const protectedIds = new Set<string>();
      for (const n of existing.nodes) {
        if ((existing.locks.get(n.id) ?? 'none') !== 'full') continue;
        protectedIds.add(n.id);
        let cursor = n.parentId;
        const seen = new Set([n.id]);
        while (cursor && !seen.has(cursor)) {
          seen.add(cursor);
          protectedIds.add(cursor);
          cursor = existing.nodes.find((x) => x.id === cursor)?.parentId;
        }
      }
      const ancestorWarnings = [...protectedIds]
        .filter((id) => (existing.locks.get(id) ?? 'none') !== 'full')
        .map((id) => `容器 ${id} 含人工完全锁定节点，已一并保留`);
      const fixed = new Map(
        existing.nodes
          .filter((n) => (existing.locks.get(n.id) ?? 'none') !== 'none' || protectedIds.has(n.id))
          .map((n) => [n.id, { position: n.position, width: n.width ?? DEFAULT_NODE_WIDTH, height: n.height ?? DEFAULT_NODE_HEIGHT }]),
      );
      const laneSizes = new Map(
        existing.nodes.filter((n) => n.type === 'lane').map((n) => [n.id, { width: n.width ?? 0, height: n.height ?? 0 }]),
      );
      const obstacles = new Map(
        [...fixed].filter(([id]) => {
          const t = existing.nodes.find((n) => n.id === id)?.type;
          return t === 'pool' || t === 'lane' || t === 'group';
        }),
      );
      const existingPool = existing.nodes.find((n) => n.type === 'pool' && n.id === 'pool');
      const rendered = renderSpec(input.spec, { fixed, laneSizes, poolPosition: existingPool?.position, obstacles });
      const diff = diffRendered(rendered, existing.nodes, existing.edges, (id) => existing.locks.get(id) ?? 'none');
      const mainOrder = normalizeSpec(input.spec).mainOrder;

      const batchId = ctx.newBatchId('ai-scaffold');
      const outcome = await ctx.writer.mutate(input.diagramId, `ai:${batchId}`, (doc) => {
        const nodesMap = doc.getMap<Y.Map<unknown>>('nodes');
        const edgesMap = doc.getMap<Y.Map<unknown>>('edges');
        const metaMap = doc.getMap<unknown>('meta');
        const diffs: AiBatchEntityDiff[] = [];
        const warnings: string[] = [];
        const { fullProtectedIds, hasLockedAncestor } = collectLiveLockState(nodesMap);
        const recordDelete = (entityType: 'node' | 'edge', id: string, map: Y.Map<unknown>) => {
          diffs.push({ entityId: id, entityType, opType: 'delete', beforeState: snapshotMap(map), afterState: null });
        };
        for (const id of diff.deleteEdgeIds) {
          const m = edgesMap.get(id);
          if (!m) continue;
          const source = m.get('source') as string | undefined;
          const target = m.get('target') as string | undefined;
          if (source && target && fullProtectedIds.has(source) && fullProtectedIds.has(target)) {
            warnings.push(`连线 ${id} 连接人工锁定节点，跳过删除`);
            continue;
          }
          recordDelete('edge', id, m);
          edgesMap.delete(id);
        }
        for (const id of diff.deleteNodeIds) {
          const m = nodesMap.get(id);
          if (!m) continue;
          if (getNodeLockMode(m) !== 'none' || fullProtectedIds.has(id) || hasLockedAncestor(id)) {
            warnings.push(`节点 ${id} 已被人工锁定或含锁定子节点，跳过删除`);
            continue;
          }
          recordDelete('node', id, m);
          nodesMap.delete(id);
        }
        const writeNode = (n: FlowNode) => {
          const existingMap = nodesMap.get(n.id);
          if (existingMap) {
            if (getNodeLockMode(existingMap) !== 'none' || fullProtectedIds.has(n.id) || hasLockedAncestor(n.id)) {
              warnings.push(`节点 ${n.id} 已被人工锁定，跳过写入覆盖`);
              return;
            }
          }
          const m = new Y.Map<unknown>();
          m.set('id', n.id);
          m.set('type', n.type);
          m.set('position', n.position);
          m.set('width', n.width);
          m.set('height', n.height);
          if (n.parentId) {
            m.set('parentId', n.parentId);
            m.set('extent', n.extent ?? 'parent');
          }
          m.set('data', n.data);
          nodesMap.set(n.id, m);
          diffs.push({ entityId: n.id, entityType: 'node', opType: 'add', beforeState: null, afterState: snapshotMap(m) });
        };
        const writeEdge = (e: FlowEdge) => {
          const m = new Y.Map<unknown>();
          m.set('id', e.id);
          m.set('source', e.source);
          m.set('target', e.target);
          m.set('type', e.type ?? 'orthogonal');
          if (e.sourceHandle) m.set('sourceHandle', e.sourceHandle);
          if (e.targetHandle) m.set('targetHandle', e.targetHandle);
          m.set('data', e.data ?? {});
          edgesMap.set(e.id, m);
          diffs.push({ entityId: e.id, entityType: 'edge', opType: 'add', beforeState: null, afterState: snapshotMap(m) });
        };
        for (const n of diff.addNodes) writeNode(n);
        for (const e of diff.addEdges) writeEdge(e);
        for (const { id, patch } of diff.updateNodes) {
          const m = nodesMap.get(id);
          if (!m) continue;
          const lockMode = getNodeLockMode(m);
          if (lockMode === 'full' || fullProtectedIds.has(id) || hasLockedAncestor(id)) {
            warnings.push(`节点 ${id} 已被人工完全锁定，跳过修改`);
            continue;
          }
          const entries = Object.entries(patch).filter(([k]) => {
            if (lockMode === 'position' && k === 'position') {
              warnings.push(`节点 ${id} 已被人工锁定坐标，跳过坐标覆写`);
              return false;
            }
            return true;
          });
          if (entries.length === 0) continue;
          const before = snapshotMap(m);
          for (const [k, v] of entries) {
            if (k === 'data' && lockMode !== 'none' && v && typeof v === 'object') {
              m.set('data', { ...(v as Record<string, unknown>), lockMode });
            } else {
              m.set(k, v);
            }
          }
          const after = snapshotMap(m);
          if (!deepEqual(before, after)) {
            diffs.push({ entityId: id, entityType: 'node', opType: 'update', beforeState: before, afterState: after });
          }
        }
        for (const { id, patch } of diff.updateEdges) {
          const m = edgesMap.get(id);
          if (!m) continue;
          const source = m.get('source') as string | undefined;
          const target = m.get('target') as string | undefined;
          if ((source && fullProtectedIds.has(source)) || (target && fullProtectedIds.has(target))) {
            warnings.push(`连线 ${id} 连接人工锁定节点，跳过修改`);
            continue;
          }
          const before = snapshotMap(m);
          for (const [k, v] of Object.entries(patch)) m.set(k, v);
          const after = snapshotMap(m);
          if (!deepEqual(before, after)) {
            diffs.push({ entityId: id, entityType: 'edge', opType: 'update', beforeState: before, afterState: after });
          }
        }
        metaMap.set('paradigm', input.spec.paradigm);
        metaMap.set('mainOrder', mainOrder);
        if (input.title) metaMap.set('title', input.title.trim());
        const semanticWarnings = inspectDiagramSemantics(nodesMap, edgesMap);
        return {
          diffs,
          warnings: Array.from(new Set([...rendered.warnings, ...diff.warnings, ...ancestorWarnings, ...warnings, ...semanticWarnings])),
        };
      });

      ctx.batchManager.recordBatch({
        batchId,
        diagramId: input.diagramId,
        agentName: input.agentName,
        summary: `AI 生成骨架：${rendered.nodes.length} 个节点、${rendered.edges.length} 条连线`,
        status: 'active',
        diffs: outcome.result.diffs,
        createdAt: new Date().toISOString(),
      });

      return {
        success: true,
        batchId,
        message: `已成功按 ${input.spec.paradigm} 范式渲染 ${rendered.nodes.length} 个节点、${rendered.edges.length} 条连线`,
        warnings: outcome.result.warnings,
        live: outcome.live,
        url: `${ctx.serverBaseUrl}/#${input.diagramId}`,
      };
    },
  );
}

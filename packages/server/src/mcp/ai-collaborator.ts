/**
 * @fileoverview AI 协作者引擎 (AI Collaborator)
 * @description 代表 AI 协作者操作 Y.Doc：全部写入经由 DocumentWriter 在线优先引擎，
 *              记录实体级 Diff 账本，遵守人类锚定锁，并提供真实 Awareness 选区感知。
 */

import * as Y from 'yjs';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { AiBatchEntityDiff } from '@flowstudio/shared';
import type { DiagramRepository } from '../db/diagram-repository.js';
import { AiBatchManager } from '../collaboration/ai-batch-manager.js';
import { DocumentWriter } from '../collaboration/document-writer.js';
import {
  deepEqual,
  getNodeLockMode,
  snapshotMap,
} from '../collaboration/entity-state.js';
import type { CompactDiagram, McpOp } from './types.js';

const elkInstance = new ELK();

const DEFAULT_NODE_WIDTH = 160;
const DEFAULT_NODE_HEIGHT = 80;
const INSERT_GAP = 60;

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

  /**
   * 1. list_diagrams
   */
  async listDiagrams() {
    const list = this.repo.listDiagrams();
    return list.map((d) => ({
      id: d.id,
      title: d.title,
      updatedAt: d.updatedAt,
      url: `${this.serverBaseUrl}/#${d.id}`,
    }));
  }

  /**
   * 2. create_diagram
   */
  async createDiagram(title: string) {
    const summary = this.repo.createDiagram({ title: title || '未命名流程图' });
    return {
      id: summary.id,
      title: summary.title,
      url: `${this.serverBaseUrl}/#${summary.id}`,
    };
  }

  /**
   * 3. get_diagram（在线时读取 Live Y.Doc，确保 AI 看到同事最新改动）
   */
  async getDiagram(diagramId: string): Promise<CompactDiagram | null> {
    if (!this.repo.getDiagramById(diagramId)) return null;
    try {
      return await this.writer.readDocument(diagramId, (doc) => this.buildCompact(diagramId, doc));
    } catch {
      return null;
    }
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
          position: pos,
          lockMode: getNodeLockMode(nodeMap),
        });
      }
    });

    edgesMap.forEach((edgeMap, id) => {
      const source = edgeMap.get('source') as string;
      const target = edgeMap.get('target') as string;
      const data = (edgeMap.get('data') as Record<string, unknown>) || {};
      const label = (data.label as string) || undefined;
      if (source && target) {
        edges.push({ id, source, target, label });
      }
    });

    return { id: diagramId, title, lanes, nodes, edges };
  }

  /**
   * 4. get_selection（从在线 Hocuspocus Awareness 实时读取真实选区）
   */
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

  /**
   * 5. scaffold_diagram（在线优先写入 + 可逆批次账本）
   */
  async scaffoldDiagram(input: {
    diagramId: string;
    title?: string;
    agentName?: string;
    lanes?: Array<{ id: string; label: string }>;
    nodes: Array<{ id: string; type: string; label: string; laneId?: string }>;
    edges: Array<{ source: string; target: string; label?: string }>;
  }) {
    if (!this.repo.getDiagramById(input.diagramId)) {
      throw new Error(`图表 ${input.diagramId} 不存在`);
    }

    this.repo.createSnapshot(input.diagramId, 'AI 生成骨架前快照', 'ai_batch');

    const hasLanes = Boolean(input.lanes && input.lanes.length > 0);
    const poolId = hasLanes ? this.newEntityId('pool') : undefined;

    const layoutResult = await elkInstance.layout({
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.spacing.nodeNode': '60',
        'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      },
      children: input.nodes.map((n) => ({ id: n.id, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT })),
      edges: input.edges.map((e, idx) => ({ id: `e-${idx}`, sources: [e.source], targets: [e.target] })),
    });

    const posMap = new Map<string, { x: number; y: number }>();
    for (const child of layoutResult.children ?? []) {
      posMap.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
    }

    const batchId = this.newBatchId('ai-scaffold');
    const outcome = await this.writer.mutate(input.diagramId, `ai:${batchId}`, (doc) => {
      const nodesMap = doc.getMap<Y.Map<unknown>>('nodes');
      const edgesMap = doc.getMap<Y.Map<unknown>>('edges');
      const metaMap = doc.getMap<unknown>('meta');
      const diffs: AiBatchEntityDiff[] = [];

      nodesMap.forEach((nodeMap, id) => {
        diffs.push({
          entityId: id,
          entityType: 'node',
          opType: 'delete',
          beforeState: snapshotMap(nodeMap),
          afterState: null,
        });
      });
      edgesMap.forEach((edgeMap, id) => {
        diffs.push({
          entityId: id,
          entityType: 'edge',
          opType: 'delete',
          beforeState: snapshotMap(edgeMap),
          afterState: null,
        });
      });

      if (input.title) {
        metaMap.set('title', input.title.trim());
      }

      nodesMap.clear();
      edgesMap.clear();

      const registerNode = (id: string, nodeMap: Y.Map<unknown>) => {
        nodesMap.set(id, nodeMap);
        diffs.push({
          entityId: id,
          entityType: 'node',
          opType: 'add',
          beforeState: null,
          afterState: snapshotMap(nodeMap),
        });
      };

      if (hasLanes && poolId) {
        const poolMap = new Y.Map<unknown>();
        poolMap.set('id', poolId);
        poolMap.set('type', 'pool');
        poolMap.set('position', { x: 50, y: 50 });
        poolMap.set('width', 900);
        poolMap.set('height', 40 + input.lanes!.length * 200);
        poolMap.set('data', {
          label: input.title || '业务泳道池',
          type: 'pool',
          orientation: 'horizontal',
          laneOrder: input.lanes!.map((l) => l.id),
          headerSize: 40,
        });
        registerNode(poolId, poolMap);

        input.lanes!.forEach((lane, idx) => {
          const laneMap = new Y.Map<unknown>();
          laneMap.set('id', lane.id);
          laneMap.set('type', 'lane');
          laneMap.set('parentId', poolId);
          laneMap.set('extent', 'parent');
          laneMap.set('position', { x: 0, y: 40 + idx * 200 });
          laneMap.set('width', 900);
          laneMap.set('height', 200);
          laneMap.set('data', { label: lane.label, type: 'lane', laneTitle: lane.label });
          registerNode(lane.id, laneMap);
        });
      }

      for (const node of input.nodes) {
        const nodeMap = new Y.Map<unknown>();
        nodeMap.set('id', node.id);
        nodeMap.set('type', node.type || 'process');
        nodeMap.set('position', posMap.get(node.id) ?? { x: 50, y: 50 });
        nodeMap.set('width', DEFAULT_NODE_WIDTH);
        nodeMap.set('height', DEFAULT_NODE_HEIGHT);
        if (node.laneId) {
          nodeMap.set('parentId', node.laneId);
          nodeMap.set('extent', 'parent');
        }
        nodeMap.set('data', { label: node.label, type: node.type || 'process' });
        registerNode(node.id, nodeMap);
      }

      input.edges.forEach((edge) => {
        const edgeId = this.newEntityId('edge');
        const edgeMap = new Y.Map<unknown>();
        edgeMap.set('id', edgeId);
        edgeMap.set('source', edge.source);
        edgeMap.set('target', edge.target);
        edgeMap.set('type', 'orthogonal');
        edgeMap.set('data', { label: edge.label });
        edgesMap.set(edgeId, edgeMap);
        diffs.push({
          entityId: edgeId,
          entityType: 'edge',
          opType: 'add',
          beforeState: null,
          afterState: snapshotMap(edgeMap),
        });
      });

      return diffs;
    });

    this.batchManager.recordBatch({
      batchId,
      diagramId: input.diagramId,
      agentName: input.agentName,
      summary: `AI 生成骨架：${input.nodes.length} 个节点、${input.edges.length} 条连线`,
      status: 'active',
      diffs: outcome.result,
      createdAt: new Date().toISOString(),
    });

    return {
      success: true,
      batchId,
      message: `已成功生成包含 ${input.nodes.length} 个节点、${input.edges.length} 条连线的骨架`,
      live: outcome.live,
      url: `${this.serverBaseUrl}/#${input.diagramId}`,
    };
  }

  /**
   * 6. apply_ops（原子增量操作 + 实体级 Diff 账本 + 锚定锁保护）
   */
  async applyOps(input: { diagramId: string; agentName?: string; ops: McpOp[] }) {
    if (!this.repo.getDiagramById(input.diagramId)) {
      throw new Error(`图表 ${input.diagramId} 不存在`);
    }

    this.repo.createSnapshot(input.diagramId, 'AI 增量修改前快照', 'ai_batch');

    const batchId = this.newBatchId();
    const outcome = await this.writer.mutate(input.diagramId, `ai:${batchId}`, (doc) => {
      const nodesMap = doc.getMap<Y.Map<unknown>>('nodes');
      const edgesMap = doc.getMap<Y.Map<unknown>>('edges');

      const diffs: AiBatchEntityDiff[] = [];
      const warnings: string[] = [];
      let appliedCount = 0;

      const recordAdd = (entityType: 'node' | 'edge', entityId: string, map: Y.Map<unknown>) => {
        diffs.push({
          entityId,
          entityType,
          opType: 'add',
          beforeState: null,
          afterState: snapshotMap(map),
        });
      };
      const recordUpdate = (
        entityType: 'node' | 'edge',
        entityId: string,
        before: Record<string, unknown>,
        after: Record<string, unknown>,
      ) => {
        if (deepEqual(before, after)) return;
        diffs.push({ entityId, entityType, opType: 'update', beforeState: before, afterState: after });
      };
      const recordDelete = (
        entityType: 'node' | 'edge',
        entityId: string,
        before: Record<string, unknown>,
      ) => {
        diffs.push({ entityId, entityType, opType: 'delete', beforeState: before, afterState: null });
      };

      const nodeLabel = (nodeMap: Y.Map<unknown> | null) =>
        ((nodeMap?.get('data') as Record<string, unknown> | undefined)?.label as string) || '未命名';

      const isBlocked = (nodeMap: Y.Map<unknown>, action: 'modify' | 'delete' | 'move'): boolean => {
        const lockMode = getNodeLockMode(nodeMap);
        if (lockMode === 'full') {
          warnings.push(
            `节点 ${nodeMap.get('id') || ''}(${nodeLabel(nodeMap)}) 已被人类完全锁定，跳过${action === 'delete' ? '删除' : '修改'}`,
          );
          return true;
        }
        if (lockMode === 'position' && action === 'move') {
          warnings.push(
            `节点 ${nodeMap.get('id') || ''}(${nodeLabel(nodeMap)}) 已被人类锁定坐标，跳过移动`,
          );
          return true;
        }
        return false;
      };

      const createNodeMap = (spec: {
        id: string;
        type: string;
        label: string;
        position: { x: number; y: number };
        laneId?: string;
        style?: Record<string, unknown>;
      }) => {
        const nodeMap = new Y.Map<unknown>();
        nodeMap.set('id', spec.id);
        nodeMap.set('type', spec.type || 'process');
        nodeMap.set('position', spec.position);
        nodeMap.set('width', DEFAULT_NODE_WIDTH);
        nodeMap.set('height', DEFAULT_NODE_HEIGHT);
        if (spec.laneId) {
          nodeMap.set('parentId', spec.laneId);
          nodeMap.set('extent', 'parent');
        }
        nodeMap.set('data', {
          label: spec.label,
          type: spec.type || 'process',
          ...(spec.style ? { style: spec.style } : {}),
        });
        nodesMap.set(spec.id, nodeMap);
        recordAdd('node', spec.id, nodeMap);
        return nodeMap;
      };

      const createEdgeMap = (
        source: string,
        target: string,
        label?: string,
        style?: Record<string, unknown>,
      ) => {
        const edgeId = this.newEntityId('edge');
        const edgeMap = new Y.Map<unknown>();
        edgeMap.set('id', edgeId);
        edgeMap.set('source', source);
        edgeMap.set('target', target);
        edgeMap.set('type', 'orthogonal');
        edgeMap.set('data', { label, ...(style ? { style } : {}) });
        edgesMap.set(edgeId, edgeMap);
        recordAdd('edge', edgeId, edgeMap);
        return edgeId;
      };

      for (const op of input.ops) {
        switch (op.op) {
          case 'add_node': {
            const nodeId = op.id || this.newEntityId('node');
            if (nodesMap.has(nodeId)) {
              warnings.push(`节点 ${nodeId} 已存在，跳过新增`);
              break;
            }
            createNodeMap({
              id: nodeId,
              type: op.type || 'process',
              label: op.label,
              position: { x: 100 + appliedCount * 180, y: 100 },
              laneId: op.laneId,
              style: op.style,
            });
            appliedCount++;
            break;
          }

          case 'update_node': {
            const nodeMap = nodesMap.get(op.id);
            if (!nodeMap) {
              warnings.push(`未找到节点 ${op.id}，跳过更新`);
              break;
            }
            if (isBlocked(nodeMap, 'modify')) break;

            const before = snapshotMap(nodeMap);
            const data = (nodeMap.get('data') as Record<string, unknown>) || {};
            const nextData = { ...data };
            if (op.label !== undefined) nextData.label = op.label;
            if (op.style) {
              nextData.style = {
                ...((nextData.style as Record<string, unknown>) || {}),
                ...op.style,
              };
            }
            nodeMap.set('data', nextData);
            recordUpdate('node', op.id, before, snapshotMap(nodeMap));
            appliedCount++;
            break;
          }

          case 'delete_node': {
            const nodeMap = nodesMap.get(op.id);
            if (!nodeMap) {
              warnings.push(`未找到节点 ${op.id}，跳过删除`);
              break;
            }
            if (isBlocked(nodeMap, 'delete')) break;

            recordDelete('node', op.id, snapshotMap(nodeMap));
            const cascadedEdgeIds: string[] = [];
            edgesMap.forEach((edgeMap, edgeId) => {
              if (edgeMap.get('source') === op.id || edgeMap.get('target') === op.id) {
                cascadedEdgeIds.push(edgeId);
              }
            });
            for (const edgeId of cascadedEdgeIds) {
              const edgeMap = edgesMap.get(edgeId);
              if (edgeMap) recordDelete('edge', edgeId, snapshotMap(edgeMap));
              edgesMap.delete(edgeId);
            }
            nodesMap.delete(op.id);
            appliedCount++;
            break;
          }

          case 'connect': {
            if (!nodesMap.has(op.source) || !nodesMap.has(op.target)) {
              warnings.push(`连线端点不存在 (${op.source} -> ${op.target})，跳过`);
              break;
            }
            createEdgeMap(op.source, op.target, op.label, op.style);
            appliedCount++;
            break;
          }

          case 'disconnect': {
            if (op.edgeId) {
              const edgeMap = edgesMap.get(op.edgeId);
              if (!edgeMap) {
                warnings.push(`未找到连线 ${op.edgeId}，跳过`);
                break;
              }
              recordDelete('edge', op.edgeId, snapshotMap(edgeMap));
              edgesMap.delete(op.edgeId);
              appliedCount++;
            } else if (op.source && op.target) {
              const matched: string[] = [];
              edgesMap.forEach((edgeMap, edgeId) => {
                if (edgeMap.get('source') === op.source && edgeMap.get('target') === op.target) {
                  matched.push(edgeId);
                }
              });
              for (const edgeId of matched) {
                const edgeMap = edgesMap.get(edgeId);
                if (edgeMap) recordDelete('edge', edgeId, snapshotMap(edgeMap));
                edgesMap.delete(edgeId);
                appliedCount++;
              }
            }
            break;
          }

          case 'move_to_lane': {
            const nodeMap = nodesMap.get(op.nodeId);
            if (!nodeMap) {
              warnings.push(`未找到节点 ${op.nodeId}，跳过移入泳道`);
              break;
            }
            if (isBlocked(nodeMap, 'move')) break;
            const before = snapshotMap(nodeMap);
            nodeMap.set('parentId', op.laneId);
            nodeMap.set('extent', 'parent');
            recordUpdate('node', op.nodeId, before, snapshotMap(nodeMap));
            appliedCount++;
            break;
          }

          case 'move_node': {
            const nodeMap = nodesMap.get(op.id);
            if (!nodeMap) {
              warnings.push(`未找到节点 ${op.id}，跳过移动`);
              break;
            }
            if (isBlocked(nodeMap, 'move')) break;
            const before = snapshotMap(nodeMap);
            nodeMap.set('position', { x: op.position.x, y: op.position.y });
            recordUpdate('node', op.id, before, snapshotMap(nodeMap));
            appliedCount++;
            break;
          }

          case 'update_edge': {
            const edgeMap = edgesMap.get(op.id);
            if (!edgeMap) {
              warnings.push(`未找到连线 ${op.id}，跳过更新`);
              break;
            }
            const before = snapshotMap(edgeMap);
            const data = (edgeMap.get('data') as Record<string, unknown>) || {};
            const nextData = { ...data };
            if (op.label !== undefined) nextData.label = op.label;
            if (op.style) {
              nextData.style = {
                ...((nextData.style as Record<string, unknown>) || {}),
                ...op.style,
              };
            }
            edgeMap.set('data', nextData);
            recordUpdate('edge', op.id, before, snapshotMap(edgeMap));
            appliedCount++;
            break;
          }

          case 'add_lane': {
            const laneId = op.id || this.newEntityId('lane');
            if (nodesMap.has(laneId)) {
              warnings.push(`泳道 ${laneId} 已存在，跳过新增`);
              break;
            }
            const laneMap = new Y.Map<unknown>();
            laneMap.set('id', laneId);
            laneMap.set('type', 'lane');
            laneMap.set('position', { x: 0, y: 0 });
            laneMap.set('width', 750);
            laneMap.set('height', 200);
            laneMap.set('data', { label: op.label, type: 'lane', laneTitle: op.label });
            if (op.poolId) {
              const poolMap = nodesMap.get(op.poolId);
              if (!poolMap) {
                warnings.push(`未找到泳道池 ${op.poolId}，泳道将作为独立泳道创建`);
              } else {
                laneMap.set('parentId', op.poolId);
                laneMap.set('extent', 'parent');
                const before = snapshotMap(poolMap);
                const poolData = (poolMap.get('data') as Record<string, unknown>) || {};
                poolMap.set('data', {
                  ...poolData,
                  laneOrder: [...((poolData.laneOrder as string[]) || []), laneId],
                });
                recordUpdate('node', op.poolId, before, snapshotMap(poolMap));
              }
            }
            nodesMap.set(laneId, laneMap);
            recordAdd('node', laneId, laneMap);
            appliedCount++;
            break;
          }

          case 'insert_between': {
            const sourceMap = nodesMap.get(op.source);
            const targetMap = nodesMap.get(op.target);
            if (!sourceMap || !targetMap) {
              warnings.push(`断线串接端点不存在 (${op.source} -> ${op.target})，跳过`);
              break;
            }
            const nodeId = op.node.id || this.newEntityId('node');
            if (nodesMap.has(nodeId)) {
              warnings.push(`节点 ${nodeId} 已存在，跳过插入`);
              break;
            }

            const direction = op.direction ?? 'RIGHT';
            const sourcePos = (sourceMap.get('position') as { x: number; y: number }) || { x: 0, y: 0 };
            const targetPos = (targetMap.get('position') as { x: number; y: number }) || { x: 0, y: 0 };
            const laneId =
              op.node.laneId ?? (sourceMap.get('parentId') as string | undefined);

            const newNodePos =
              direction === 'DOWN'
                ? { x: sourcePos.x, y: sourcePos.y + DEFAULT_NODE_HEIGHT + INSERT_GAP }
                : { x: sourcePos.x + DEFAULT_NODE_WIDTH + INSERT_GAP, y: sourcePos.y };

            createNodeMap({
              id: nodeId,
              type: op.node.type || 'process',
              label: op.node.label,
              position: newNodePos,
              laneId,
              style: op.node.style,
            });

            // 删除原有的 source -> target 连线
            const originalEdgeIds: string[] = [];
            edgesMap.forEach((edgeMap, edgeId) => {
              if (edgeMap.get('source') === op.source && edgeMap.get('target') === op.target) {
                originalEdgeIds.push(edgeId);
              }
            });
            for (const edgeId of originalEdgeIds) {
              const edgeMap = edgesMap.get(edgeId);
              if (edgeMap) {
                recordDelete('edge', edgeId, snapshotMap(edgeMap));
                edgesMap.delete(edgeId);
              }
            }

            createEdgeMap(
              op.source,
              nodeId,
              op.upstreamLabel ?? op.edgeLabel,
            );
            createEdgeMap(
              nodeId,
              op.target,
              op.downstreamLabel ?? op.edgeLabel,
            );

            // 下游同流向局部顺推
            const downstream = new Set<string>();
            const queue = [op.target];
            while (queue.length > 0) {
              const currentId = queue.shift()!;
              if (downstream.has(currentId)) continue;
              downstream.add(currentId);
              edgesMap.forEach((edgeMap) => {
                if (edgeMap.get('source') === currentId) {
                  const nextId = edgeMap.get('target') as string;
                  if (nextId && nextId !== nodeId && nextId !== op.source && !downstream.has(nextId)) {
                    queue.push(nextId);
                  }
                }
              });
            }

            const minTargetMain =
              direction === 'DOWN'
                ? newNodePos.y + DEFAULT_NODE_HEIGHT + INSERT_GAP
                : newNodePos.x + DEFAULT_NODE_WIDTH + INSERT_GAP;
            const currentMain = direction === 'DOWN' ? targetPos.y : targetPos.x;
            const shift = minTargetMain - currentMain;

            if (shift > 0) {
              for (const downstreamId of downstream) {
                const nodeMap = nodesMap.get(downstreamId);
                if (!nodeMap) continue;
                const type = nodeMap.get('type');
                if (type === 'pool' || type === 'lane') continue;
                const lockMode = getNodeLockMode(nodeMap);
                if (lockMode !== 'none') {
                  warnings.push(
                    `节点 ${downstreamId}(${nodeLabel(nodeMap)}) 已锁定坐标，未参与下游顺推`,
                  );
                  continue;
                }
                const before = snapshotMap(nodeMap);
                const pos = (nodeMap.get('position') as { x: number; y: number }) || { x: 0, y: 0 };
                nodeMap.set(
                  'position',
                  direction === 'DOWN'
                    ? { x: pos.x, y: pos.y + shift }
                    : { x: pos.x + shift, y: pos.y },
                );
                recordUpdate('node', downstreamId, before, snapshotMap(nodeMap));
              }
            }

            appliedCount++;
            break;
          }
        }
      }

      return { diffs, warnings, appliedCount };
    });

    const { diffs, warnings, appliedCount } = outcome.result;

    this.batchManager.recordBatch({
      batchId,
      diagramId: input.diagramId,
      agentName: input.agentName,
      summary: `AI 增量执行了 ${appliedCount} 项操作`,
      status: 'active',
      diffs,
      createdAt: new Date().toISOString(),
    });

    return {
      success: true,
      batchId,
      appliedCount,
      totalOps: input.ops.length,
      warnings,
      live: outcome.live,
    };
  }

  /**
   * 7. auto_layout（遵守 position/full 锚定锁，记录位置级 Diff）
   */
  async autoLayout(input: { diagramId: string; direction?: 'RIGHT' | 'DOWN'; agentName?: string }) {
    if (!this.repo.getDiagramById(input.diagramId)) {
      throw new Error(`图表 ${input.diagramId} 不存在`);
    }

    this.repo.createSnapshot(input.diagramId, '服务端自动排版前快照', 'manual');

    const graph = await this.writer.readDocument(input.diagramId, (doc) => {
      const nodesMap = doc.getMap<Y.Map<unknown>>('nodes');
      const edgesMap = doc.getMap<Y.Map<unknown>>('edges');
      const children: Array<{ id: string; width: number; height: number; locked: boolean }> = [];
      nodesMap.forEach((nodeMap, id) => {
        const type = nodeMap.get('type') as string;
        if (type === 'pool' || type === 'lane') return;
        children.push({
          id,
          width: (nodeMap.get('width') as number) || DEFAULT_NODE_WIDTH,
          height: (nodeMap.get('height') as number) || DEFAULT_NODE_HEIGHT,
          locked: getNodeLockMode(nodeMap) !== 'none',
        });
      });
      const elkEdges: Array<{ id: string; sources: string[]; targets: string[] }> = [];
      edgesMap.forEach((edgeMap, id) => {
        const source = edgeMap.get('source') as string;
        const target = edgeMap.get('target') as string;
        if (source && target) elkEdges.push({ id, sources: [source], targets: [target] });
      });
      return { children, elkEdges };
    });

    const layoutRes = await elkInstance.layout({
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': input.direction || 'RIGHT',
        'elk.spacing.nodeNode': '60',
        'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      },
      children: graph.children.map((c) => ({ id: c.id, width: c.width, height: c.height })),
      edges: graph.elkEdges,
    });

    const lockedIds = new Set(graph.children.filter((c) => c.locked).map((c) => c.id));
    const batchId = this.newBatchId('ai-layout');

    const outcome = await this.writer.mutate(input.diagramId, `ai:${batchId}`, (doc) => {
      const nodesMap = doc.getMap<Y.Map<unknown>>('nodes');
      const diffs: AiBatchEntityDiff[] = [];
      const warnings: string[] = [];

      for (const child of layoutRes.children ?? []) {
        const nodeMap = nodesMap.get(child.id);
        if (!nodeMap) continue;
        if (lockedIds.has(child.id)) {
          warnings.push(`节点 ${child.id} 已锁定坐标，排版保持原位`);
          continue;
        }
        const before = snapshotMap(nodeMap);
        nodeMap.set('position', { x: child.x ?? 0, y: child.y ?? 0 });
        const after = snapshotMap(nodeMap);
        if (!deepEqual(before, after)) {
          diffs.push({
            entityId: child.id,
            entityType: 'node',
            opType: 'update',
            beforeState: before,
            afterState: after,
          });
        }
      }

      return { diffs, warnings };
    });

    if (outcome.result.diffs.length > 0) {
      this.batchManager.recordBatch({
        batchId,
        diagramId: input.diagramId,
        agentName: input.agentName,
        summary: `AI 自动排版调整了 ${outcome.result.diffs.length} 个节点坐标`,
        status: 'active',
        diffs: outcome.result.diffs,
        createdAt: new Date().toISOString(),
      });
    }

    return {
      success: true,
      batchId,
      message: '服务端排版完成',
      warnings: outcome.result.warnings,
      live: outcome.live,
    };
  }
}

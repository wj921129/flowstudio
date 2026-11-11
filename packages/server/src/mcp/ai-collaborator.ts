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
const LAYOUT_PADDING = 40;
const LANE_HEADER_SIZE = 40;

type LayoutPoint = { x: number; y: number };

function getMapDimensions(map: Y.Map<unknown>): { width: number; height: number } {
  return {
    width: (map.get('width') as number) || DEFAULT_NODE_WIDTH,
    height: (map.get('height') as number) || DEFAULT_NODE_HEIGHT,
  };
}

interface SwimlaneChild {
  id: string;
  laneId: string;
  width: number;
  height: number;
}

interface SwimlanePlacement {
  poolSize: { width: number; height: number };
  laneFrames: Map<string, { x: number; y: number; width: number; height: number }>;
  childPositions: Map<string, LayoutPoint>;
}

/**
 * 泳道感知排版：把 ELK 的全局坐标换算为泳道局部坐标，并计算泳道/池的容器几何。
 *
 * 与前端 `elk-layout.ts` 的泳道约定保持一致（前端约定子节点 position 为泳道局部坐标）：
 * - 横向泳道：泳道自上而下堆叠、表头在左，子节点 local.x = global.x - 全局最小 X + padding，
 *   local.y = global.y - 本泳道最小 Y + padding；
 * - 纵向泳道：泳道自左而右排列、表头在上，子节点 local.x = global.x - 本泳道最小 X + padding，
 *   local.y = global.y - 全局最小 Y + padding。
 *
 * 每个子节点都被约束在所属泳道内，且泳道尺寸会撑开到足以容纳全部子节点。
 */
function computeSwimlanePlacement(params: {
  horizontal: boolean;
  laneIds: string[];
  children: SwimlaneChild[];
  globalPositions: Map<string, LayoutPoint>;
  /** 锁定泳道保持原几何，但仍占据实际区间，后续泳道顺延避让 */
  fixedFrames?: Map<string, { x: number; y: number; width: number; height: number }>;
}): SwimlanePlacement {
  const laneChildren = new Map<string, Array<SwimlaneChild & { pos: LayoutPoint }>>();
  for (const laneId of params.laneIds) laneChildren.set(laneId, []);
  for (const child of params.children) {
    const pos = params.globalPositions.get(child.id);
    const bucket = laneChildren.get(child.laneId);
    if (!pos || !bucket) continue;
    bucket.push({ ...child, pos });
  }

  let globalMinX = Infinity;
  let globalMaxX = -Infinity;
  let globalMinY = Infinity;
  let globalMaxY = -Infinity;
  for (const bucket of laneChildren.values()) {
    for (const item of bucket) {
      globalMinX = Math.min(globalMinX, item.pos.x);
      globalMaxX = Math.max(globalMaxX, item.pos.x + item.width);
      globalMinY = Math.min(globalMinY, item.pos.y);
      globalMaxY = Math.max(globalMaxY, item.pos.y + item.height);
    }
  }
  if (globalMinX === Infinity) {
    globalMinX = 0;
    globalMaxX = 800;
    globalMinY = 0;
    globalMaxY = 400;
  }

  const laneFrames: SwimlanePlacement['laneFrames'] = new Map();
  const childPositions: SwimlanePlacement['childPositions'] = new Map();

  let offset = LANE_HEADER_SIZE;
  let crossExtent = params.horizontal ? 800 : 600;

  for (const laneId of params.laneIds) {
    const items = laneChildren.get(laneId)!;
    let innerMinX = Infinity;
    let innerMaxX = -Infinity;
    let innerMinY = Infinity;
    let innerMaxY = -Infinity;
    for (const item of items) {
      innerMinX = Math.min(innerMinX, item.pos.x);
      innerMaxX = Math.max(innerMaxX, item.pos.x + item.width);
      innerMinY = Math.min(innerMinY, item.pos.y);
      innerMaxY = Math.max(innerMaxY, item.pos.y + item.height);
    }

    const fixed = params.fixedFrames?.get(laneId);
    if (fixed) {
      laneFrames.set(laneId, { ...fixed });
      if (params.horizontal) {
        offset = Math.max(offset, fixed.y + fixed.height);
        crossExtent = Math.max(crossExtent, fixed.width);
      } else {
        offset = Math.max(offset, fixed.x + fixed.width);
        crossExtent = Math.max(crossExtent, fixed.height);
      }
      continue;
    }

    let width: number;
    let height: number;
    let x: number;
    let y: number;
    if (params.horizontal) {
      width = Math.max(800, globalMaxX - globalMinX + LAYOUT_PADDING * 2);
      height = Math.max(200, items.length > 0 ? innerMaxY - innerMinY + LAYOUT_PADDING * 2 : 0);
      x = 0;
      y = offset;
      offset += height;
      crossExtent = Math.max(crossExtent, width);
    } else {
      height = Math.max(600, globalMaxY - globalMinY + LAYOUT_PADDING * 2);
      width = Math.max(220, items.length > 0 ? innerMaxX - innerMinX + LAYOUT_PADDING * 2 : 0);
      x = offset;
      y = 0;
      offset += width;
      crossExtent = Math.max(crossExtent, height);
    }
    laneFrames.set(laneId, { x, y, width, height });

    for (const item of items) {
      const localX = params.horizontal
        ? Math.max(LAYOUT_PADDING, item.pos.x - globalMinX + LAYOUT_PADDING)
        : Math.max(LAYOUT_PADDING, item.pos.x - innerMinX + LAYOUT_PADDING);
      const localY = params.horizontal
        ? Math.max(LAYOUT_PADDING, item.pos.y - innerMinY + LAYOUT_PADDING)
        : Math.max(LAYOUT_PADDING, item.pos.y - globalMinY + LAYOUT_PADDING);
      childPositions.set(item.id, { x: localX, y: localY });
    }
  }

  return {
    poolSize: params.horizontal
      ? { width: Math.max(800, crossExtent), height: offset }
      : { width: offset, height: Math.max(600, crossExtent) },
    laneFrames,
    childPositions,
  };
}

/**
 * 按 pool.data.laneOrder 排序泳道，缺失的按当前堆叠坐标补位
 */
function orderLaneIds(
  laneOrder: string[] | undefined,
  lanes: Array<{ id: string; position: LayoutPoint }>,
  horizontal: boolean,
): string[] {
  const existing = new Set(lanes.map((lane) => lane.id));
  const ordered = (laneOrder ?? []).filter((id) => existing.has(id));
  const orderedSet = new Set(ordered);
  const rest = lanes
    .filter((lane) => !orderedSet.has(lane.id))
    .sort((a, b) =>
      horizontal ? a.position.y - b.position.y : a.position.x - b.position.x,
    )
    .map((lane) => lane.id);
  return [...ordered, ...rest];
}

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
    // 仅「图表不存在」返回 null；文档读取/加载失败必须抛出，
    // 避免把内部故障伪装成 not-found 误导 AI 调用方。
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

    // 写入前一次性读取现有文档（锚定锁判定 + 删除 Diff 快照）。
    // mutate 回调必须保持同步纯 Yjs 修改，所有 IO 前移。
    const existing = await this.writer.readDocument(input.diagramId, (doc) => {
      const nodesMap = doc.getMap<Y.Map<unknown>>('nodes');
      const edgesMap = doc.getMap<Y.Map<unknown>>('edges');
      const nodes: Array<{ id: string; fullLocked: boolean; snapshot: Record<string, unknown> }> = [];
      nodesMap.forEach((nodeMap, id) => {
        nodes.push({
          id,
          fullLocked: getNodeLockMode(nodeMap) === 'full',
          snapshot: snapshotMap(nodeMap),
        });
      });
      const edges: Array<{
        id: string;
        source?: string;
        target?: string;
        snapshot: Record<string, unknown>;
      }> = [];
      edgesMap.forEach((edgeMap, id) => {
        edges.push({
          id,
          source: edgeMap.get('source') as string | undefined,
          target: edgeMap.get('target') as string | undefined,
          snapshot: snapshotMap(edgeMap),
        });
      });
      return { nodes, edges };
    });

    this.writer.createSnapshot(input.diagramId, 'AI 生成骨架前快照', 'ai_batch');

    const warnings: string[] = [];
    const keptNodeIds = new Set(
      existing.nodes.filter((node) => node.fullLocked).map((node) => node.id),
    );
    for (const node of existing.nodes) {
      if (node.fullLocked) {
        warnings.push(`节点 ${node.id} 已被人类完全锁定，保留原节点，未参与骨架重建`);
      }
    }

    const existingById = new Map(existing.nodes.map((node) => [node.id, node]));

    // 锚定锁红线：full 锁定节点的本体字段与世界坐标绝对不动。
    // 保留其祖先容器链（lane/pool），锁定节点原样留在原泳道，禁止转浮动改写。
    const protectedNodeIds = new Set(keptNodeIds);
    for (const nodeId of keptNodeIds) {
      let cursor = existingById.get(nodeId)?.snapshot.parentId;
      const visited = new Set<string>([nodeId]);
      while (typeof cursor === 'string' && !visited.has(cursor)) {
        visited.add(cursor);
        const ancestor = existingById.get(cursor);
        if (!ancestor) break;
        if (!protectedNodeIds.has(cursor)) {
          protectedNodeIds.add(cursor);
          const ancestorType = ancestor.snapshot.type;
          const typeName = ancestorType === 'pool'
            ? '泳池'
            : ancestorType === 'lane'
              ? '泳道'
              : ancestorType === 'group'
                ? '分组'
                : '容器';
          warnings.push(`${typeName} ${cursor} 含人工完全锁定节点，已一并保留`);
        }
        cursor = ancestor.snapshot.parentId as string | undefined;
      }
    }

    // 保留容器占据的世界坐标下边界，用于新骨架池下移避让
    let protectedMaxBottom = -Infinity;
    for (const node of existing.nodes) {
      if (!protectedNodeIds.has(node.id)) continue;
      let worldY = (node.snapshot.position as LayoutPoint | undefined)?.y ?? 0;
      let cursor = node.snapshot.parentId as string | undefined;
      const visited = new Set<string>([node.id]);
      while (typeof cursor === 'string' && !visited.has(cursor)) {
        visited.add(cursor);
        const ancestor = existingById.get(cursor);
        if (!ancestor) break;
        worldY += (ancestor.snapshot.position as LayoutPoint | undefined)?.y ?? 0;
        cursor = ancestor.snapshot.parentId as string | undefined;
      }
      const height = (node.snapshot.height as number | undefined) ?? DEFAULT_NODE_HEIGHT;
      protectedMaxBottom = Math.max(protectedMaxBottom, worldY + height);
    }

    const hasLanes = Boolean(input.lanes && input.lanes.length > 0);
    const poolId = hasLanes ? this.newEntityId('pool') : undefined;
    const poolOrigin = protectedMaxBottom === -Infinity
      ? { x: 50, y: 50 }
      : { x: 50, y: Math.max(50, protectedMaxBottom + 100) };
    if (hasLanes && protectedMaxBottom !== -Infinity) {
      warnings.push(
        `已保留含人工锁定节点的旧泳道/泳池，新骨架池下移至 y=${poolOrigin.y} 避免重叠`,
      );
    }
    const laneIds = hasLanes
      ? input.lanes!.map((lane) => lane.id).filter((laneId) => {
          if (protectedNodeIds.has(laneId)) {
            warnings.push(`泳道 ${laneId} 已被人工锁定节点占用，跳过该泳道重建`);
            return false;
          }
          return true;
        })
      : [];
    const placeableLaneIds = new Set(laneIds);

    // 既有锁定节点不参与 ELK 布局，避免占用虚拟落点导致布局失真（S7）
    const layoutNodeIds = new Set(
      input.nodes.filter((node) => !keptNodeIds.has(node.id)).map((node) => node.id),
    );
    const layoutEdges: Array<{ id: string; sources: string[]; targets: string[] }> = [];
    input.edges.forEach((edge, idx) => {
      if (!layoutNodeIds.has(edge.source) || !layoutNodeIds.has(edge.target)) {
        warnings.push(
          `连线端点 ${edge.source} -> ${edge.target} 未纳入本次骨架布局（可能已被人类锁定或不存在），布局阶段忽略`,
        );
        return;
      }
      layoutEdges.push({ id: `e-${idx}`, sources: [edge.source], targets: [edge.target] });
    });

    const layoutResult = await elkInstance.layout({
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.spacing.nodeNode': '60',
        'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      },
      children: input.nodes
        .filter((node) => !keptNodeIds.has(node.id))
        .map((n) => ({ id: n.id, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT })),
      edges: layoutEdges,
    });

    const posMap = new Map<string, { x: number; y: number }>();
    for (const child of layoutResult.children ?? []) {
      posMap.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
    }

    // ELK 只产出全局坐标；这里按泳道分组换算为泳道局部坐标，
    // 确保写入带 parentId 的子节点后能真正落在泳道容器内。
    const placement = laneIds.length > 0
      ? computeSwimlanePlacement({
          horizontal: true,
          laneIds,
          children: input.nodes
            .filter(
              (node) =>
                node.laneId
                && placeableLaneIds.has(node.laneId)
                && !keptNodeIds.has(node.id),
            )
            .map((node) => ({
              id: node.id,
              laneId: node.laneId!,
              width: DEFAULT_NODE_WIDTH,
              height: DEFAULT_NODE_HEIGHT,
            })),
          globalPositions: posMap,
        })
      : null;

    const poolHeight = placement?.poolSize.height
      ?? LANE_HEADER_SIZE + (input.lanes?.length ?? 0) * 200;

    // 未归属任何泳道的节点排到池下方，避免与泳道容器重叠
    const floatingPositions = new Map<string, LayoutPoint>();
    if (hasLanes) {
      const floatingNodes = input.nodes
        .filter((node) => !placement?.childPositions.has(node.id))
        .sort((a, b) => (posMap.get(a.id)?.x ?? 0) - (posMap.get(b.id)?.x ?? 0));
      floatingNodes.forEach((node, index) => {
        floatingPositions.set(node.id, {
          x: poolOrigin.x + index * (DEFAULT_NODE_WIDTH + INSERT_GAP),
          y: poolOrigin.y + poolHeight + 100,
        });
      });
    }

    const batchId = this.newBatchId('ai-scaffold');
    const outcome = await this.writer.mutate(input.diagramId, `ai:${batchId}`, (doc) => {
      const nodesMap = doc.getMap<Y.Map<unknown>>('nodes');
      const edgesMap = doc.getMap<Y.Map<unknown>>('edges');
      const metaMap = doc.getMap<unknown>('meta');
      const diffs: AiBatchEntityDiff[] = [];

      // 锁定节点及其祖先容器链原样保留，本体字段与世界坐标零改写
      for (const node of existing.nodes) {
        if (protectedNodeIds.has(node.id)) continue;
        diffs.push({
          entityId: node.id,
          entityType: 'node',
          opType: 'delete',
          beforeState: node.snapshot,
          afterState: null,
        });
        nodesMap.delete(node.id);
      }
      for (const edge of existing.edges) {
        const keepForLocked = Boolean(
          edge.source && edge.target && protectedNodeIds.has(edge.source) && protectedNodeIds.has(edge.target),
        );
        if (keepForLocked) continue;
        diffs.push({
          entityId: edge.id,
          entityType: 'edge',
          opType: 'delete',
          beforeState: edge.snapshot,
          afterState: null,
        });
        edgesMap.delete(edge.id);
      }

      if (input.title) {
        metaMap.set('title', input.title.trim());
      }

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
        poolMap.set('position', { ...poolOrigin });
        poolMap.set('width', placement?.poolSize.width ?? 900);
        poolMap.set('height', placement?.poolSize.height ?? poolHeight);
        poolMap.set('data', {
          label: input.title || '业务泳道池',
          type: 'pool',
          orientation: 'horizontal',
          laneOrder: input.lanes!.map((l) => l.id).filter((id) => placeableLaneIds.has(id)),
          headerSize: LANE_HEADER_SIZE,
        });
        registerNode(poolId, poolMap);

        input.lanes!.forEach((lane, idx) => {
          if (!placeableLaneIds.has(lane.id)) return;
          const frame = placement?.laneFrames.get(lane.id);
          const laneMap = new Y.Map<unknown>();
          laneMap.set('id', lane.id);
          laneMap.set('type', 'lane');
          laneMap.set('parentId', poolId);
          laneMap.set('extent', 'parent');
          laneMap.set('position', frame
            ? { x: frame.x, y: frame.y }
            : { x: 0, y: LANE_HEADER_SIZE + idx * 200 });
          laneMap.set('width', frame?.width ?? 900);
          laneMap.set('height', frame?.height ?? 200);
          laneMap.set('data', { label: lane.label, type: 'lane', laneTitle: lane.label });
          registerNode(lane.id, laneMap);
        });
      }

      for (const node of input.nodes) {
        if (nodesMap.has(node.id)) {
          warnings.push(`节点 ${node.id} 已存在（可能为完全锁定节点），跳过重建`);
          continue;
        }
        const nodeMap = new Y.Map<unknown>();
        nodeMap.set('id', node.id);
        nodeMap.set('type', node.type || 'process');
        nodeMap.set(
          'position',
          placement?.childPositions.get(node.id)
            ?? floatingPositions.get(node.id)
            ?? posMap.get(node.id)
            ?? { x: 50, y: 50 },
        );
        nodeMap.set('width', DEFAULT_NODE_WIDTH);
        nodeMap.set('height', DEFAULT_NODE_HEIGHT);
        if (node.laneId && placeableLaneIds.has(node.laneId)) {
          nodeMap.set('parentId', node.laneId);
          nodeMap.set('extent', 'parent');
        } else if (node.laneId) {
          warnings.push(`目标泳道 ${node.laneId} 未在本次骨架中创建，节点 ${node.id} 按浮动放置`);
        }
        nodeMap.set('data', { label: node.label, type: node.type || 'process' });
        registerNode(node.id, nodeMap);
      }

      input.edges.forEach((edge) => {
        if (!nodesMap.has(edge.source) || !nodesMap.has(edge.target)) {
          warnings.push(`连线端点不存在 (${edge.source} -> ${edge.target})，跳过创建`);
          return;
        }
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

      return { diffs, warnings };
    });

    this.batchManager.recordBatch({
      batchId,
      diagramId: input.diagramId,
      agentName: input.agentName,
      summary: `AI 生成骨架：${input.nodes.length} 个节点、${input.edges.length} 条连线`,
      status: 'active',
      diffs: outcome.result.diffs,
      createdAt: new Date().toISOString(),
    });

    return {
      success: true,
      batchId,
      message: `已成功生成包含 ${input.nodes.length} 个节点、${input.edges.length} 条连线的骨架`,
      warnings: outcome.result.warnings,
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

    this.writer.createSnapshot(input.diagramId, 'AI 增量修改前快照', 'ai_batch');

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

      const hasFullLockedDescendant = (containerId: string): boolean => {
        const children = new Map<string, string[]>();
        nodesMap.forEach((map, id) => {
          const parentId = map.get('parentId');
          if (typeof parentId !== 'string') return;
          const bucket = children.get(parentId);
          if (bucket) bucket.push(id);
          else children.set(parentId, [id]);
        });
        const stack = [...(children.get(containerId) ?? [])];
        const visited = new Set<string>();
        while (stack.length > 0) {
          const currentId = stack.pop()!;
          if (visited.has(currentId)) continue;
          visited.add(currentId);
          const map = nodesMap.get(currentId);
          if (!map) continue;
          if (getNodeLockMode(map) === 'full') return true;
          stack.push(...(children.get(currentId) ?? []));
        }
        return false;
      };

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
            if (hasFullLockedDescendant(op.id)) {
              warnings.push(
                `容器 ${op.id}(${nodeLabel(nodeMap)}) 内含人工锁定节点，禁止整体删除`,
              );
              break;
            }

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

            // 沿 parentId 链累加容器坐标：节点 world = 自身局部坐标 + 各祖先 position
            const getWorldOrigin = (nodeMap: Y.Map<unknown>): LayoutPoint => {
              let origin: LayoutPoint = { x: 0, y: 0 };
              let current: Y.Map<unknown> | undefined = nodeMap;
              const visited = new Set<Y.Map<unknown>>();
              while (current && !visited.has(current)) {
                visited.add(current);
                const parentId = current.get('parentId');
                if (typeof parentId !== 'string') break;
                const parent = nodesMap.get(parentId);
                if (!parent) break;
                const parentPos = (parent.get('position') as LayoutPoint | undefined) ?? { x: 0, y: 0 };
                origin = { x: origin.x + parentPos.x, y: origin.y + parentPos.y };
                current = parent;
              }
              return origin;
            };
            const getWorldPosition = (nodeMap: Y.Map<unknown>): LayoutPoint => {
              const pos = (nodeMap.get('position') as LayoutPoint | undefined) ?? { x: 0, y: 0 };
              const origin = getWorldOrigin(nodeMap);
              return { x: pos.x + origin.x, y: pos.y + origin.y };
            };

            const sourceWorld = getWorldPosition(sourceMap);
            const targetWorld = getWorldPosition(targetMap);

            let laneId = op.node.laneId ?? (sourceMap.get('parentId') as string | undefined);
            if (typeof laneId === 'string') {
              const laneMap = nodesMap.get(laneId);
              if (!laneMap || laneMap.get('type') !== 'lane') {
                warnings.push(`目标泳道 ${laneId} 不存在，节点按浮动坐标创建`);
                laneId = undefined;
              }
            }
            const laneOrigin = typeof laneId === 'string'
              ? getWorldPosition(nodesMap.get(laneId)!)
              : { x: 0, y: 0 };

            // 落点统一在世界坐标系计算，再换算回目标泳道局部坐标；
            // 跨泳道插入时局部坐标不得为负，按泳道内边距收敛。
            const newNodeWorld: LayoutPoint =
              direction === 'DOWN'
                ? { x: sourceWorld.x, y: sourceWorld.y + DEFAULT_NODE_HEIGHT + INSERT_GAP }
                : { x: sourceWorld.x + DEFAULT_NODE_WIDTH + INSERT_GAP, y: sourceWorld.y };
            const newNodePos: LayoutPoint = typeof laneId === 'string'
              ? {
                  x: Math.max(LAYOUT_PADDING, newNodeWorld.x - laneOrigin.x),
                  y: Math.max(LAYOUT_PADDING, newNodeWorld.y - laneOrigin.y),
                }
              : newNodeWorld;

            createNodeMap({
              id: nodeId,
              type: op.node.type || 'process',
              label: op.node.label,
              position: newNodePos,
              laneId,
              style: op.node.style,
            });

            // 删除原有的 source -> target 连线（先提取分支标签，如「是/否」）
            const originalEdgeIds: string[] = [];
            edgesMap.forEach((edgeMap, edgeId) => {
              if (edgeMap.get('source') === op.source && edgeMap.get('target') === op.target) {
                originalEdgeIds.push(edgeId);
              }
            });

            let inheritedLabel: string | undefined;
            for (const edgeId of originalEdgeIds) {
              const edgeMap = edgesMap.get(edgeId);
              if (!edgeMap) continue;
              const data = (edgeMap.get('data') as Record<string, unknown> | undefined) ?? {};
              const raw = data.label ?? edgeMap.get('label');
              if (typeof raw === 'string' && raw.trim()) {
                inheritedLabel = raw;
                break;
              }
            }

            for (const edgeId of originalEdgeIds) {
              const edgeMap = edgesMap.get(edgeId);
              if (edgeMap) {
                recordDelete('edge', edgeId, snapshotMap(edgeMap));
                edgesMap.delete(edgeId);
              }
            }

            // 上游边继承原分支标签；下游边仅在显式指定时带标签（与前端断线串接语义一致）
            createEdgeMap(
              op.source,
              nodeId,
              op.upstreamLabel ?? op.edgeLabel ?? inheritedLabel,
            );
            createEdgeMap(
              nodeId,
              op.target,
              op.downstreamLabel ?? op.edgeLabel,
            );

            // 下游同流向局部顺推（先建一次邻接索引，避免 BFS 内逐节点全量扫边）
            const outgoing = new Map<string, string[]>();
            edgesMap.forEach((edgeMap) => {
              const source = edgeMap.get('source');
              const target = edgeMap.get('target');
              if (typeof source !== 'string' || typeof target !== 'string') return;
              const bucket = outgoing.get(source);
              if (bucket) bucket.push(target);
              else outgoing.set(source, [target]);
            });

            const downstream = new Set<string>();
            const queue = [op.target];
            while (queue.length > 0) {
              const currentId = queue.shift()!;
              if (downstream.has(currentId)) continue;
              downstream.add(currentId);
              for (const nextId of outgoing.get(currentId) ?? []) {
                if (nextId && nextId !== nodeId && nextId !== op.source && !downstream.has(nextId)) {
                  queue.push(nextId);
                }
              }
            }

            const lockedRelated = new Set<string>();
            const markLockedChain = (startId: string) => {
              let cursor: string | undefined = startId;
              const seen = new Set<string>();
              while (cursor && !seen.has(cursor)) {
                seen.add(cursor);
                lockedRelated.add(cursor);
                cursor = nodesMap.get(cursor)?.get('parentId') as string | undefined;
              }
            };
            nodesMap.forEach((map, id) => {
              if (getNodeLockMode(map) !== 'none') markLockedChain(id);
            });
            const underLockedAncestor = (id: string): boolean => {
              let cursor = nodesMap.get(id)?.get('parentId') as string | undefined;
              const seen = new Set<string>([id]);
              while (cursor && !seen.has(cursor)) {
                seen.add(cursor);
                if (getNodeLockMode(nodesMap.get(cursor)) !== 'none') return true;
                cursor = nodesMap.get(cursor)?.get('parentId') as string | undefined;
              }
              return false;
            };

            const minTargetMain =
              direction === 'DOWN'
                ? newNodeWorld.y + DEFAULT_NODE_HEIGHT + INSERT_GAP
                : newNodeWorld.x + DEFAULT_NODE_WIDTH + INSERT_GAP;
            const currentMain = direction === 'DOWN' ? targetWorld.y : targetWorld.x;
            const shift = minTargetMain - currentMain;

            if (shift > 0) {
              for (const downstreamId of downstream) {
                const nodeMap = nodesMap.get(downstreamId);
                if (!nodeMap) continue;
                const type = nodeMap.get('type');
                if (type === 'pool' || type === 'lane') continue;
                if (
                  getNodeLockMode(nodeMap) !== 'none'
                  || lockedRelated.has(downstreamId)
                  || underLockedAncestor(downstreamId)
                ) {
                  warnings.push(
                    `节点 ${downstreamId}(${nodeLabel(nodeMap)}) 位于锁定容器内或已锁定，未参与下游顺推`,
                  );
                  continue;
                }
                const before = snapshotMap(nodeMap);
                // 推挤量按世界坐标累加，再换算回该节点所属泳道的局部坐标
                const world = getWorldPosition(nodeMap);
                const origin = getWorldOrigin(nodeMap);
                nodeMap.set(
                  'position',
                  direction === 'DOWN'
                    ? { x: world.x - origin.x, y: world.y + shift - origin.y }
                    : { x: world.x + shift - origin.x, y: world.y - origin.y },
                );
                recordUpdate('node', downstreamId, before, snapshotMap(nodeMap));
              }
            }

            // 顺推可能把节点推出泳道边界：同步撑开受影响泳道及其所属泳池
            const bumpSize = (nodeMap: Y.Map<unknown>, width: number, height: number) => {
              nodeMap.set('width', width);
              nodeMap.set('height', height);
              const style = nodeMap.get('style');
              if (style && typeof style === 'object') {
                nodeMap.set('style', { ...(style as Record<string, unknown>), width, height });
              }
            };

            const affectedLaneIds = new Set<string>();
            for (const affectedId of [nodeId, op.target, ...downstream]) {
              const parentId = nodesMap.get(affectedId)?.get('parentId');
              if (typeof parentId === 'string' && nodesMap.get(parentId)?.get('type') === 'lane') {
                affectedLaneIds.add(parentId);
              }
            }

            // 一次扫描收集受影响泳道的子节点边界，避免逐泳道全量遍历
            const laneChildExtents = new Map<string, { right: number; bottom: number }>();
            nodesMap.forEach((childMap, childId) => {
              const parentId = childMap.get('parentId');
              if (typeof parentId !== 'string' || !affectedLaneIds.has(parentId)) return;
              if (childId === parentId) return;
              const childType = childMap.get('type');
              if (childType === 'pool' || childType === 'lane') return;
              const pos = (childMap.get('position') as LayoutPoint | undefined) ?? { x: 0, y: 0 };
              const size = getMapDimensions(childMap);
              const extent = laneChildExtents.get(parentId) ?? { right: 0, bottom: 0 };
              extent.right = Math.max(extent.right, pos.x + size.width);
              extent.bottom = Math.max(extent.bottom, pos.y + size.height);
              laneChildExtents.set(parentId, extent);
            });

            for (const affectedLaneId of affectedLaneIds) {
              const laneMap = nodesMap.get(affectedLaneId);
              const extent = laneChildExtents.get(affectedLaneId);
              if (!laneMap || !extent) continue;

              // 锚定锁裁决：position/full 锁定泳道自身禁止被 AI 撑开
              if (getNodeLockMode(laneMap) !== 'none') {
                warnings.push(`泳道 ${affectedLaneId} 已锁定，跳过自动撑开`);
                continue;
              }

              const beforeLane = snapshotMap(laneMap);
              const laneSize = getMapDimensions(laneMap);
              const nextLaneW = Math.max(laneSize.width, extent.right + LAYOUT_PADDING);
              const nextLaneH = Math.max(laneSize.height, extent.bottom + LAYOUT_PADDING);
              if (nextLaneW !== laneSize.width || nextLaneH !== laneSize.height) {
                bumpSize(laneMap, nextLaneW, nextLaneH);
                recordUpdate('node', affectedLaneId, beforeLane, snapshotMap(laneMap));
              }
            }

            // 撑开泳道后按 laneOrder 重新堆叠同池兄弟泳道，避免与相邻泳道重叠
            const touchedPoolIds = new Set<string>();
            for (const affectedLaneId of affectedLaneIds) {
              const poolId = nodesMap.get(affectedLaneId)?.get('parentId');
              if (typeof poolId === 'string' && nodesMap.get(poolId)?.get('type') === 'pool') {
                touchedPoolIds.add(poolId);
              }
            }

            const lanesWithLockedChild = new Set<string>();
            for (const relatedId of lockedRelated) {
              const relatedMap = nodesMap.get(relatedId);
              if (relatedMap?.get('type') === 'lane' && getNodeLockMode(relatedMap) === 'none') {
                lanesWithLockedChild.add(relatedId);
              }
            }

            for (const poolId of touchedPoolIds) {
              const poolMap = nodesMap.get(poolId);
              if (!poolMap) continue;

              const poolData = (poolMap.get('data') as Record<string, unknown> | undefined) ?? {};
              const isHorizontal = (poolData.orientation ?? 'horizontal') !== 'vertical';
              const headerSize = typeof poolData.headerSize === 'number'
                ? poolData.headerSize
                : LANE_HEADER_SIZE;

              const siblingLanes: Array<{ id: string; map: Y.Map<unknown> }> = [];
              nodesMap.forEach((map, id) => {
                if (map.get('type') === 'lane' && map.get('parentId') === poolId) {
                  siblingLanes.push({ id, map });
                }
              });
              const laneOrder = orderLaneIds(
                Array.isArray(poolData.laneOrder) ? (poolData.laneOrder as string[]) : undefined,
                siblingLanes.map((lane) => ({
                  id: lane.id,
                  position: (lane.map.get('position') as LayoutPoint | undefined) ?? { x: 0, y: 0 },
                })),
                isHorizontal,
              );

              // 按重叠增量顺延：仅消除重叠部分，保留人工间距与自定义偏移
              let cursor = headerSize;
              let crossExtent = 0;
              for (const orderedLaneId of laneOrder) {
                const lane = siblingLanes.find((item) => item.id === orderedLaneId);
                if (!lane) continue;
                const size = getMapDimensions(lane.map);
                const currentPos = (lane.map.get('position') as LayoutPoint | undefined) ?? { x: 0, y: 0 };
                const mustStay =
                  getNodeLockMode(lane.map) !== 'none' || lanesWithLockedChild.has(orderedLaneId);
                const baseline = isHorizontal ? currentPos.y : currentPos.x;
                const targetMain = mustStay ? baseline : Math.max(baseline, cursor);

                if (targetMain !== baseline) {
                  const beforeLane = snapshotMap(lane.map);
                  lane.map.set(
                    'position',
                    isHorizontal
                      ? { x: currentPos.x, y: targetMain }
                      : { x: targetMain, y: currentPos.y },
                  );
                  recordUpdate('node', orderedLaneId, beforeLane, snapshotMap(lane.map));
                }
                cursor = Math.max(
                  cursor,
                  targetMain + (isHorizontal ? size.height : size.width),
                );
                crossExtent = Math.max(
                  crossExtent,
                  isHorizontal ? currentPos.x + size.width : currentPos.y + size.height,
                );
              }

              const beforePool = snapshotMap(poolMap);
              const poolSize = getMapDimensions(poolMap);
              const nextPoolW = Math.max(poolSize.width, isHorizontal ? crossExtent : cursor);
              const nextPoolH = Math.max(poolSize.height, isHorizontal ? cursor : crossExtent);
              if (nextPoolW !== poolSize.width || nextPoolH !== poolSize.height) {
                bumpSize(poolMap, nextPoolW, nextPoolH);
                recordUpdate('node', poolId, beforePool, snapshotMap(poolMap));
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

    this.writer.createSnapshot(input.diagramId, '服务端自动排版前快照', 'manual');

    const graph = await this.writer.readDocument(input.diagramId, (doc) => {
      const nodesMap = doc.getMap<Y.Map<unknown>>('nodes');
      const edgesMap = doc.getMap<Y.Map<unknown>>('edges');
      const children: Array<{
        id: string;
        parentId?: string;
        position: LayoutPoint;
        width: number;
        height: number;
        locked: boolean;
      }> = [];
      const pools: Array<{
        id: string;
        position: LayoutPoint;
        width: number;
        height: number;
        horizontal: boolean;
        laneOrder: string[];
        locked: boolean;
      }> = [];
      const lanes: Array<{
        id: string;
        parentId?: string;
        position: LayoutPoint;
        width: number;
        height: number;
        locked: boolean;
      }> = [];

      nodesMap.forEach((nodeMap, id) => {
        const type = nodeMap.get('type') as string;
        const size = getMapDimensions(nodeMap);
        if (type === 'pool') {
          const data = (nodeMap.get('data') as Record<string, unknown> | undefined) ?? {};
          pools.push({
            id,
            position: (nodeMap.get('position') as LayoutPoint | undefined) ?? { x: 0, y: 0 },
            width: size.width,
            height: size.height,
            horizontal: (data.orientation ?? 'horizontal') !== 'vertical',
            laneOrder: Array.isArray(data.laneOrder) ? (data.laneOrder as string[]) : [],
            locked: getNodeLockMode(nodeMap) !== 'none',
          });
          return;
        }
        if (type === 'lane') {
          lanes.push({
            id,
            parentId: nodeMap.get('parentId') as string | undefined,
            position: (nodeMap.get('position') as LayoutPoint | undefined) ?? { x: 0, y: 0 },
            width: size.width,
            height: size.height,
            locked: getNodeLockMode(nodeMap) !== 'none',
          });
          return;
        }
        children.push({
          id,
          parentId: nodeMap.get('parentId') as string | undefined,
          position: (nodeMap.get('position') as LayoutPoint | undefined) ?? { x: 0, y: 0 },
          width: size.width,
          height: size.height,
          locked: getNodeLockMode(nodeMap) !== 'none',
        });
      });

      const elkEdges: Array<{ id: string; sources: string[]; targets: string[] }> = [];
      edgesMap.forEach((edgeMap, id) => {
        const source = edgeMap.get('source') as string;
        const target = edgeMap.get('target') as string;
        if (source && target) elkEdges.push({ id, sources: [source], targets: [target] });
      });
      return { children, pools, lanes, elkEdges };
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

    const globalPositions = new Map<string, LayoutPoint>();
    for (const child of layoutRes.children ?? []) {
      globalPositions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
    }

    const lockedIds = new Set(graph.children.filter((c) => c.locked).map((c) => c.id));

    // 锁定子节点实际坐标不会移动，泳道 sizing 必须用其实际世界坐标约束，
    // 否则会按 ELK 虚拟落点留出错误空档或与移动后的兄弟节点重叠。
    const laneById = new Map(graph.lanes.map((lane) => [lane.id, lane]));
    const poolById = new Map(graph.pools.map((pool) => [pool.id, pool]));

    const parentOf = new Map<string, string | undefined>();
    graph.pools.forEach((pool) => parentOf.set(pool.id, undefined));
    graph.lanes.forEach((lane) => parentOf.set(lane.id, lane.parentId));
    graph.children.forEach((child) => parentOf.set(child.id, child.parentId));
    const lockedAny = new Set<string>([
      ...graph.pools.filter((pool) => pool.locked).map((pool) => pool.id),
      ...graph.lanes.filter((lane) => lane.locked).map((lane) => lane.id),
      ...lockedIds,
    ]);
    const frozenIds = new Set<string>();
    const markAncestorChain = (startId: string) => {
      let cursor: string | undefined = startId;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        frozenIds.add(cursor);
        cursor = parentOf.get(cursor);
      }
    };
    lockedAny.forEach(markAncestorChain);
    for (const child of graph.children) {
      let cursor: string | undefined = parentOf.get(child.id);
      const seen = new Set<string>([child.id]);
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        if (lockedAny.has(cursor)) {
          markAncestorChain(child.id);
          break;
        }
        cursor = parentOf.get(cursor);
      }
    }
    const sizingPositions = new Map(globalPositions);
    for (const child of graph.children) {
      if (!child.locked || !child.parentId) continue;
      const lane = laneById.get(child.parentId);
      if (!lane) continue;
      const pool = lane.parentId ? poolById.get(lane.parentId) : undefined;
      sizingPositions.set(child.id, {
        x: child.position.x + lane.position.x + (pool?.position.x ?? 0),
        y: child.position.y + lane.position.y + (pool?.position.y ?? 0),
      });
    }

    const laneHasLockedChild = new Set<string>();
    for (const frozenId of frozenIds) {
      const frozenLane = laneById.get(frozenId);
      if (frozenLane && !frozenLane.locked) laneHasLockedChild.add(frozenId);
    }

    // 预先计算容器几何与子节点局部坐标，mutate 回调内只做同步 Yjs 写入
    const poolUpdates = new Map<string, { width: number; height: number }>();
    const laneUpdates = new Map<string, { x: number; y: number; width: number; height: number }>();
    const childPositions = new Map<string, LayoutPoint>();
    const planWarnings: string[] = [];
    const handledLaneIds = new Set<string>();

    for (const pool of graph.pools) {
      const poolLanes = graph.lanes.filter((lane) => lane.parentId === pool.id);
      if (poolLanes.length === 0) continue;
      const laneIds = orderLaneIds(pool.laneOrder, poolLanes, pool.horizontal);
      for (const laneId of laneIds) handledLaneIds.add(laneId);

      if (pool.locked) {
        planWarnings.push(`泳池 ${pool.id} 已锁定，排版保持原位`);
        continue;
      }

      const laneChildren = graph.children.filter(
        (child) => child.parentId && laneIds.includes(child.parentId),
      );
      const fixedLaneFrames = new Map<
        string,
        { x: number; y: number; width: number; height: number }
      >();
      for (const lane of poolLanes) {
        const fixedByLock = lane.locked;
        const fixedByChild = laneHasLockedChild.has(lane.id);
        if (!fixedByLock && !fixedByChild) continue;
        fixedLaneFrames.set(lane.id, {
          x: lane.position.x,
          y: lane.position.y,
          width: lane.width,
          height: lane.height,
        });
        planWarnings.push(
          fixedByLock
            ? `泳道 ${lane.id} 已锁定，排版保持原位`
            : `泳道 ${lane.id} 含锁定子节点，排版保持原位`,
        );
      }
      const placement = computeSwimlanePlacement({
        horizontal: pool.horizontal,
        laneIds,
        children: laneChildren.map((child) => ({
          id: child.id,
          laneId: child.parentId!,
          width: child.width,
          height: child.height,
        })),
        globalPositions: sizingPositions,
        fixedFrames: fixedLaneFrames,
      });
      poolUpdates.set(pool.id, placement.poolSize);

      for (const laneId of laneIds) {
        const lane = poolLanes.find((item) => item.id === laneId)!;
        // 锁定泳道与含锁定子节点的泳道保持原 position，且不重排其子节点
        if (lane.locked || laneHasLockedChild.has(laneId)) continue;
        const frame = placement.laneFrames.get(laneId);
        if (frame) laneUpdates.set(laneId, frame);
        for (const child of laneChildren) {
          if (child.parentId !== laneId) continue;
          const pos = placement.childPositions.get(child.id);
          if (pos) childPositions.set(child.id, pos);
        }
      }
    }

    // 独立泳道（未挂在 pool 下）：按内容撑开自身尺寸，子节点换算为局部坐标
    for (const lane of graph.lanes) {
      if (handledLaneIds.has(lane.id)) continue;
      if (lane.locked || laneHasLockedChild.has(lane.id)) {
        planWarnings.push(
          lane.locked
            ? `泳道 ${lane.id} 已锁定，排版保持原位`
            : `泳道 ${lane.id} 含锁定子节点，排版保持原位`,
        );
        continue;
      }
      const laneChildren = graph.children.filter((child) => child.parentId === lane.id);
      if (laneChildren.length === 0) continue;

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const child of laneChildren) {
        const pos = sizingPositions.get(child.id);
        if (!pos) continue;
        minX = Math.min(minX, pos.x);
        maxX = Math.max(maxX, pos.x + child.width);
        minY = Math.min(minY, pos.y);
        maxY = Math.max(maxY, pos.y + child.height);
      }
      if (minX === Infinity) continue;

      laneUpdates.set(lane.id, {
        x: lane.position.x,
        y: lane.position.y,
        width: Math.max(lane.width, maxX - minX + LAYOUT_PADDING * 2),
        height: Math.max(lane.height, maxY - minY + LAYOUT_PADDING * 2),
      });
      for (const child of laneChildren) {
        const pos = sizingPositions.get(child.id);
        if (!pos) continue;
        childPositions.set(child.id, {
          x: Math.max(LAYOUT_PADDING, pos.x - minX + LAYOUT_PADDING),
          y: Math.max(LAYOUT_PADDING, pos.y - minY + LAYOUT_PADDING),
        });
      }
    }

    for (const child of graph.children) {
      if (childPositions.has(child.id) || frozenIds.has(child.id)) continue;
      if (child.parentId && graph.lanes.some((lane) => lane.id === child.parentId)) continue;
      const pos = sizingPositions.get(child.id);
      if (pos) childPositions.set(child.id, pos);
    }

    const batchId = this.newBatchId('ai-layout');

    const outcome = await this.writer.mutate(input.diagramId, `ai:${batchId}`, (doc) => {
      const nodesMap = doc.getMap<Y.Map<unknown>>('nodes');
      const diffs: AiBatchEntityDiff[] = [];
      const warnings: string[] = [...planWarnings];

      const recordPositionPatch = (entityId: string, patch: () => void) => {
        const nodeMap = nodesMap.get(entityId);
        if (!nodeMap) return;
        const before = snapshotMap(nodeMap);
        patch();
        const after = snapshotMap(nodeMap);
        if (!deepEqual(before, after)) {
          diffs.push({
            entityId,
            entityType: 'node',
            opType: 'update',
            beforeState: before,
            afterState: after,
          });
        }
      };

      const patchSize = (nodeMap: Y.Map<unknown>, width: number, height: number) => {
        nodeMap.set('width', width);
        nodeMap.set('height', height);
        const style = nodeMap.get('style');
        if (style && typeof style === 'object') {
          nodeMap.set('style', { ...(style as Record<string, unknown>), width, height });
        }
      };

      for (const [poolId, size] of poolUpdates) {
        recordPositionPatch(poolId, () => {
          patchSize(nodesMap.get(poolId)!, size.width, size.height);
        });
      }

      for (const [laneId, frame] of laneUpdates) {
        recordPositionPatch(laneId, () => {
          const laneMap = nodesMap.get(laneId)!;
          laneMap.set('position', { x: frame.x, y: frame.y });
          patchSize(laneMap, frame.width, frame.height);
        });
      }

      for (const child of graph.children) {
        if (lockedIds.has(child.id) || frozenIds.has(child.id)) {
          warnings.push(
            lockedIds.has(child.id)
              ? `节点 ${child.id} 已锁定坐标，排版保持原位`
              : `节点 ${child.id} 位于锁定容器内，排版保持原位`,
          );
          continue;
        }
        const pos = childPositions.get(child.id);
        if (!pos) continue;
        recordPositionPatch(child.id, () => {
          nodesMap.get(child.id)!.set('position', { x: pos.x, y: pos.y });
        });
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

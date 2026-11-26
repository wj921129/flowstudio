import * as Y from 'yjs';
import {
  type AiBatchEntityDiff,
  alignWaypointsToAnchors,
  type EdgeStrokeStyle,
  type FlowEdge,
  type FlowNode,
  hasExplicitBorderOffset,
  pickEdgePortsForConnect,
  resolveNodeWorldBoxes,
  type XYPosition,
} from '@flowstudio/shared';
import type { DiagramRepository } from '../db/diagram-repository.js';
import type { AiBatchManager } from '../collaboration/ai-batch-manager.js';
import type { DocumentWriter } from '../collaboration/document-writer.js';
import { deepEqual, getNodeLockMode, snapshotMap } from '../collaboration/entity-state.js';
import type { McpOp } from './types.js';
import {
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  getMapDimensions,
  INSERT_GAP,
  LANE_HEADER_SIZE,
  LAYOUT_PADDING,
  type LayoutPoint,
  orderLaneIds,
} from './swimlane-geometry.js';
import { inspectDiagramSemantics } from './diagram-inspector.js';

export interface OpExecutorContext {
  repo: DiagramRepository;
  writer: DocumentWriter;
  batchManager: AiBatchManager;
  withAiAwareness: <T>(
    diagramId: string,
    agentName: string | undefined,
    summary: string,
    targetNodeIds: string[],
    action: () => Promise<T>,
  ) => Promise<T>;
  newBatchId: (prefix?: string) => string;
  newEntityId: (prefix: string) => string;
}

export interface ApplyOpsInput {
  diagramId: string;
  agentName?: string;
  atomic?: boolean;
  ops: McpOp[];
}

export async function executeApplyOps(ctx: OpExecutorContext, input: ApplyOpsInput) {
  if (!ctx.repo.getDiagramById(input.diagramId)) {
    throw new Error(`图表 ${input.diagramId} 不存在`);
  }

  const targetNodeIds: string[] = [];
  for (const op of input.ops) {
    if ('id' in op && typeof (op as any).id === 'string') targetNodeIds.push((op as any).id);
    if ('nodeId' in op && typeof (op as any).nodeId === 'string') targetNodeIds.push((op as any).nodeId);
    if ('source' in op && typeof (op as any).source === 'string') targetNodeIds.push((op as any).source);
    if ('target' in op && typeof (op as any).target === 'string') targetNodeIds.push((op as any).target);
  }

  return ctx.withAiAwareness(
    input.diagramId,
    input.agentName,
    `AI 正在执行 ${input.ops.length} 项增量操作...`,
    Array.from(new Set(targetNodeIds)),
    async () => {
      const preSnapshotState = ctx.writer.getSnapshotState(input.diagramId);
      const batchId = ctx.newBatchId();
      const isAtomic = Boolean(input.atomic);

        const outcome = await ctx.writer.mutate(input.diagramId, `ai:${batchId}`, (doc) => {
        const nodesMap = doc.getMap<Y.Map<unknown>>('nodes');
        const edgesMap = doc.getMap<Y.Map<unknown>>('edges');
        const metaMap = doc.getMap<unknown>('meta');

        const diffs: AiBatchEntityDiff[] = [];
        const warnings: string[] = [];
        let appliedCount = 0;

        const getCandidateNodeIds = () => {
          const ids: string[] = [];
          nodesMap.forEach((_map, id) => { ids.push(id); });
          return ids.slice(0, 10);
        };
        const getCandidateLaneIds = () => {
          const ids: string[] = [];
          nodesMap.forEach((map, id) => {
            if (map.get('type') === 'lane') ids.push(id);
          });
          return ids.slice(0, 10);
        };

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
          role?: 'main' | 'branch' | 'annotation';
          attachTo?: string;
          earlyExit?: boolean;
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
            ...(spec.role ? { role: spec.role } : {}),
            ...(spec.attachTo ? { attachTo: spec.attachTo } : {}),
            ...(spec.earlyExit !== undefined ? { earlyExit: spec.earlyExit } : {}),
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
          kind?: 'next' | 'branch' | 'loop' | 'jump' | 'annotate' | 'tree',
          sourceHandle?: string,
          targetHandle?: string,
          autoSourceHandle?: string,
          autoTargetHandle?: string,
          routingType?: 'orthogonal' | 'straight',
        ) => {
          const edgeId = ctx.newEntityId('edge');
          const edgeMap = new Y.Map<unknown>();
          const resolvedRouting = routingType ?? 'orthogonal';
          edgeMap.set('id', edgeId);
          edgeMap.set('source', source);
          edgeMap.set('target', target);
          if (sourceHandle) edgeMap.set('sourceHandle', sourceHandle);
          if (targetHandle) edgeMap.set('targetHandle', targetHandle);
          edgeMap.set('type', resolvedRouting);
          edgeMap.set('data', {
            ...(label !== undefined ? { label } : {}),
            ...(kind ? { kind } : {}),
            ...(routingType ? { routingType } : {}),
            ...(style && Object.keys(style).length > 0 ? { style } : {}),
            ...(autoSourceHandle ? { autoSourceHandle } : {}),
            ...(autoTargetHandle ? { autoTargetHandle } : {}),
          });
          edgesMap.set(edgeId, edgeMap);
          recordAdd('edge', edgeId, edgeMap);
          return edgeId;
        };

        const snapshotGraphForPorts = (): { nodes: FlowNode[]; edges: FlowEdge[] } => {
          const nodes: FlowNode[] = [];
          const edges: FlowEdge[] = [];
          nodesMap.forEach((m, id) => {
            nodes.push({
              id,
              type: (m.get('type') as FlowNode['type']) || 'process',
              position: (m.get('position') as XYPosition) || { x: 0, y: 0 },
              parentId: m.get('parentId') as string | undefined,
              width: m.get('width') as number | undefined,
              height: m.get('height') as number | undefined,
              data: (m.get('data') as FlowNode['data']) || { label: id, type: 'process' },
            });
          });
          edgesMap.forEach((m, id) => {
            const source = m.get('source') as string;
            const target = m.get('target') as string;
            if (!source || !target) return;
            edges.push({
              id,
              source,
              target,
              sourceHandle: m.get('sourceHandle') as string | undefined,
              targetHandle: m.get('targetHandle') as string | undefined,
              data: m.get('data') as FlowEdge['data'],
            });
          });
          return { nodes, edges };
        };

        const mergeEdgeStyle = (
          baseStyle: Record<string, unknown> | undefined,
          topStrokeStyle: EdgeStrokeStyle | undefined,
          kind?: string,
        ): Record<string, unknown> | undefined => {
          const resolvedStroke =
            topStrokeStyle
            ?? (baseStyle?.strokeStyle as EdgeStrokeStyle | undefined)
            ?? (kind === 'annotate' ? 'dashed' : undefined);
          if (!baseStyle && !resolvedStroke) return undefined;
          const next = { ...(baseStyle ?? {}) };
          if (resolvedStroke) next.strokeStyle = resolvedStroke;
          return Object.keys(next).length > 0 ? next : undefined;
        };

        const resolveFlowDirection = (laneId?: string): 'DOWN' | 'RIGHT' => {
          if (laneId) {
            const poolId = nodesMap.get(laneId)?.get('parentId');
            const poolData = typeof poolId === 'string' ? (nodesMap.get(poolId)?.get('data') as Record<string, unknown> | undefined) : undefined;
            if (poolData) return poolData.orientation === 'vertical' ? 'DOWN' : 'RIGHT';
          }
          const metaOri = metaMap.get('orientation') as string | undefined;
          if (metaOri === 'horizontal') return 'RIGHT';
          if (metaOri === 'vertical') return 'DOWN';
          let poolOri: string | undefined;
          nodesMap.forEach((m) => {
            if (!poolOri && m.get('type') === 'pool') {
              const d = (m.get('data') as Record<string, unknown> | undefined) ?? {};
              poolOri = d.orientation === 'vertical' ? 'vertical' : 'horizontal';
            }
          });
          if (poolOri) return poolOri === 'vertical' ? 'DOWN' : 'RIGHT';
          const paradigm = metaMap.get('paradigm') as string | undefined;
          if (paradigm === 'circuit-flow' || paradigm === 'tree' || paradigm === 'timeline-annotated') return 'DOWN';
          return 'DOWN';
        };

        const bumpSize = (nodeMap: Y.Map<unknown>, width: number, height: number) => {
          nodeMap.set('width', width);
          nodeMap.set('height', height);
          const style = nodeMap.get('style');
          if (style && typeof style === 'object') {
            nodeMap.set('style', { ...(style as Record<string, unknown>), width, height });
          }
        };

        const expandLanesAndPools = (affectedLaneIds: Set<string>) => {
          if (affectedLaneIds.size === 0) return;
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

          const laneChildExtents = new Map<string, { right: number; bottom: number }>();
          nodesMap.forEach((childMap, childId) => {
            const parentId = childMap.get('parentId');
            if (typeof parentId !== 'string' || !affectedLaneIds.has(parentId) || childId === parentId) return;
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
            const headerSize = typeof poolData.headerSize === 'number' ? poolData.headerSize : LANE_HEADER_SIZE;
            const siblingLanes: Array<{ id: string; map: Y.Map<unknown> }> = [];
            nodesMap.forEach((map, id) => {
              if (map.get('type') === 'lane' && map.get('parentId') === poolId) siblingLanes.push({ id, map });
            });
            const laneOrder = orderLaneIds(
              Array.isArray(poolData.laneOrder) ? (poolData.laneOrder as string[]) : undefined,
              siblingLanes.map((lane) => ({
                id: lane.id,
                position: (lane.map.get('position') as LayoutPoint | undefined) ?? { x: 0, y: 0 },
              })),
              isHorizontal,
            );
            let cursor = headerSize;
            let crossExtent = 0;
            for (const orderedLaneId of laneOrder) {
              const lane = siblingLanes.find((item) => item.id === orderedLaneId);
              if (!lane) continue;
              const size = getMapDimensions(lane.map);
              const currentPos = (lane.map.get('position') as LayoutPoint | undefined) ?? { x: 0, y: 0 };
              const mustStay = getNodeLockMode(lane.map) !== 'none' || lanesWithLockedChild.has(orderedLaneId);
              const baseline = isHorizontal ? currentPos.y : currentPos.x;
              const targetMain = mustStay ? baseline : Math.max(baseline, cursor);
              if (targetMain !== baseline) {
                const beforeLane = snapshotMap(lane.map);
                lane.map.set(
                  'position',
                  isHorizontal ? { x: currentPos.x, y: targetMain } : { x: targetMain, y: currentPos.y },
                );
                recordUpdate('node', orderedLaneId, beforeLane, snapshotMap(lane.map));
              }
              cursor = Math.max(cursor, targetMain + (isHorizontal ? size.height : size.width));
              crossExtent = Math.max(crossExtent, isHorizontal ? currentPos.x + size.width : currentPos.y + size.height);
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
        };

        const findAddNodePosition = (laneId: string | undefined): LayoutPoint => {
          const siblings: Array<{ x: number; y: number; width: number; height: number }> = [];
          nodesMap.forEach((map) => {
            const parentId = map.get('parentId');
            if (laneId ? parentId !== laneId : typeof parentId === 'string') return;
            const type = map.get('type');
            if (type === 'pool' || type === 'lane') return;
            const size = getMapDimensions(map);
            const pos = (map.get('position') as LayoutPoint | undefined) ?? { x: 0, y: 0 };
            siblings.push({ x: pos.x, y: pos.y, width: size.width, height: size.height });
          });
          const dir = resolveFlowDirection(laneId);
          const container = laneId ? nodesMap.get(laneId) : undefined;
          const containerSize = container ? getMapDimensions(container) : undefined;
          const boundWidth = containerSize ? containerSize.width : Infinity;
          const boundHeight = containerSize ? containerSize.height : Infinity;
          const collides = (x: number, y: number) =>
            siblings.some(
              (r) =>
                x < r.x + r.width + INSERT_GAP
                && x + DEFAULT_NODE_WIDTH + INSERT_GAP > r.x
                && y < r.y + r.height + INSERT_GAP
                && y + DEFAULT_NODE_HEIGHT + INSERT_GAP > r.y,
            );
          if (dir === 'DOWN') {
            const maxRows = boundHeight === Infinity
              ? 50
              : Math.max(1, Math.floor((boundHeight - LAYOUT_PADDING * 2 + INSERT_GAP) / (DEFAULT_NODE_HEIGHT + INSERT_GAP)));
            const maxCols = boundWidth === Infinity
              ? 4
              : Math.max(1, Math.floor((boundWidth - LAYOUT_PADDING * 2 + INSERT_GAP) / (DEFAULT_NODE_WIDTH + INSERT_GAP)));
            for (let col = 0; col < maxCols; col++) {
              for (let row = 0; row < maxRows; row++) {
                const x = LAYOUT_PADDING + col * (DEFAULT_NODE_WIDTH + INSERT_GAP);
                const y = LAYOUT_PADDING + row * (DEFAULT_NODE_HEIGHT + INSERT_GAP);
                if (!collides(x, y)) return { x, y };
              }
            }
            const maxBottom = siblings.reduce((max, r) => Math.max(max, r.y + r.height), LAYOUT_PADDING);
            return { x: LAYOUT_PADDING, y: maxBottom + INSERT_GAP };
          }
          const maxCols = boundWidth === Infinity
            ? 50
            : Math.max(1, Math.floor((boundWidth - LAYOUT_PADDING * 2 + INSERT_GAP) / (DEFAULT_NODE_WIDTH + INSERT_GAP)));
          const maxRows = boundHeight === Infinity
            ? 4
            : Math.max(1, Math.floor((boundHeight - LAYOUT_PADDING * 2 + INSERT_GAP) / (DEFAULT_NODE_HEIGHT + INSERT_GAP)));
          for (let row = 0; row < maxRows; row++) {
            for (let col = 0; col < maxCols; col++) {
              const x = LAYOUT_PADDING + col * (DEFAULT_NODE_WIDTH + INSERT_GAP);
              const y = LAYOUT_PADDING + row * (DEFAULT_NODE_HEIGHT + INSERT_GAP);
              if (!collides(x, y)) return { x, y };
            }
          }
          const maxRight = siblings.reduce((max, r) => Math.max(max, r.x + r.width), LAYOUT_PADDING);
          return { x: maxRight + INSERT_GAP, y: LAYOUT_PADDING };
        };

        for (const op of input.ops) {
          switch (op.op) {
            case 'add_node': {
              if (op.type === 'pool' || op.type === 'lane') {
                throw new Error(`add_node 不支持创建容器节点 "${op.type}"，请使用 scaffold_diagram 的 lanes 或 add_lane 创建`);
              }
              const nodeId = op.id || ctx.newEntityId('node');
              if (nodesMap.has(nodeId)) {
                if (isAtomic) throw new Error(`节点 "${nodeId}" 已存在，操作终止`);
                warnings.push(`节点 ${nodeId} 已存在，跳过新增`);
                break;
              }
              let resolvedLaneId = op.laneId;
              const laneMap = resolvedLaneId ? nodesMap.get(resolvedLaneId) : undefined;
              if (resolvedLaneId && (!laneMap || laneMap.get('type') !== 'lane')) {
                if (isAtomic) {
                  throw new Error(`目标泳道 "${resolvedLaneId}" 不存在。候选可用泳道: [${getCandidateLaneIds().join(', ')}]`);
                }
                warnings.push(`目标泳道 ${resolvedLaneId} 不存在，将作为独立浮动节点创建`);
                resolvedLaneId = undefined;
              }
              createNodeMap({
                id: nodeId,
                type: op.type || 'process',
                label: op.label,
                position: findAddNodePosition(resolvedLaneId),
                laneId: resolvedLaneId,
                role: op.role,
                attachTo: op.attachTo,
                earlyExit: op.earlyExit,
                style: op.style,
              });
              if (resolvedLaneId) expandLanesAndPools(new Set([resolvedLaneId]));
              appliedCount++;
              break;
            }

            case 'update_node': {
              const nodeMap = nodesMap.get(op.id);
              if (!nodeMap) {
                if (isAtomic) throw new Error(`未找到节点 "${op.id}"。候选可用节点: [${getCandidateNodeIds().join(', ')}]`);
                warnings.push(`未找到节点 ${op.id}，跳过更新`);
                break;
              }
              if (isBlocked(nodeMap, 'modify')) {
                if (isAtomic) throw new Error(`节点 "${op.id}"(${nodeLabel(nodeMap)}) 已被人类完全锁定，禁止修改`);
                break;
              }

              const before = snapshotMap(nodeMap);
              const data = (nodeMap.get('data') as Record<string, unknown>) || {};
              const nextData = { ...data };
              if (op.label !== undefined) nextData.label = op.label;
              if (op.earlyExit !== undefined) nextData.earlyExit = op.earlyExit;
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
                if (isAtomic) throw new Error(`未找到节点 "${op.id}"。候选可用节点: [${getCandidateNodeIds().join(', ')}]`);
                warnings.push(`未找到节点 ${op.id}，跳过删除`);
                break;
              }
              if (isBlocked(nodeMap, 'delete')) {
                if (isAtomic) throw new Error(`节点 "${op.id}"(${nodeLabel(nodeMap)}) 已被人类完全锁定，禁止删除`);
                break;
              }
              if (hasFullLockedDescendant(op.id)) {
                if (isAtomic) throw new Error(`容器 "${op.id}"(${nodeLabel(nodeMap)}) 内含人工锁定节点，禁止整体删除`);
                warnings.push(`容器 ${op.id}(${nodeLabel(nodeMap)}) 内含人工锁定节点，禁止整体删除`);
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
                const missingEndpoint = !nodesMap.has(op.source)
                  ? `连线源节点 "${op.source}"`
                  : `连线目标节点 "${op.target}"`;
                if (isAtomic) {
                  throw new Error(`${missingEndpoint} 不存在。候选可用节点: [${getCandidateNodeIds().join(', ')}]`);
                }
                warnings.push(`连线端点不存在 (${op.source} -> ${op.target})，跳过`);
                break;
              }
              const graph = snapshotGraphForPorts();
              const hasLane = Boolean(nodesMap.get(op.source)?.get('parentId'));
              const explicitDir = metaMap.get('paradigm') || metaMap.get('orientation') || hasLane ? resolveFlowDirection(nodesMap.get(op.source)?.get('parentId') as string | undefined) : undefined;
              const picked = pickEdgePortsForConnect(graph.nodes, graph.edges, {
                sourceId: op.source,
                targetId: op.target,
                sourceHandle: op.sourceHandle,
                targetHandle: op.targetHandle,
                ...(explicitDir ? { flowDirection: explicitDir } : {}),
              });
              const edgeStyle = mergeEdgeStyle(op.style, op.strokeStyle, op.kind);
              createEdgeMap(
                op.source,
                op.target,
                op.label,
                edgeStyle,
                op.kind,
                picked.sourceHandle,
                picked.targetHandle,
                picked.sourceAuto ? picked.sourceHandle : undefined,
                picked.targetAuto ? picked.targetHandle : undefined,
                op.routingType,
              );
              appliedCount++;
              break;
            }

            case 'disconnect': {
              if (op.edgeId) {
                const edgeMap = edgesMap.get(op.edgeId);
                if (!edgeMap) {
                  if (isAtomic) throw new Error(`未找到连线 "${op.edgeId}"`);
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
                if (matched.length === 0 && isAtomic) {
                  throw new Error(`未找到从 "${op.source}" 到 "${op.target}" 的连线`);
                }
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
                if (isAtomic) throw new Error(`未找到节点 "${op.nodeId}"。候选可用节点: [${getCandidateNodeIds().join(', ')}]`);
                warnings.push(`未找到节点 ${op.nodeId}，跳过移入泳道`);
                break;
              }
              if (isBlocked(nodeMap, 'move')) {
                if (isAtomic) throw new Error(`节点 "${op.nodeId}"(${nodeLabel(nodeMap)}) 坐标已锁定，禁止移动`);
                break;
              }
              const laneMap = nodesMap.get(op.laneId);
              if (!laneMap || laneMap.get('type') !== 'lane') {
                if (isAtomic) throw new Error(`目标泳道 "${op.laneId}" 不存在。候选可用泳道: [${getCandidateLaneIds().join(', ')}]`);
                warnings.push(`目标泳道 ${op.laneId} 不存在，跳过移入泳道`);
                break;
              }
              const worldBoxes = resolveNodeWorldBoxes(snapshotGraphForPorts().nodes);
              const nodeWorld = worldBoxes.get(op.nodeId);
              const laneWorld = worldBoxes.get(op.laneId);
              const nodeDim = getMapDimensions(nodeMap);
              const before = snapshotMap(nodeMap);
              nodeMap.set('parentId', op.laneId);
              nodeMap.set('extent', 'parent');
              if (nodeWorld && laneWorld) {
                let lx = Math.max(LAYOUT_PADDING, nodeWorld.x - laneWorld.x);
                let ly = Math.max(LAYOUT_PADDING, nodeWorld.y - laneWorld.y);
                const siblings: Array<{ x: number; y: number; width: number; height: number }> = [];
                nodesMap.forEach((m, id) => {
                  if (id !== op.nodeId && m.get('parentId') === op.laneId && m.get('type') !== 'pool' && m.get('type') !== 'lane') {
                    const p = (m.get('position') as LayoutPoint | undefined) ?? { x: 0, y: 0 };
                    const d = getMapDimensions(m);
                    siblings.push({ x: p.x, y: p.y, width: d.width, height: d.height });
                  }
                });
                const isVert = resolveFlowDirection(op.laneId) === 'DOWN';
                let guard = 0;
                while (
                  siblings.some(
                    (s) => lx < s.x + s.width + INSERT_GAP && lx + nodeDim.width + INSERT_GAP > s.x && ly < s.y + s.height + INSERT_GAP && ly + nodeDim.height + INSERT_GAP > s.y,
                  ) && guard++ < 100
                ) {
                  if (isVert) ly += nodeDim.height + INSERT_GAP;
                  else lx += nodeDim.width + INSERT_GAP;
                }
                nodeMap.set('position', { x: lx, y: ly });
              }
              recordUpdate('node', op.nodeId, before, snapshotMap(nodeMap));
              expandLanesAndPools(new Set([op.laneId]));
              appliedCount++;
              break;
            }

            case 'move_node': {
              const nodeMap = nodesMap.get(op.id);
              if (!nodeMap) {
                if (isAtomic) throw new Error(`未找到节点 "${op.id}"。候选可用节点: [${getCandidateNodeIds().join(', ')}]`);
                warnings.push(`未找到节点 ${op.id}，跳过移动`);
                break;
              }
              if (isBlocked(nodeMap, 'move')) {
                if (isAtomic) throw new Error(`节点 "${op.id}"(${nodeLabel(nodeMap)}) 坐标已锁定，禁止移动`);
                break;
              }
              const before = snapshotMap(nodeMap);
              nodeMap.set('position', { x: op.position.x, y: op.position.y });
              recordUpdate('node', op.id, before, snapshotMap(nodeMap));
              appliedCount++;
              break;
            }

            case 'update_edge': {
              const edgeMap = edgesMap.get(op.id);
              if (!edgeMap) {
                if (isAtomic) throw new Error(`未找到连线 "${op.id}"`);
                warnings.push(`未找到连线 ${op.id}，跳过更新`);
                break;
              }
              const before = snapshotMap(edgeMap);
              const data = (edgeMap.get('data') as Record<string, unknown>) || {};
              const nextData: Record<string, unknown> = { ...data };
              if (op.label !== undefined) nextData.label = op.label;
              if (op.sourceHandle !== undefined) {
                edgeMap.set('sourceHandle', op.sourceHandle);
                if (hasExplicitBorderOffset(op.sourceHandle) || op.sourceHandle.includes('@')) {
                  delete nextData.autoSourceHandle;
                } else {
                  nextData.autoSourceHandle = op.sourceHandle;
                }
              }
              if (op.targetHandle !== undefined) {
                edgeMap.set('targetHandle', op.targetHandle);
                if (hasExplicitBorderOffset(op.targetHandle) || op.targetHandle.includes('@')) {
                  delete nextData.autoTargetHandle;
                } else {
                  nextData.autoTargetHandle = op.targetHandle;
                }
              }
              if (op.style || op.strokeStyle !== undefined) {
                const mergedStyle = {
                  ...((nextData.style as Record<string, unknown>) || {}),
                  ...(op.style ?? {}),
                  ...(op.strokeStyle !== undefined ? { strokeStyle: op.strokeStyle } : {}),
                };
                nextData.style = mergedStyle;
              }
              if (op.routingType !== undefined) {
                edgeMap.set('type', op.routingType);
                nextData.routingType = op.routingType;
                if (op.routingType === 'straight') delete nextData.waypoints;
              }
              if (
                (op.sourceHandle !== undefined || op.targetHandle !== undefined)
                && Array.isArray(nextData.waypoints)
                && nextData.waypoints.length > 0
              ) {
                const sourceId = edgeMap.get('source') as string;
                const targetId = edgeMap.get('target') as string;
                const boxes = resolveNodeWorldBoxes(snapshotGraphForPorts().nodes);
                const sBox = boxes.get(sourceId);
                const tBox = boxes.get(targetId);
                if (sBox && tBox) {
                  nextData.waypoints = alignWaypointsToAnchors(
                    nextData.waypoints as XYPosition[],
                    sBox,
                    edgeMap.get('sourceHandle') as string | undefined,
                    tBox,
                    edgeMap.get('targetHandle') as string | undefined,
                  );
                }
              }
              edgeMap.set('data', nextData);
              recordUpdate('edge', op.id, before, snapshotMap(edgeMap));
              appliedCount++;
              break;
            }

            case 'add_lane': {
              const laneId = op.id || ctx.newEntityId('lane');
              if (nodesMap.has(laneId)) {
                if (isAtomic) throw new Error(`泳道 "${laneId}" 已存在，操作终止`);
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
                  if (isAtomic) throw new Error(`未找到泳道池 "${op.poolId}"`);
                  warnings.push(`未找到泳道池 ${op.poolId}，泳道将作为独立泳道创建`);
                } else {
                  const before = snapshotMap(poolMap);
                  const poolData = (poolMap.get('data') as Record<string, unknown>) || {};
                  const isVertical = poolData.orientation === 'vertical';
                  const headerSize = typeof poolData.headerSize === 'number' ? poolData.headerSize : LANE_HEADER_SIZE;
                  const poolSize = getMapDimensions(poolMap);
                  let maxBottom = headerSize;
                  let maxRight = 0;
                  nodesMap.forEach((m) => {
                    if (m.get('type') === 'lane' && m.get('parentId') === op.poolId) {
                      const pos = (m.get('position') as LayoutPoint | undefined) ?? { x: 0, y: 0 };
                      const dim = getMapDimensions(m);
                      maxBottom = Math.max(maxBottom, pos.y + dim.height);
                      maxRight = Math.max(maxRight, pos.x + dim.width);
                    }
                  });
                  if (isVertical) {
                    const laneW = 240;
                    const laneH = Math.max(480, poolSize.height - headerSize);
                    laneMap.set('position', { x: maxRight, y: headerSize });
                    laneMap.set('width', laneW);
                    laneMap.set('height', laneH);
                    const nextPoolW = Math.max(poolSize.width, maxRight + laneW);
                    const nextPoolH = Math.max(poolSize.height, headerSize + laneH);
                    poolMap.set('width', nextPoolW);
                    poolMap.set('height', nextPoolH);
                  } else {
                    const laneW = Math.max(750, poolSize.width);
                    const laneH = 200;
                    laneMap.set('position', { x: 0, y: maxBottom });
                    laneMap.set('width', laneW);
                    laneMap.set('height', laneH);
                    poolMap.set('width', laneW);
                    poolMap.set('height', Math.max(poolSize.height, maxBottom + laneH));
                  }
                  laneMap.set('parentId', op.poolId);
                  laneMap.set('extent', 'parent');
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
              if (op.node.type === 'pool' || op.node.type === 'lane') {
                throw new Error(`insert_between 不支持插入容器节点 "${op.node.type}"`);
              }
              const sourceMap = nodesMap.get(op.source);
              const targetMap = nodesMap.get(op.target);
              if (!sourceMap || !targetMap) {
                if (isAtomic) {
                  throw new Error(`断线串接端点不存在 (${op.source} -> ${op.target})。候选可用节点: [${getCandidateNodeIds().join(', ')}]`);
                }
                warnings.push(`断线串接端点不存在 (${op.source} -> ${op.target})，跳过`);
                break;
              }
              const nodeId = op.node.id || ctx.newEntityId('node');
              if (nodesMap.has(nodeId)) {
                if (isAtomic) throw new Error(`节点 "${nodeId}" 已存在，插入失败`);
                warnings.push(`节点 ${nodeId} 已存在，跳过插入`);
                break;
              }

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

              const direction: 'RIGHT' | 'DOWN' = op.direction ?? (() => {
                const poolDir = laneId ? resolveFlowDirection(laneId) : undefined;
                if (poolDir) return poolDir;
                const dx = Math.abs(targetWorld.x - sourceWorld.x);
                const dy = Math.abs(targetWorld.y - sourceWorld.y);
                if (dy > dx + 10) return 'DOWN';
                if (dx > dy + 10) return 'RIGHT';
                return resolveFlowDirection();
              })();
              const laneOrigin = typeof laneId === 'string'
                ? getWorldPosition(nodesMap.get(laneId)!)
                : { x: 0, y: 0 };

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

              const outgoing = new Map<string, string[]>();
              edgesMap.forEach((edgeMap) => {
                const source = edgeMap.get('source');
                const target = edgeMap.get('target');
                if (typeof source !== 'string' || typeof target !== 'string') return;
                const edgeData = (edgeMap.get('data') as Record<string, unknown> | undefined) ?? {};
                if (edgeData.kind === 'loop' || edgeData.kind === 'annotate') return;
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

              const affectedLaneIds = new Set<string>();
              for (const affectedId of [nodeId, op.target, ...downstream]) {
                const parentId = nodesMap.get(affectedId)?.get('parentId');
                if (typeof parentId === 'string' && nodesMap.get(parentId)?.get('type') === 'lane') {
                  affectedLaneIds.add(parentId);
                }
              }
              expandLanesAndPools(affectedLaneIds);

              const originalEdgeIds: string[] = [];
              edgesMap.forEach((edgeMap, edgeId) => {
                if (edgeMap.get('source') === op.source && edgeMap.get('target') === op.target) {
                  originalEdgeIds.push(edgeId);
                }
              });

              let inheritedLabel: string | undefined;
              let inheritedStyle: Record<string, unknown> | undefined;
              let inheritedRouting: 'orthogonal' | 'straight' | undefined;
              for (const edgeId of originalEdgeIds) {
                const edgeMap = edgesMap.get(edgeId);
                if (!edgeMap) continue;
                const data = (edgeMap.get('data') as Record<string, unknown> | undefined) ?? {};
                const raw = data.label ?? edgeMap.get('label');
                if (!inheritedLabel && typeof raw === 'string' && raw.trim()) {
                  inheritedLabel = raw;
                }
                if (!inheritedStyle && data.style && typeof data.style === 'object') {
                  inheritedStyle = { ...(data.style as Record<string, unknown>) };
                }
                if (!inheritedRouting) {
                  const r = data.routingType ?? edgeMap.get('type');
                  if (r === 'straight' || r === 'orthogonal') inheritedRouting = r;
                }
              }

              for (const edgeId of originalEdgeIds) {
                const edgeMap = edgesMap.get(edgeId);
                if (edgeMap) {
                  recordDelete('edge', edgeId, snapshotMap(edgeMap));
                  edgesMap.delete(edgeId);
                }
              }

              const betweenStyle = mergeEdgeStyle(inheritedStyle, op.strokeStyle);
              const betweenRouting = op.routingType ?? inheritedRouting;
              const preferredSourceSide = direction === 'DOWN' ? 'bottom' : 'right';
              const preferredTargetSide = direction === 'DOWN' ? 'top' : 'left';

              const upGraph = snapshotGraphForPorts();
              const upPorts = pickEdgePortsForConnect(upGraph.nodes, upGraph.edges, {
                sourceId: op.source,
                targetId: nodeId,
                sourceHandle: preferredSourceSide,
                targetHandle: preferredTargetSide,
                flowDirection: direction,
              });
              createEdgeMap(
                op.source,
                nodeId,
                op.upstreamLabel ?? op.edgeLabel ?? inheritedLabel,
                betweenStyle,
                undefined,
                upPorts.sourceHandle,
                upPorts.targetHandle,
                upPorts.sourceAuto ? upPorts.sourceHandle : undefined,
                upPorts.targetAuto ? upPorts.targetHandle : undefined,
                betweenRouting,
              );

              const downGraph = snapshotGraphForPorts();
              const downPorts = pickEdgePortsForConnect(downGraph.nodes, downGraph.edges, {
                sourceId: nodeId,
                targetId: op.target,
                sourceHandle: preferredSourceSide,
                targetHandle: preferredTargetSide,
                flowDirection: direction,
              });
              createEdgeMap(
                nodeId,
                op.target,
                op.downstreamLabel ?? op.edgeLabel,
                betweenStyle,
                undefined,
                downPorts.sourceHandle,
                downPorts.targetHandle,
                downPorts.sourceAuto ? downPorts.sourceHandle : undefined,
                downPorts.targetAuto ? downPorts.targetHandle : undefined,
                betweenRouting,
              );

              appliedCount++;
              break;
            }
          }
        }

        const semanticWarnings = inspectDiagramSemantics(nodesMap, edgesMap, metaMap);
        return {
          diffs,
          warnings: Array.from(new Set([...warnings, ...semanticWarnings])),
          appliedCount,
        };
      });

      const { diffs, warnings, appliedCount } = outcome.result;

      if (appliedCount === 0 || diffs.length === 0) {
        return {
          success: true,
          batchId: null,
          appliedCount: 0,
          totalOps: input.ops.length,
          warnings: ['未产生任何有效变更，已跳过快照与批次记录', ...warnings],
          live: outcome.live,
        };
      }

      if (preSnapshotState) {
        ctx.repo.createSnapshotFromState(input.diagramId, preSnapshotState, 'AI 增量修改前快照', 'ai_batch');
      }

      ctx.batchManager.recordBatch({
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
    },
  );
}

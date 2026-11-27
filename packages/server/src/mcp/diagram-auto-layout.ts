import * as Y from 'yjs';
import type ELK from 'elkjs/lib/elk.bundled.js';
import {
  type AiBatchEntityDiff,
  alignWaypointsToAnchors,
  type CircuitEdgePlan,
  distributeEdgePorts,
  type FlowEdge,
  type FlowNode,
  isAutoManagedPort,
  layoutCircuitFlowGraph,
  layoutTreeGraph,
  resolveNodeWorldBoxes,
} from '@flowstudio/shared';
import type { DiagramRepository } from '../db/diagram-repository.js';
import type { AiBatchManager } from '../collaboration/ai-batch-manager.js';
import type { DocumentWriter } from '../collaboration/document-writer.js';
import { deepEqual, getNodeLockMode, snapshotMap } from '../collaboration/entity-state.js';
import {
  collectLiveLockState,
  computeSwimlanePlacement,
  getMapDimensions,
  LAYOUT_PADDING,
  type LayoutPoint,
  orderLaneIds,
} from './swimlane-geometry.js';

export interface AutoLayoutContext {
  repo: DiagramRepository;
  writer: DocumentWriter;
  batchManager: AiBatchManager;
  elkInstance: InstanceType<typeof ELK>;
  withAiAwareness: <T>(
    diagramId: string,
    agentName: string | undefined,
    summary: string,
    targetNodeIds: string[],
    action: () => Promise<T>,
  ) => Promise<T>;
  newBatchId: (prefix?: string) => string;
}

export interface AutoLayoutInput {
  diagramId: string;
  direction?: 'RIGHT' | 'DOWN';
  mode?: 'circuit' | 'layered' | 'tree';
  edgeRouting?: 'orthogonal' | 'straight';
  agentName?: string;
}

export async function executeAutoLayout(ctx: AutoLayoutContext, input: AutoLayoutInput) {
  if (!ctx.repo.getDiagramById(input.diagramId)) {
    throw new Error(`图表 ${input.diagramId} 不存在`);
  }

  return ctx.withAiAwareness(
    input.diagramId,
    input.agentName,
    'AI 正在执行自动排版...',
    [],
    async () => {
      ctx.writer.createSnapshot(input.diagramId, '服务端自动排版前快照', 'auto');

      const graph = await ctx.writer.readDocument(input.diagramId, (doc) => {
        const nodesMap = doc.getMap<Y.Map<unknown>>('nodes');
        const edgesMap = doc.getMap<Y.Map<unknown>>('edges');
        const metaMap = doc.getMap<unknown>('meta');
        const paradigm = metaMap.get('paradigm') as string | undefined;
        const orientation = metaMap.get('orientation') as string | undefined;
        const metaEdgeRouting = metaMap.get('edgeRouting') as 'orthogonal' | 'straight' | undefined;
        const children: Array<{
          id: string;
          type: string;
          label: string;
          parentId?: string;
          position: LayoutPoint;
          width: number;
          height: number;
          locked: boolean;
          role?: string;
          attachTo?: string;
          earlyExit?: boolean;
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
          const type = (nodeMap.get('type') as string) || 'process';
          const size = getMapDimensions(nodeMap);
          const data = (nodeMap.get('data') as Record<string, unknown> | undefined) ?? {};
          if (type === 'pool') {
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
            type,
            label: typeof data.label === 'string' ? data.label : id,
            parentId: nodeMap.get('parentId') as string | undefined,
            position: (nodeMap.get('position') as LayoutPoint | undefined) ?? { x: 0, y: 0 },
            width: size.width,
            height: size.height,
            locked: getNodeLockMode(nodeMap) !== 'none',
            role: typeof data.role === 'string' ? data.role : undefined,
            attachTo: typeof data.attachTo === 'string' ? data.attachTo : undefined,
            earlyExit: typeof data.earlyExit === 'boolean' ? data.earlyExit : undefined,
          });
        });

        const elkEdges: Array<{ id: string; sources: string[]; targets: string[]; kind?: string; label?: string; routing?: string }> = [];
        edgesMap.forEach((edgeMap, id) => {
          const source = edgeMap.get('source') as string;
          const target = edgeMap.get('target') as string;
          const edgeData = (edgeMap.get('data') as Record<string, unknown> | undefined) ?? {};
          const rawRouting = (edgeData.routingType ?? edgeMap.get('type')) as string | undefined;
          if (source && target) {
            elkEdges.push({
              id,
              sources: [source],
              targets: [target],
              kind: typeof edgeData.kind === 'string' ? edgeData.kind : undefined,
              label: typeof edgeData.label === 'string' ? edgeData.label : undefined,
              routing: rawRouting,
            });
          }
        });
        return { paradigm, orientation, metaEdgeRouting, children, pools, lanes, elkEdges };
      });

      const defaultMode =
        graph.pools.length === 0
          ? graph.paradigm === 'tree'
            ? 'tree'
            : graph.paradigm === 'circuit-flow'
            ? 'circuit'
            : 'layered'
          : 'layered';
      const requestedMode = input.mode ?? defaultMode;
      const modeWarnings: string[] = [];
      if ((requestedMode === 'tree' || requestedMode === 'circuit') && graph.pools.length > 0) {
        modeWarnings.push(`泳道图暂不支持 ${requestedMode} 模式，已自动回退为泳道排版`);
      }
      const activeMode: 'circuit' | 'layered' | 'tree' =
        graph.pools.length > 0 ? 'layered' : requestedMode;

      const effectiveDirection: 'RIGHT' | 'DOWN' =
        input.direction ??
        (graph.pools.length > 0
          ? graph.pools.some((p) => !p.horizontal)
            ? 'DOWN'
            : 'RIGHT'
          : activeMode === 'tree'
          ? 'DOWN'
          : graph.orientation === 'vertical'
          ? 'DOWN'
          : graph.orientation === 'horizontal'
          ? 'RIGHT'
          : activeMode === 'circuit'
          ? 'DOWN'
          : 'RIGHT');

      const bizEdges = graph.elkEdges.filter((e) => e.kind !== 'loop' && e.kind !== 'annotate');
      const straightCount = bizEdges.filter((e) => e.routing === 'straight').length;
      const inferredRouting: 'orthogonal' | 'straight' =
        graph.metaEdgeRouting === 'straight' || graph.metaEdgeRouting === 'orthogonal'
          ? graph.metaEdgeRouting
          : bizEdges.length > 0 && straightCount / bizEdges.length > 0.5
          ? 'straight'
          : 'orthogonal';
      const effectiveEdgeRouting = input.edgeRouting ?? inferredRouting;

      const globalPositions = new Map<string, LayoutPoint>();
      let treeBackEdgeKeys = new Set<string>();
      let circuitEdgePlans = new Map<string, CircuitEdgePlan>();

      if (activeMode === 'tree') {
        const treeRes = layoutTreeGraph(
          graph.children.map((c) => ({
            id: c.id,
            width: c.width,
            height: c.height,
            role: c.role,
            attachTo: c.attachTo,
            fixed: c.locked ? { position: c.position, width: c.width, height: c.height } : undefined,
          })),
          graph.elkEdges.map((e) => ({ from: e.sources[0], to: e.targets[0], kind: e.kind })),
          { origin: { x: 50, y: 50 } },
        );
        modeWarnings.push(...treeRes.warnings);
        treeBackEdgeKeys = treeRes.backEdgeKeys;
        for (const [id, box] of treeRes.positions) {
          globalPositions.set(id, { x: box.x, y: box.y });
        }
      } else if (activeMode === 'circuit') {
        const circuitRes = layoutCircuitFlowGraph(
          graph.children.map((c) => ({
            id: c.id,
            width: c.width,
            height: c.height,
            type: c.type,
            label: c.label,
            role: c.role,
            attachTo: c.attachTo,
            earlyExit: c.earlyExit,
            fixed: c.locked ? { position: c.position, width: c.width, height: c.height } : undefined,
          })),
          graph.elkEdges.map((e) => ({ from: e.sources[0], to: e.targets[0], kind: e.kind, label: e.label })),
          {
            direction: effectiveDirection,
            edgeRouting: effectiveEdgeRouting,
            origin: { x: 50, y: 50 },
          },
        );
        modeWarnings.push(...circuitRes.warnings);
        circuitEdgePlans = circuitRes.edgePlans;
        for (const [id, box] of circuitRes.positions) {
          globalPositions.set(id, { x: box.x, y: box.y });
        }
      } else {
        const layoutEdges = graph.elkEdges.filter((e) => e.kind !== 'loop' && e.kind !== 'annotate');
        const layoutRes = await ctx.elkInstance.layout({
          id: 'root',
          layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.direction': effectiveDirection,
            'elk.spacing.nodeNode': '60',
            'elk.layered.spacing.nodeNodeBetweenLayers': '80',
            'elk.edgeRouting': 'ORTHOGONAL',
            'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
            'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
          },
          children: graph.children.map((c) => ({ id: c.id, width: c.width, height: c.height })),
          edges: layoutEdges.map((e) => ({ id: e.id, sources: e.sources, targets: e.targets })),
        });
        for (const child of layoutRes.children ?? []) {
          globalPositions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
        }
      }

      const lockedIds = new Set(graph.children.filter((c) => c.locked).map((c) => c.id));
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
        if (!child.locked) continue;
        if (child.parentId) {
          const lane = laneById.get(child.parentId);
          if (!lane) continue;
          const pool = lane.parentId ? poolById.get(lane.parentId) : undefined;
          sizingPositions.set(child.id, {
            x: child.position.x + lane.position.x + (pool?.position.x ?? 0),
            y: child.position.y + lane.position.y + (pool?.position.y ?? 0),
          });
        } else {
          sizingPositions.set(child.id, { x: child.position.x, y: child.position.y });
        }
      }

      const laneHasLockedChild = new Set<string>();
      for (const frozenId of frozenIds) {
        const frozenLane = laneById.get(frozenId);
        if (frozenLane && !frozenLane.locked) laneHasLockedChild.add(frozenId);
      }

      const poolUpdates = new Map<string, { width: number; height: number }>();
      const laneUpdates = new Map<string, { x: number; y: number; width: number; height: number }>();
      const childPositions = new Map<string, LayoutPoint>();
      const planWarnings: string[] = [...modeWarnings];
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

      const batchId = ctx.newBatchId('ai-layout');

      const outcome = await ctx.writer.mutate(input.diagramId, `ai:${batchId}`, (doc) => {
        const nodesMap = doc.getMap<Y.Map<unknown>>('nodes');
        const edgesMap = doc.getMap<Y.Map<unknown>>('edges');
        const metaMap = doc.getMap<unknown>('meta');
        const diffs: AiBatchEntityDiff[] = [];
        const warnings: string[] = [...planWarnings];
        const { containersWithLockedChild, hasLockedAncestor } = collectLiveLockState(nodesMap);
        const frozenLaneIds = new Set<string>(laneHasLockedChild);

        const recordPositionPatch = (entityId: string, patch: (nodeMap: Y.Map<unknown>) => void) => {
          const nodeMap = nodesMap.get(entityId);
          if (!nodeMap) return;
          const before = snapshotMap(nodeMap);
          patch(nodeMap);
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
          const poolMap = nodesMap.get(poolId);
          if (!poolMap) continue;
          if (getNodeLockMode(poolMap) !== 'none') {
            warnings.push(`泳池 ${poolId} 已锁定，排版保持原位`);
            continue;
          }
          recordPositionPatch(poolId, (map) => patchSize(map, size.width, size.height));
        }

        for (const [laneId, frame] of laneUpdates) {
          const laneMap = nodesMap.get(laneId);
          if (!laneMap) continue;
          if (getNodeLockMode(laneMap) !== 'none' || hasLockedAncestor(laneId)) {
            warnings.push(`泳道 ${laneId} 已锁定，排版保持原位`);
            frozenLaneIds.add(laneId);
            continue;
          }
          if (containersWithLockedChild.has(laneId)) {
            warnings.push(`泳道 ${laneId} 含锁定子节点，排版保持原位`);
            frozenLaneIds.add(laneId);
            continue;
          }
          recordPositionPatch(laneId, (map) => {
            map.set('position', { x: frame.x, y: frame.y });
            patchSize(map, frame.width, frame.height);
          });
        }

        for (const child of graph.children) {
          const childMap = nodesMap.get(child.id);
          if (!childMap) continue;
          if (lockedIds.has(child.id) || frozenIds.has(child.id)) {
            warnings.push(
              lockedIds.has(child.id)
                ? `节点 ${child.id} 已锁定坐标，排版保持原位`
                : `节点 ${child.id} 位于锁定容器内，排版保持原位`,
            );
            continue;
          }
          if (getNodeLockMode(childMap) !== 'none') {
            warnings.push(`节点 ${child.id} 已锁定坐标，排版保持原位`);
            continue;
          }
          if (hasLockedAncestor(child.id, frozenLaneIds)) {
            warnings.push(`节点 ${child.id} 位于锁定容器内，排版保持原位`);
            continue;
          }
          const pos = childPositions.get(child.id);
          if (!pos) continue;
          recordPositionPatch(child.id, (map) => {
            map.set('position', { x: pos.x, y: pos.y });
          });
        }

        if (graph.pools.length === 0) {
          if (input.direction) metaMap.set('orientation', input.direction === 'RIGHT' ? 'horizontal' : 'vertical');
          if (input.mode === 'circuit') metaMap.set('paradigm', 'circuit-flow');
          else if (input.mode === 'tree') metaMap.set('paradigm', 'tree');
          if (input.edgeRouting) metaMap.set('edgeRouting', input.edgeRouting);
        }

        const nodeDiffCount = diffs.length;
        const liveNodes: FlowNode[] = [];
        const isNodeLockedLive = (id: string): boolean => {
          const m = nodesMap.get(id);
          if (!m) return false;
          return (
            lockedIds.has(id)
            || frozenIds.has(id)
            || getNodeLockMode(m) !== 'none'
            || hasLockedAncestor(id, frozenLaneIds)
          );
        };
        nodesMap.forEach((m, id) => {
          liveNodes.push({
            id,
            type: (m.get('type') as FlowNode['type']) || 'process',
            position: (m.get('position') as LayoutPoint) || { x: 0, y: 0 },
            parentId: m.get('parentId') as string | undefined,
            width: m.get('width') as number | undefined,
            height: m.get('height') as number | undefined,
            data: (m.get('data') as FlowNode['data']) || { label: id, type: 'process' },
          });
        });

        const fixedEdgeIds = new Set<string>();
        const lockedSourceEdgeIds = new Set<string>();
        const lockedTargetEdgeIds = new Set<string>();
        const bothAutoEdgeIds = new Set<string>();
        const liveEdges: FlowEdge[] = [];
        const circuitPlanByEdgeId = new Map<string, CircuitEdgePlan>();

        edgesMap.forEach((m, id) => {
          const source = m.get('source') as string;
          const target = m.get('target') as string;
          if (!source || !target) return;
          const rawData = (m.get('data') as Record<string, unknown> | undefined) ?? {};
          const sourceHandle = m.get('sourceHandle') as string | undefined;
          const targetHandle = m.get('targetHandle') as string | undefined;
          const edgeLocked = isNodeLockedLive(source) || isNodeLockedLive(target);
          if (edgeLocked) {
            fixedEdgeIds.add(id);
            liveEdges.push({
              id,
              source,
              target,
              sourceHandle,
              targetHandle,
              data: rawData as FlowEdge['data'],
            });
            return;
          }
          const sourceAuto = isAutoManagedPort(sourceHandle, rawData.autoSourceHandle as string | undefined);
          const targetAuto = isAutoManagedPort(targetHandle, rawData.autoTargetHandle as string | undefined);
          if (!sourceAuto) lockedSourceEdgeIds.add(id);
          if (!targetAuto) lockedTargetEdgeIds.add(id);
          if (sourceAuto && targetAuto) bothAutoEdgeIds.add(id);
          const kind = typeof rawData.kind === 'string' ? rawData.kind : undefined;
          let seededSource: string | undefined;
          let seededTarget: string | undefined;
          if (activeMode === 'tree') {
            const isBack = kind === 'loop' || treeBackEdgeKeys.has(`${source}|${target}|${kind ?? 'next'}`);
            if (kind === 'annotate') {
              seededSource = 'right';
              seededTarget = 'left';
            } else if (isBack) {
              seededSource = 'right';
              seededTarget = 'right';
            } else {
              seededSource = 'bottom';
              seededTarget = 'top';
            }
          } else if (activeMode === 'circuit') {
            const plan = circuitEdgePlans.get(`${source}|${target}|${kind ?? 'next'}`);
            if (plan) {
              circuitPlanByEdgeId.set(id, plan);
              seededSource = plan.sourceHandle;
              seededTarget = plan.targetHandle;
            }
          }
          liveEdges.push({
            id,
            source,
            target,
            ...(sourceAuto ? (seededSource ? { sourceHandle: seededSource } : {}) : { sourceHandle }),
            ...(targetAuto ? (seededTarget ? { targetHandle: seededTarget } : {}) : { targetHandle }),
            data: rawData as FlowEdge['data'],
          });
        });

        const distributed = distributeEdgePorts(liveNodes, liveEdges, {
          fixedEdgeIds,
          lockedSourceEdgeIds,
          lockedTargetEdgeIds,
          flowDirection: effectiveDirection,
        });
        const liveBoxes = resolveNodeWorldBoxes(liveNodes);

        for (const nextEdge of distributed) {
          if (fixedEdgeIds.has(nextEdge.id)) continue;
          const edgeMap = edgesMap.get(nextEdge.id);
          if (!edgeMap) continue;
          const before = snapshotMap(edgeMap);
          if (nextEdge.sourceHandle) edgeMap.set('sourceHandle', nextEdge.sourceHandle);
          if (nextEdge.targetHandle) edgeMap.set('targetHandle', nextEdge.targetHandle);
          const nextData = { ...(nextEdge.data ?? {}) } as Record<string, unknown>;
          const plan = circuitPlanByEdgeId.get(nextEdge.id);
          const prevRouting = nextData.routingType ?? (edgeMap.get('type') as string | undefined);
          const targetRouting =
            input.edgeRouting
              ? plan?.routingType ?? input.edgeRouting
              : plan?.routingType === 'orthogonal' && effectiveEdgeRouting === 'straight'
              ? 'orthogonal'
              : prevRouting === 'straight' || prevRouting === 'orthogonal'
              ? prevRouting
              : effectiveEdgeRouting;
          if (targetRouting === 'straight') {
            edgeMap.set('type', 'straight');
            nextData.routingType = 'straight';
            delete nextData.waypoints;
          } else {
            edgeMap.set('type', 'orthogonal');
            nextData.routingType = 'orthogonal';
            if (activeMode === 'circuit' && plan?.waypoints && bothAutoEdgeIds.has(nextEdge.id)) {
              const sBox = liveBoxes.get(nextEdge.source);
              const tBox = liveBoxes.get(nextEdge.target);
              nextData.waypoints =
                sBox && tBox
                  ? alignWaypointsToAnchors(plan.waypoints, sBox, nextEdge.sourceHandle, tBox, nextEdge.targetHandle)
                  : plan.waypoints;
            } else if (bothAutoEdgeIds.has(nextEdge.id) && 'waypoints' in nextData) {
              delete nextData.waypoints;
            }
          }
          edgeMap.set('data', nextData);
          const after = snapshotMap(edgeMap);
          if (!deepEqual(before, after)) {
            diffs.push({
              entityId: nextEdge.id,
              entityType: 'edge',
              opType: 'update',
              beforeState: before,
              afterState: after,
            });
          }
        }

        const edgeDiffCount = diffs.length - nodeDiffCount;
        return { diffs, nodeDiffCount, edgeDiffCount, warnings: Array.from(new Set(warnings)) };
      });

      if (outcome.result.diffs.length > 0) {
        const { nodeDiffCount, edgeDiffCount } = outcome.result;
        const summary = edgeDiffCount > 0
          ? `AI 自动排版调整了 ${nodeDiffCount} 个节点坐标与 ${edgeDiffCount} 条连线端口`
          : `AI 自动排版调整了 ${nodeDiffCount} 个节点坐标`;
        ctx.batchManager.recordBatch({
          batchId,
          diagramId: input.diagramId,
          agentName: input.agentName,
          summary,
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
    },
  );
}

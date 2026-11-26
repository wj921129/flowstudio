import ELK from 'elkjs/lib/elk.bundled.js';
import {
  type CircuitEdgePlan,
  distributeEdgePorts,
  isAutoManagedPort,
  layoutCircuitFlowGraph,
  layoutTreeGraph,
  type FlowEdge,
  type FlowNode,
  type XYPosition,
} from '@flowstudio/shared';

export interface LayoutOptions {
  direction?: 'RIGHT' | 'DOWN';
  mode?: 'circuit' | 'layered' | 'tree';
  edgeRouting?: 'orthogonal' | 'straight';
  nodeSpacing?: number;
  layerSpacing?: number;
  padding?: number;
}

const defaultOptions: Required<Omit<LayoutOptions, 'mode' | 'edgeRouting'>> & { mode: 'circuit' | 'layered' | 'tree'; edgeRouting?: 'orthogonal' | 'straight' } = {
  direction: 'RIGHT',
  mode: 'layered',
  edgeRouting: undefined,
  nodeSpacing: 60,
  layerSpacing: 80,
  padding: 40,
};

const elkInstance = new ELK();

function inferDiagramEdgeRouting(edges: FlowEdge[], explicit?: 'orthogonal' | 'straight'): 'orthogonal' | 'straight' {
  if (explicit) return explicit;
  const biz = edges.filter((e) => e.data?.kind !== 'loop' && e.data?.kind !== 'annotate');
  if (biz.length === 0) return 'orthogonal';
  const straightCount = biz.filter((e) => e.type === 'straight' || e.data?.routingType === 'straight').length;
  return straightCount / biz.length > 0.5 ? 'straight' : 'orthogonal';
}

function refreshLayoutEdgePorts(
  nodes: FlowNode[],
  edges: FlowEdge[],
  opts?: {
    treeBackKeys?: Set<string>;
    isTreeMode?: boolean;
    circuitPlans?: Map<string, CircuitEdgePlan>;
    flowDirection?: 'DOWN' | 'RIGHT';
    explicitEdgeRouting?: 'orthogonal' | 'straight';
    inferredRouting?: 'orthogonal' | 'straight';
  },
): FlowEdge[] {
  if (edges.length === 0) return edges;
  const fixedEdgeIds = new Set<string>();
  const lockedSourceEdgeIds = new Set<string>();
  const lockedTargetEdgeIds = new Set<string>();
  const bothAutoIds = new Set<string>();
  const nodeLocked = new Map<string, boolean>();
  for (const n of nodes) {
    nodeLocked.set(n.id, n.data?.lockMode === 'position' || n.data?.lockMode === 'full');
  }
  const planById = new Map<string, CircuitEdgePlan>();
  const prepared = edges.map((edge) => {
    if (nodeLocked.get(edge.source) || nodeLocked.get(edge.target)) {
      fixedEdgeIds.add(edge.id);
      return edge;
    }
    const sourceAuto = isAutoManagedPort(edge.sourceHandle, edge.data?.autoSourceHandle);
    const targetAuto = isAutoManagedPort(edge.targetHandle, edge.data?.autoTargetHandle);
    if (!sourceAuto) lockedSourceEdgeIds.add(edge.id);
    if (!targetAuto) lockedTargetEdgeIds.add(edge.id);
    if (sourceAuto && targetAuto) bothAutoIds.add(edge.id);
    const kind = typeof edge.data?.kind === 'string' ? edge.data.kind : undefined;
    let seededSource = edge.sourceHandle;
    let seededTarget = edge.targetHandle;
    const plan = opts?.circuitPlans?.get(`${edge.source}|${edge.target}|${kind ?? 'next'}`);
    if (plan) planById.set(edge.id, plan);
    if (opts?.isTreeMode) {
      const isBack = kind === 'loop' || Boolean(opts.treeBackKeys?.has(`${edge.source}|${edge.target}|${kind ?? 'next'}`));
      if (sourceAuto) seededSource = kind === 'annotate' || isBack ? 'right' : 'bottom';
      if (targetAuto) seededTarget = kind === 'annotate' ? 'left' : isBack ? 'right' : 'top';
    } else if (plan) {
      if (sourceAuto) seededSource = plan.sourceHandle;
      if (targetAuto) seededTarget = plan.targetHandle;
    }
    const nextData = edge.data ? { ...edge.data } : undefined;
    if (nextData && bothAutoIds.has(edge.id) && 'waypoints' in nextData) delete nextData.waypoints;
    return {
      ...edge,
      ...(seededSource ? { sourceHandle: seededSource } : {}),
      ...(seededTarget ? { targetHandle: seededTarget } : {}),
      ...(nextData ? { data: nextData } : {}),
    };
  });
  const distributed = distributeEdgePorts(nodes, prepared, {
    fixedEdgeIds,
    lockedSourceEdgeIds,
    lockedTargetEdgeIds,
    flowDirection: opts?.flowDirection,
  });
  return distributed.map((edge) => {
    if (fixedEdgeIds.has(edge.id)) return edge;
    const plan = planById.get(edge.id);
    const prevRouting = edge.data?.routingType ?? (edge.type as 'orthogonal' | 'straight' | undefined);
    const targetRouting = opts?.explicitEdgeRouting
      ? plan?.routingType ?? opts.explicitEdgeRouting
      : plan?.routingType === 'orthogonal' && opts?.inferredRouting === 'straight'
      ? 'orthogonal'
      : prevRouting === 'straight' || prevRouting === 'orthogonal'
      ? prevRouting
      : opts?.inferredRouting ?? 'orthogonal';
    const nextData = { ...(edge.data ?? {}), routingType: targetRouting } as Record<string, unknown>;
    if (targetRouting === 'straight') {
      delete nextData.waypoints;
      return { ...edge, type: 'straight', data: nextData as FlowEdge['data'] };
    }
    if (plan?.waypoints && bothAutoIds.has(edge.id)) {
      nextData.waypoints = plan.waypoints;
    }
    return { ...edge, type: 'orthogonal', data: nextData as FlowEdge['data'] };
  });
}

export async function layoutDiagram(
  nodes: FlowNode[],
  edges: FlowEdge[],
  options?: LayoutOptions,
): Promise<{ nodes: FlowNode[]; edges: FlowEdge[] }> {
  if (!nodes || nodes.length === 0) {
    return { nodes: [], edges: edges ?? [] };
  }

  const opts = { ...defaultOptions, ...options };
  const hasPoolOrLane = nodes.some((n) => n.type === 'pool' || n.type === 'lane');

  if (hasPoolOrLane) {
    return layoutSwimlaneDiagram(nodes, edges, opts);
  }
  if (opts.mode === 'tree') {
    return layoutTreeDiagram(nodes, edges, opts.edgeRouting);
  }
  if (opts.mode === 'circuit') {
    return layoutCircuitDiagram(nodes, edges, options?.direction ?? 'DOWN', opts.edgeRouting);
  }

  return layoutStandardFlowchart(nodes, edges, opts);
}

function layoutCircuitDiagram(
  nodes: FlowNode[],
  edges: FlowEdge[],
  direction: 'DOWN' | 'RIGHT',
  explicitEdgeRouting?: 'orthogonal' | 'straight',
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const inferredRouting = inferDiagramEdgeRouting(edges, explicitEdgeRouting);
  const circuitRes = layoutCircuitFlowGraph(
    nodes.map((n) => {
      const w = n.width ?? (n.style?.width as number) ?? 160;
      const h = n.height ?? (n.style?.height as number) ?? 80;
      const locked = n.data?.lockMode === 'position' || n.data?.lockMode === 'full';
      const nw = typeof w === 'number' ? w : 160;
      const nh = typeof h === 'number' ? h : 80;
      return {
        id: n.id,
        width: nw,
        height: nh,
        type: n.type,
        label: n.data?.label,
        role: typeof n.data?.role === 'string' ? n.data.role : undefined,
        attachTo: typeof n.data?.attachTo === 'string' ? n.data.attachTo : undefined,
        earlyExit: typeof n.data?.earlyExit === 'boolean' ? n.data.earlyExit : undefined,
        fixed: locked ? { position: n.position, width: nw, height: nh } : undefined,
      };
    }),
    edges.map((e) => ({
      from: e.source,
      to: e.target,
      kind: typeof e.data?.kind === 'string' ? e.data.kind : undefined,
      label: e.data?.label,
    })),
    { direction, edgeRouting: inferredRouting, origin: { x: 50, y: 50 } },
  );

  const nextNodes = nodes.map((n) => {
    if (n.data?.lockMode === 'position' || n.data?.lockMode === 'full') return n;
    const box = circuitRes.positions.get(n.id);
    if (!box) return n;
    return { ...n, position: { x: box.x, y: box.y } };
  });

  const nextEdges = refreshLayoutEdgePorts(nextNodes, edges, {
    circuitPlans: circuitRes.edgePlans,
    flowDirection: direction,
    explicitEdgeRouting,
    inferredRouting,
  });
  return { nodes: nextNodes, edges: nextEdges };
}

function layoutTreeDiagram(
  nodes: FlowNode[],
  edges: FlowEdge[],
  explicitEdgeRouting?: 'orthogonal' | 'straight',
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const treeRes = layoutTreeGraph(
    nodes.map((n) => {
      const w = n.width ?? (n.style?.width as number) ?? 160;
      const h = n.height ?? (n.style?.height as number) ?? 80;
      const locked = n.data?.lockMode === 'position' || n.data?.lockMode === 'full';
      return {
        id: n.id,
        width: typeof w === 'number' ? w : 160,
        height: typeof h === 'number' ? h : 80,
        role: typeof n.data?.role === 'string' ? n.data.role : undefined,
        attachTo: typeof n.data?.attachTo === 'string' ? n.data.attachTo : undefined,
        fixed: locked ? { position: n.position, width: typeof w === 'number' ? w : 160, height: typeof h === 'number' ? h : 80 } : undefined,
      };
    }),
    edges.map((e) => ({
      from: e.source,
      to: e.target,
      kind: typeof e.data?.kind === 'string' ? e.data.kind : undefined,
    })),
    { origin: { x: 50, y: 50 } },
  );

  const nextNodes = nodes.map((n) => {
    if (n.data?.lockMode === 'position' || n.data?.lockMode === 'full') return n;
    const box = treeRes.positions.get(n.id);
    if (!box) return n;
    return { ...n, position: { x: box.x, y: box.y } };
  });

  const nextEdges = refreshLayoutEdgePorts(nextNodes, edges, {
    treeBackKeys: treeRes.backEdgeKeys,
    isTreeMode: true,
    flowDirection: 'DOWN',
    explicitEdgeRouting,
    inferredRouting: inferDiagramEdgeRouting(edges, explicitEdgeRouting),
  });
  return { nodes: nextNodes, edges: nextEdges };
}

async function layoutStandardFlowchart(
  nodes: FlowNode[],
  edges: FlowEdge[],
  opts: typeof defaultOptions,
): Promise<{ nodes: FlowNode[]; edges: FlowEdge[] }> {
  try {
    const elkChildren = nodes.map((node) => {
      const w = node.width ?? (node.style?.width as number) ?? 160;
      const h = node.height ?? (node.style?.height as number) ?? 80;
      return {
        id: node.id,
        width: typeof w === 'number' ? w : 160,
        height: typeof h === 'number' ? h : 80,
      };
    });

    const elkEdges = edges
      .filter((e) => e.data?.kind !== 'loop' && e.data?.kind !== 'annotate')
      .map((edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
      }));

    const elkGraph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': opts.direction,
        'elk.spacing.nodeNode': String(opts.nodeSpacing),
        'elk.layered.spacing.nodeNodeBetweenLayers': String(opts.layerSpacing),
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      },
      children: elkChildren,
      edges: elkEdges,
    };

    const result = await elkInstance.layout(elkGraph);

    const positionMap = new Map<string, { x: number; y: number }>();
    if (result.children) {
      for (const c of result.children) {
        positionMap.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });
      }
    }

    const waypointsMap = new Map<string, XYPosition[]>();
    if (result.edges) {
      for (const e of result.edges) {
        const sections = (e as any).sections;
        if (sections && Array.isArray(sections) && sections.length > 0) {
          const bendPoints: XYPosition[] = [];
          for (const s of sections) {
            if (s.bendPoints && Array.isArray(s.bendPoints)) {
              for (const bp of s.bendPoints) {
                bendPoints.push({ x: bp.x, y: bp.y });
              }
            }
          }
          if (bendPoints.length > 0) {
            waypointsMap.set(e.id, bendPoints);
          }
        }
      }
    }

    const nextNodes = nodes.map((node) => {
      if (node.data?.lockMode === 'position' || node.data?.lockMode === 'full') {
        return node;
      }
      const pos = positionMap.get(node.id);
      if (!pos) return node;
      return {
        ...node,
        position: { x: pos.x, y: pos.y },
      };
    });

    const refreshedEdges = refreshLayoutEdgePorts(nextNodes, edges, {
      flowDirection: opts.direction,
      explicitEdgeRouting: opts.edgeRouting,
      inferredRouting: inferDiagramEdgeRouting(edges, opts.edgeRouting),
    });

    const nextEdges = refreshedEdges.map((edge) => {
      if (edge.type === 'straight' || edge.data?.routingType === 'straight') return edge;
      const wp = waypointsMap.get(edge.id);
      if (!wp || wp.length === 0) return edge;
      return {
        ...edge,
        data: {
          ...(edge.data || {}),
          waypoints: wp,
        },
      };
    });

    return { nodes: nextNodes, edges: nextEdges };
  } catch (error) {
    console.error('[elk-layout] Standard layout failed, returning original graph:', error);
    return { nodes, edges };
  }
}

async function layoutSwimlaneDiagram(
  nodes: FlowNode[],
  edges: FlowEdge[],
  opts: typeof defaultOptions,
): Promise<{ nodes: FlowNode[]; edges: FlowEdge[] }> {
  try {
    const pools = nodes.filter((n) => n.type === 'pool');
    const lanes = nodes.filter((n) => n.type === 'lane');

    if (pools.length === 0 || lanes.length === 0) {
      return layoutStandardFlowchart(nodes, edges, opts);
    }

    const primaryPool = pools[0];
    const isHorizontal = (primaryPool.data?.orientation ?? 'horizontal') === 'horizontal';
    const headerSize = primaryPool.data?.headerSize ?? 40;

    const laneMap = new Map<string, FlowNode>();
    const laneIndexMap = new Map<string, number>();
    lanes.forEach((lane, idx) => {
      laneMap.set(lane.id, lane);
      laneIndexMap.set(lane.id, idx);
    });

    const laneChildren = nodes.filter((n) => n.parentId && laneMap.has(n.parentId));
    const flowDirection = isHorizontal ? 'RIGHT' : 'DOWN';

    const globalLayout = await layoutStandardFlowchart(laneChildren, edges, {
      ...opts,
      direction: flowDirection,
    });

    const globalPosMap = new Map<string, { x: number; y: number }>();
    globalLayout.nodes.forEach((n) => {
      globalPosMap.set(n.id, n.position);
    });

    const padding = 40;
    const laneBounds = new Map<string, { minX: number; maxX: number; minY: number; maxY: number; count: number }>();
    lanes.forEach((lane) => {
      laneBounds.set(lane.id, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, count: 0 });
    });

    for (const child of laneChildren) {
      const pos = globalPosMap.get(child.id) ?? child.position;
      const w = child.width ?? (child.style?.width as number) ?? 160;
      const h = child.height ?? (child.style?.height as number) ?? 80;
      const b = laneBounds.get(child.parentId!);
      if (b) {
        b.minX = Math.min(b.minX, pos.x);
        b.maxX = Math.max(b.maxX, pos.x + w);
        b.minY = Math.min(b.minY, pos.y);
        b.maxY = Math.max(b.maxY, pos.y + h);
        b.count += 1;
      }
    }

    let globalMinX = Infinity;
    let globalMaxX = -Infinity;
    let globalMinY = Infinity;
    let globalMaxY = -Infinity;

    laneBounds.forEach((b) => {
      if (b.count > 0) {
        globalMinX = Math.min(globalMinX, b.minX);
        globalMaxX = Math.max(globalMaxX, b.maxX);
        globalMinY = Math.min(globalMinY, b.minY);
        globalMaxY = Math.max(globalMaxY, b.maxY);
      }
    });

    if (globalMinX === Infinity) globalMinX = 0;
    if (globalMaxX === -Infinity) globalMaxX = 700;
    if (globalMinY === Infinity) globalMinY = 0;
    if (globalMaxY === -Infinity) globalMaxY = 400;

    let currentOffset = isHorizontal ? headerSize : 0;
    const laneLayoutInfos = new Map<string, { x: number; y: number; width: number; height: number; innerMinY: number; innerMinX: number }>();

    for (const lane of lanes) {
      const b = laneBounds.get(lane.id)!;
      let laneW = isHorizontal ? Math.max(800, globalMaxX - globalMinX + padding * 2) : 240;
      let laneH = isHorizontal ? 200 : Math.max(480, globalMaxY - globalMinY + 60 + padding);

      if (b.count > 0) {
        if (isHorizontal) {
          const contentH = b.maxY - b.minY + padding * 2;
          laneH = Math.max(laneH, contentH);
        } else {
          const contentW = b.maxX - b.minX + padding * 2;
          laneW = Math.max(laneW, contentW);
        }
      }

      const laneX = isHorizontal ? 0 : currentOffset;
      const laneY = isHorizontal ? currentOffset : headerSize;

      laneLayoutInfos.set(lane.id, {
        x: laneX,
        y: laneY,
        width: laneW,
        height: laneH,
        innerMinY: b.count > 0 ? b.minY : 0,
        innerMinX: b.count > 0 ? b.minX : 0,
      });

      currentOffset += isHorizontal ? laneH : laneW;
    }

    const totalPoolWidth = isHorizontal
      ? Math.max(800, globalMaxX - globalMinX + padding * 2)
      : Math.max(240, currentOffset);
    const maxVerticalLaneH = Math.max(480, ...Array.from(laneLayoutInfos.values()).map((info) => info.height));
    const totalPoolHeight = isHorizontal
      ? currentOffset
      : headerSize + maxVerticalLaneH;

    const nextNodes = nodes.map((node) => {
      if (node.id === primaryPool.id) {
        return {
          ...node,
          width: totalPoolWidth,
          height: totalPoolHeight,
          style: {
            ...(node.style || {}),
            width: totalPoolWidth,
            height: totalPoolHeight,
          },
        };
      }

      const laneInfo = laneLayoutInfos.get(node.id);
      if (laneInfo) {
        const laneW = isHorizontal ? totalPoolWidth : laneInfo.width;
        const laneH = isHorizontal ? laneInfo.height : maxVerticalLaneH;
        return {
          ...node,
          position: { x: laneInfo.x, y: laneInfo.y },
          width: laneW,
          height: laneH,
          style: {
            ...(node.style || {}),
            width: laneW,
            height: laneH,
          },
        };
      }

      if (node.parentId && laneLayoutInfos.has(node.parentId)) {
        if (node.data?.lockMode === 'position' || node.data?.lockMode === 'full') {
          return node;
        }
        const laneInfo = laneLayoutInfos.get(node.parentId)!;
        const globalPos = globalPosMap.get(node.id) ?? node.position;

        const localX = isHorizontal
          ? Math.max(64, globalPos.x - globalMinX + 64)
          : Math.max(padding, globalPos.x - laneInfo.innerMinX + padding);
        const localY = isHorizontal
          ? Math.max(padding, globalPos.y - laneInfo.innerMinY + padding)
          : Math.max(60, globalPos.y - globalMinY + 60);

        return {
          ...node,
          position: { x: localX, y: localY },
        };
      }

      return node;
    });

    return {
      nodes: nextNodes,
      edges: refreshLayoutEdgePorts(nextNodes, edges, {
        flowDirection,
        explicitEdgeRouting: opts.edgeRouting,
        inferredRouting: inferDiagramEdgeRouting(edges, opts.edgeRouting),
      }),
    };
  } catch (error) {
    console.error('[elk-layout] Swimlane layout failed, returning original graph:', error);
    return { nodes, edges };
  }
}

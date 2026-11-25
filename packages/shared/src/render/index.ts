import { distributeEdgePorts, hasExplicitBorderOffset } from '../edge-port-allocator.js';
import { normalizeSpec } from '../spec/normalize.js';
import type { DiagramSpec, Paradigm, SpecEdgeKind } from '../spec/types.js';
import type { FlowEdge } from '../types.js';
import { ORIGIN } from './constants.js';
import { renderSwimlane } from './swimlane.js';
import { renderTiered } from './tiered.js';
import { renderTimeline } from './timeline.js';
import { renderTree } from './tree.js';
import type { RenderContext, RenderOptions, RenderResult } from './types.js';
import { renderVerticalFlowGrid } from './vertical-flow-grid.js';

const RENDERERS: Record<Paradigm, (n: ReturnType<typeof normalizeSpec>, ctx: RenderContext) => RenderResult> = {
  'vertical-flow': renderVerticalFlowGrid,
  'timeline-annotated': renderTimeline,
  swimlane: renderSwimlane,
  'tiered-dag': renderTiered,
  tree: renderTree,
};

const edgeKeyOf = (source: string, target: string, kind?: SpecEdgeKind | unknown) =>
  `${source}|${target}|${typeof kind === 'string' && kind ? kind : 'next'}`;

export function renderSpec(spec: DiagramSpec, opts: RenderOptions = {}): RenderResult {
  const n = normalizeSpec(spec);
  const ctx: RenderContext = {
    idPrefix: opts.idPrefix ?? '',
    origin: opts.origin ?? { ...ORIGIN },
    fixed: opts.fixed ?? new Map(),
    laneSizes: opts.laneSizes ?? new Map(),
    poolPosition: opts.poolPosition,
    obstacles: opts.obstacles ?? new Map(),
  };
  const result = RENDERERS[n.paradigm](n, ctx);

  const specEdgesByKey = new Map<string, (typeof n.edges)[number]>();
  for (const se of n.edges) {
    specEdgesByKey.set(edgeKeyOf(`${ctx.idPrefix}${se.from}`, `${ctx.idPrefix}${se.to}`, se.kind), se);
  }

  const protectedByKey = new Map<string, FlowEdge>();
  for (const pe of opts.protectedEdges ?? []) {
    protectedByKey.set(edgeKeyOf(pe.source, pe.target, pe.data?.kind), pe);
  }

  const fixedEdgeIds = new Set<string>();
  const lockedSourceEdgeIds = new Set<string>();
  const lockedTargetEdgeIds = new Set<string>();
  const seenKeys = new Set<string>();

  const enrichedEdges = result.edges.map((edge) => {
    const key = edgeKeyOf(edge.source, edge.target, edge.data?.kind);
    seenKeys.add(key);
    const protectedEdge = protectedByKey.get(key);
    if (protectedEdge) {
      fixedEdgeIds.add(edge.id);
      return {
        ...edge,
        ...(protectedEdge.sourceHandle ? { sourceHandle: protectedEdge.sourceHandle } : {}),
        ...(protectedEdge.targetHandle ? { targetHandle: protectedEdge.targetHandle } : {}),
        data: { ...(edge.data ?? {}), ...(protectedEdge.data ?? {}) },
      };
    }

    const specEdge = specEdgesByKey.get(key);
    const nextSourceHandle = specEdge?.sourceHandle ?? edge.sourceHandle;
    const nextTargetHandle = specEdge?.targetHandle ?? edge.targetHandle;
    if (specEdge?.sourceHandle && hasExplicitBorderOffset(specEdge.sourceHandle)) {
      lockedSourceEdgeIds.add(edge.id);
    }
    if (specEdge?.targetHandle && hasExplicitBorderOffset(specEdge.targetHandle)) {
      lockedTargetEdgeIds.add(edge.id);
    }

    const strokeStyle = specEdge?.strokeStyle ?? (specEdge?.kind === 'annotate' ? 'dashed' : undefined);
    const prevStyle = edge.data?.style;
    const nextStyle = strokeStyle ? { ...(prevStyle ?? {}), strokeStyle } : prevStyle;
    const nextData = nextStyle ? { ...(edge.data ?? {}), style: nextStyle } : edge.data;

    return {
      ...edge,
      ...(nextSourceHandle ? { sourceHandle: nextSourceHandle } : {}),
      ...(nextTargetHandle ? { targetHandle: nextTargetHandle } : {}),
      ...(nextData ? { data: nextData } : {}),
    };
  });

  const obstacleEdges = (opts.protectedEdges ?? []).filter(
    (pe) => !seenKeys.has(edgeKeyOf(pe.source, pe.target, pe.data?.kind)),
  );

  const distributedEdges = distributeEdgePorts(result.nodes, enrichedEdges, {
    fixedEdgeIds,
    lockedSourceEdgeIds,
    lockedTargetEdgeIds,
    obstacleEdges,
  });

  return {
    ...result,
    edges: distributedEdges,
  };
}
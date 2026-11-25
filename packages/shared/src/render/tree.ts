import { getDefaultNodeSize } from '../node-registry.js';
import type { NormalizedSpec } from '../spec/normalize.js';
import type { FlowEdge, FlowNode, FlowNodeType } from '../types.js';
import { layoutTreeGraph } from './tree-layout.js';
import type { RenderContext, RenderResult } from './types.js';

export function renderTree(n: NormalizedSpec, ctx: RenderContext): RenderResult {
  const eid = (id: string) => ctx.idPrefix + id;
  const nodeById = new Map(n.nodes.map((x) => [x.id, x]));
  const layout = layoutTreeGraph(
    n.nodes.map((x) => {
      const s = getDefaultNodeSize(x.type ?? (x.role === 'annotation' ? 'comment' : 'process'));
      const f = ctx.fixed.get(x.id);
      return {
        id: x.id,
        width: f?.width ?? s.width,
        height: f?.height ?? s.height,
        role: x.role,
        attachTo: x.attachTo,
        fixed: f,
      };
    }),
    n.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind })),
    { origin: ctx.origin },
  );

  const warnings = [...n.warnings, ...layout.warnings];
  const nodes: FlowNode[] = [];
  for (const src of n.nodes) {
    const p = layout.positions.get(src.id);
    if (!p) continue;
    const type: FlowNodeType = src.type ?? (src.role === 'annotation' ? 'comment' : 'process');
    nodes.push({
      id: eid(src.id),
      type,
      position: { x: p.x, y: p.y },
      width: p.width,
      height: p.height,
      data: {
        label: src.label,
        type,
        role: src.role,
        ...(src.description ? { description: src.description } : {}),
        ...(src.attachTo ? { attachTo: eid(src.attachTo) } : {}),
      },
    });
  }

  const edges: FlowEdge[] = n.edges.map((e) => {
    const routing = e.routingType ?? n.edgeRouting ?? 'orthogonal';
    const isAnnotate = e.kind === 'annotate';
    const isBack = e.kind === 'loop' || layout.backEdgeKeys.has(`${e.from}|${e.to}|${e.kind ?? 'next'}`);
    let sourceHandle = 'bottom';
    let targetHandle = 'top';
    if (isAnnotate) {
      sourceHandle = 'right';
      targetHandle = 'left';
    } else if (isBack) {
      sourceHandle = 'right';
      targetHandle = 'right';
    }
    return {
      id: `${ctx.idPrefix}e-${e.from}-${e.to}-${e.kind}`,
      source: eid(e.from),
      target: eid(e.to),
      type: routing,
      sourceHandle,
      targetHandle,
      data: {
        kind: e.kind,
        routingType: routing,
        ...(e.label ? { label: e.label } : {}),
      },
    };
  });

  return { nodes, edges, warnings };
}
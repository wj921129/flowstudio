import { getDefaultNodeSize } from '../node-registry.js';
import type { NormalizedSpec } from '../spec/normalize.js';
import type { FlowEdge, FlowNode, FlowNodeType } from '../types.js';
import { layoutCircuitFlowGraph } from './circuit-flow-layout.js';
import type { RenderContext, RenderResult } from './types.js';

export function renderCircuitFlow(n: NormalizedSpec, ctx: RenderContext): RenderResult {
  const eid = (id: string) => ctx.idPrefix + id;
  const direction = n.orientation === 'horizontal' ? 'RIGHT' : 'DOWN';

  const layout = layoutCircuitFlowGraph(
    n.nodes.map((x) => {
      const s = getDefaultNodeSize(x.type ?? (x.role === 'annotation' ? 'comment' : 'process'));
      const f = ctx.fixed.get(x.id);
      return {
        id: x.id,
        width: f?.width ?? s.width,
        height: f?.height ?? s.height,
        type: x.type ?? (x.role === 'annotation' ? 'comment' : 'process'),
        label: x.label,
        role: x.role,
        attachTo: x.attachTo,
        earlyExit: x.earlyExit,
        fixed: f,
      };
    }),
    n.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind, label: e.label })),
    {
      direction,
      edgeRouting: n.edgeRouting,
      origin: ctx.origin,
    },
  );

  const warnings = [...n.warnings, ...layout.warnings];
  const nodes: FlowNode[] = [];
  for (const src of n.nodes) {
    const p = layout.positions.get(src.id);
    if (!p) {
      warnings.push(`节点 ${src.id} 未参与布局，跳过`);
      continue;
    }
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
        ...(src.earlyExit !== undefined ? { earlyExit: src.earlyExit } : {}),
      },
    });
  }

  const edges: FlowEdge[] = [];
  for (const e of n.edges) {
    if (!layout.positions.has(e.from) || !layout.positions.has(e.to)) {
      warnings.push(`连线 ${e.from} -> ${e.to} 端点未布局，跳过`);
      continue;
    }
    const key = `${e.from}|${e.to}|${e.kind}`;
    const plan = layout.edgePlans.get(key);
    const routing = e.routingType ?? plan?.routingType ?? n.edgeRouting ?? 'orthogonal';
    edges.push({
      id: `${ctx.idPrefix}e-${e.from}-${e.to}-${e.kind}`,
      source: eid(e.from),
      target: eid(e.to),
      type: routing,
      sourceHandle: plan?.sourceHandle ?? (direction === 'RIGHT' ? 'right' : 'bottom'),
      targetHandle: plan?.targetHandle ?? (direction === 'RIGHT' ? 'left' : 'top'),
      data: {
        kind: e.kind,
        routingType: routing,
        ...(e.label ? { label: e.label } : {}),
        ...(routing === 'orthogonal' && plan?.waypoints ? { waypoints: plan.waypoints } : {}),
      },
    });
  }

  return { nodes, edges, warnings };
}

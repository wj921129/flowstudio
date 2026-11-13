import { diagramSpecSchema } from './spec-schema.js';
import type { DiagramSpec, Paradigm, SpecEdge, SpecEdgeKind, SpecNode, SpecRole } from './types.js';

export class SpecError extends Error {}

export interface NormalizedSpec {
  paradigm: Paradigm;
  title?: string;
  lanes: Array<{ id: string; label: string }>;
  nodes: Array<SpecNode & { role: SpecRole }>;
  edges: Array<SpecEdge & { kind: SpecEdgeKind }>;
  mainOrder: string[];
  warnings: string[];
}

export function normalizeSpec(spec: DiagramSpec): NormalizedSpec {
  const parsed = diagramSpecSchema.safeParse(spec);
  if (!parsed.success) {
    throw new SpecError(`DiagramSpec 校验失败: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ')}`);
  }
  const s = parsed.data;
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const n of s.nodes) {
    if (seen.has(n.id)) throw new SpecError(`节点 id 重复: ${n.id}`);
    seen.add(n.id);
  }
  const allEdges: Array<SpecEdge & { kind: SpecEdgeKind }> = s.edges.map((e) => ({ ...e, kind: e.kind ?? 'next' }));
  for (const e of allEdges) {
    if (!seen.has(e.from) || !seen.has(e.to)) throw new SpecError(`连线端点不存在: ${e.from} -> ${e.to}`);
  }

  let edges = allEdges;
  if (s.paradigm === 'tree') {
    if (!edges.some((e) => e.kind === 'tree')) throw new SpecError('tree 范式必须使用 kind=tree 的边定义父子');
    if (edges.some((e) => e.kind !== 'tree')) throw new SpecError('tree 范式仅接受 kind=tree 的边');
  } else {
    const dropped = edges.filter((e) => e.kind === 'tree');
    if (dropped.length > 0) {
      warnings.push(`非 tree 范式忽略 ${dropped.length} 条 tree 边`);
      edges = edges.filter((e) => e.kind !== 'tree');
    }
  }

  const annIds = new Set<string>([
    ...s.nodes.filter((n) => n.attachTo).map((n) => n.id),
    ...edges.filter((e) => e.kind === 'annotate').map((e) => e.to),
  ]);
  const branchIds = new Set(edges.filter((e) => e.kind === 'branch').map((e) => e.to));
  const nodes: Array<SpecNode & { role: SpecRole }> = s.nodes.map((n) => {
    const isAnn = annIds.has(n.id);
    const isBranch = branchIds.has(n.id);
    if (isAnn && isBranch) throw new SpecError(`节点 ${n.id} 同时被推断为附注与分支`);
    const role: SpecRole = isAnn ? 'annotation' : isBranch ? 'branch' : 'main';
    if (n.role && n.role !== role) throw new SpecError(`节点 ${n.id} 显式 role 与推断冲突`);
    return { ...n, role };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const explicit = new Map(s.nodes.map((n) => [n.id, n.role]));
  const queue = nodes.filter((n) => n.role === 'branch').map((n) => n.id);
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const e of edges) {
      if (e.from !== id || (e.kind !== 'next' && e.kind !== 'branch')) continue;
      const target = byId.get(e.to)!;
      if (target.role !== 'main') continue;
      if (explicit.get(target.id) === 'main') throw new SpecError(`节点 ${target.id} 显式 role 与分支闭包推断冲突`);
      target.role = 'branch';
      queue.push(target.id);
    }
  }

  for (const e of edges.filter((x) => x.kind === 'annotate')) {
    const target = byId.get(e.to)!;
    if (target.attachTo && target.attachTo !== e.from) throw new SpecError(`附注 ${e.to} 的 attachTo 与 annotate 边宿主不一致`);
    target.attachTo = e.from;
  }
  for (const n of nodes) {
    if (n.role !== 'annotation') continue;
    if (!n.attachTo) throw new SpecError(`附注 ${n.id} 缺少宿主`);
    const host = byId.get(n.attachTo);
    if (!host) throw new SpecError(`附注宿主不存在: ${n.attachTo}`);
    if (host.role !== 'main') throw new SpecError(`附注宿主必须是主干节点: ${n.attachTo}`);
    if (!edges.some((e) => e.kind === 'annotate' && e.from === n.attachTo && e.to === n.id)) {
      edges.push({ from: n.attachTo, to: n.id, kind: 'annotate' });
    }
  }

  if (s.paradigm === 'tiered-dag' || s.paradigm === 'tree') {
    if (nodes.some((n) => n.role !== 'main')) throw new SpecError(`${s.paradigm} 范式不允许附注或分支节点`);
    const allowed = s.paradigm === 'tree' ? 'tree' : 'next';
    if (edges.some((e) => e.kind !== allowed)) throw new SpecError(`${s.paradigm} 范式仅接受 kind=${allowed} 的边`);
  }

  if (s.paradigm === 'swimlane') {
    const laneIds = new Set((s.lanes ?? []).map((l) => l.id));
    for (const n of nodes) {
      if (n.role === 'annotation') n.laneId = n.laneId ?? byId.get(n.attachTo!)!.laneId;
      if (!n.laneId || !laneIds.has(n.laneId)) throw new SpecError(`swimlane 节点 ${n.id} 缺少合法 laneId`);
    }
    for (const e of edges) {
      if (e.kind === 'branch' && byId.get(e.from)!.laneId !== byId.get(e.to)!.laneId) {
        throw new SpecError(`swimlane 跨泳道 branch 边不被支持: ${e.from} -> ${e.to}`);
      }
    }
  }

  if (s.paradigm === 'tree') {
    const parentCount = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      if (e.from === e.to) throw new SpecError(`tree 自环不被支持: ${e.from}`);
      parentCount.set(e.to, (parentCount.get(e.to) ?? 0) + 1);
      adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
    }
    for (const [id, count] of parentCount) {
      if (count > 1) throw new SpecError(`tree 节点 ${id} 存在多个父节点（矩阵结构请改用 tiered-dag）`);
    }
    const state = new Map<string, number>();
    const dfs = (id: string) => {
      if (state.get(id) === 1) throw new SpecError('tree 范式存在环');
      if (state.get(id) === 2) return;
      state.set(id, 1);
      for (const next of adj.get(id) ?? []) dfs(next);
      state.set(id, 2);
    };
    for (const n of nodes) dfs(n.id);
  }

  const mainOrder = nodes.filter((n) => n.role === 'main').map((n) => n.id);
  const order = new Map<string, number>(mainOrder.map((id, i) => [id, i]));
  const anchor = (id: string, visited: Set<string>): number => {
    if (visited.has(id)) throw new SpecError(`branch 锚定存在环: ${id}`);
    visited.add(id);
    const inc = edges.find((e) => e.kind === 'branch' && e.to === id);
    if (!inc) return order.get(id) ?? -1;
    const from = byId.get(inc.from)!;
    return from.role === 'branch' ? anchor(from.id, visited) : order.get(from.id) ?? -1;
  };
  for (const n of nodes) if (n.role === 'branch') order.set(n.id, anchor(n.id, new Set()));
  const regAnchor = (id: string): string => {
    let cur = id;
    const seen = new Set<string>();
    while (!seen.has(cur)) {
      seen.add(cur);
      if (byId.get(cur)!.role === 'main') return cur;
      const inc = edges.find((e) => (e.kind === 'branch' || e.kind === 'next') && e.to === cur);
      if (!inc) return cur;
      cur = inc.from;
    }
    return cur;
  };
  for (const e of edges.filter((x) => x.kind === 'loop')) {
    const a = order.get(e.from);
    const b = order.get(e.to);
    if (a === undefined || b === undefined) throw new SpecError(`loop 边端点必须是主干或分支: ${e.from} -> ${e.to}`);
    if (s.paradigm === 'vertical-flow' && byId.get(e.from)!.role === 'branch' && byId.get(e.to)!.role === 'main' && regAnchor(e.from) === e.to) continue;
    if (b >= a) throw new SpecError(`loop 边必须指向拓扑序更早的节点: ${e.from} -> ${e.to}`);
  }
  if (s.paradigm === 'vertical-flow') {
    for (const e of edges) {
      if ((e.kind === 'next' || e.kind === 'branch') && byId.get(e.from)!.role === 'branch' && byId.get(e.to)!.role === 'main') {
        warnings.push(`分支 ${e.from} 以 ${e.kind} 连回主干 ${e.to}，建议改用 loop 回归边`);
      }
    }
  }
  for (const e of edges.filter((x) => x.kind === 'jump')) {
    const from = byId.get(e.from)!;
    const to = byId.get(e.to)!;
    if (from.role !== 'main' || to.role !== 'main') throw new SpecError(`jump 边端点必须是主干节点: ${e.from} -> ${e.to}`);
    const a = order.get(e.from);
    const b = order.get(e.to);
    if (a === undefined || b === undefined || b <= a) throw new SpecError(`jump 边必须指向拓扑序更晚的主干节点: ${e.from} -> ${e.to}`);
  }

  if (s.paradigm === 'tiered-dag') {
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      const list = adj.get(e.from) ?? [];
      list.push(e.to);
      adj.set(e.from, list);
    }
    const state = new Map<string, number>();
    const dfs = (id: string) => {
      if (state.get(id) === 1) throw new SpecError('tiered-dag 存在环');
      if (state.get(id) === 2) return;
      state.set(id, 1);
      for (const next of adj.get(id) ?? []) dfs(next);
      state.set(id, 2);
    };
    for (const n of nodes) dfs(n.id);
  }

  return { paradigm: s.paradigm, title: s.title, lanes: s.lanes ?? [], nodes, edges, mainOrder, warnings };
}
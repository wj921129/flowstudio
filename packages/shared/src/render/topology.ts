export interface TopologyInputNode {
  id: string;
  type?: string;
  role?: string;
  attachTo?: string;
  label?: string;
  earlyExit?: boolean;
}

export interface TopologyInputEdge {
  from: string;
  to: string;
  kind?: string;
}

export interface TopologyComponent {
  nodeIds: string[];
  entries: string[];
}

export interface GraphTopology<N extends TopologyInputNode = TopologyInputNode, E extends TopologyInputEdge = TopologyInputEdge> {
  bizNodes: N[];
  annotNodes: N[];
  rawForwardEdges: Array<E & { kind: string }>;
  explicitLoopEdges: Array<E & { kind: string }>;
  backEdgeKeys: Set<string>;
  adj: Map<string, Array<{ to: string; kind: string }>>;
  parents: Map<string, string[]>;
  entryOrder: string[];
  components: TopologyComponent[];
  layerOf: Map<string, number>;
  topoOrder: string[];
}

const ENTRY_LABEL_RE = /入口|开始|发起|接收|触发|start|entry|begin/i;

export function analyzeGraphTopology<N extends TopologyInputNode, E extends TopologyInputEdge>(
  nodes: readonly N[],
  edges: readonly E[],
): GraphTopology<N, E> {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const bizNodes = nodes.filter((n) => !(n.role === 'annotation' && n.attachTo && nodeById.has(n.attachTo)));
  const annotNodes = nodes.filter((n) => n.role === 'annotation' && n.attachTo && nodeById.has(n.attachTo));
  const bizById = new Map(bizNodes.map((n) => [n.id, n]));
  const orderIdx = new Map(bizNodes.map((n, i) => [n.id, i]));

  const rawForwardEdges: Array<E & { kind: string }> = [];
  const explicitLoopEdges: Array<E & { kind: string }> = [];
  const rawInDeg = new Map<string, number>();
  const rawAdj = new Map<string, Array<{ to: string; key: string }>>();

  for (const e of edges) {
    const kind = e.kind ?? 'next';
    if (kind === 'annotate' || e.from === e.to || !bizById.has(e.from) || !bizById.has(e.to)) continue;
    const wrapped = { ...e, kind };
    if (kind === 'loop') {
      explicitLoopEdges.push(wrapped);
      continue;
    }
    rawForwardEdges.push(wrapped);
    rawInDeg.set(e.to, (rawInDeg.get(e.to) ?? 0) + 1);
    const key = `${e.from}|${e.to}|${kind}`;
    const list = rawAdj.get(e.from) ?? [];
    list.push({ to: e.to, key });
    rawAdj.set(e.from, list);
  }

  const entryPriority = (n: N) => {
    const deg = rawInDeg.get(n.id) ?? 0;
    const isStartType = (n.type ?? 'process') === 'start-end';
    const hasEntryLabel = ENTRY_LABEL_RE.test(n.label ?? '');
    if (deg === 0 && isStartType) return 0;
    if (deg === 0) return 1;
    if (isStartType && hasEntryLabel) return 2;
    if (hasEntryLabel) return 3;
    return 4 + deg;
  };

  const entryOrder = [...bizNodes]
    .sort((a, b) => entryPriority(a) - entryPriority(b) || (orderIdx.get(a.id) ?? 0) - (orderIdx.get(b.id) ?? 0))
    .map((n) => n.id);

  const backEdgeKeys = new Set<string>();
  const dfsState = new Map<string, number>();
  const dfs = (u: string) => {
    dfsState.set(u, 1);
    for (const item of rawAdj.get(u) ?? []) {
      const st = dfsState.get(item.to) ?? 0;
      if (st === 1) backEdgeKeys.add(item.key);
      else if (st === 0) dfs(item.to);
    }
    dfsState.set(u, 2);
  };
  for (const id of entryOrder) {
    if ((dfsState.get(id) ?? 0) === 0) dfs(id);
  }

  const adj = new Map<string, Array<{ to: string; kind: string }>>();
  const parents = new Map<string, string[]>();
  const seenPair = new Set<string>();
  const undirected = new Map<string, Set<string>>();
  for (const n of bizNodes) {
    adj.set(n.id, []);
    parents.set(n.id, []);
    undirected.set(n.id, new Set());
  }

  for (const e of rawForwardEdges) {
    const key = `${e.from}|${e.to}|${e.kind}`;
    if (backEdgeKeys.has(key)) continue;
    const pair = `${e.from}->${e.to}`;
    if (seenPair.has(pair)) continue;
    seenPair.add(pair);
    adj.get(e.from)!.push({ to: e.to, kind: e.kind });
    parents.get(e.to)!.push(e.from);
    undirected.get(e.from)!.add(e.to);
    undirected.get(e.to)!.add(e.from);
  }

  for (const e of explicitLoopEdges) {
    if (undirected.has(e.from) && undirected.has(e.to)) {
      undirected.get(e.from)!.add(e.to);
      undirected.get(e.to)!.add(e.from);
    }
  }

  const compSeen = new Set<string>();
  const entryRank = new Map(entryOrder.map((id, i) => [id, i]));
  const rawComponents: TopologyComponent[] = [];
  for (const id of entryOrder) {
    if (compSeen.has(id)) continue;
    const stack = [id];
    const ids: string[] = [];
    compSeen.add(id);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      ids.push(cur);
      for (const nb of undirected.get(cur) ?? []) {
        if (!compSeen.has(nb)) {
          compSeen.add(nb);
          stack.push(nb);
        }
      }
    }
    ids.sort((a, b) => (orderIdx.get(a) ?? 0) - (orderIdx.get(b) ?? 0));
    const zeroIn = ids.filter((nid) => (parents.get(nid)?.length ?? 0) === 0);
    const entries = (zeroIn.length > 0 ? zeroIn : ids).sort((a, b) => (entryRank.get(a) ?? 0) - (entryRank.get(b) ?? 0));
    rawComponents.push({ nodeIds: ids, entries });
  }
  const components = rawComponents.sort(
    (a, b) => b.nodeIds.length - a.nodeIds.length || (orderIdx.get(a.nodeIds[0]) ?? 0) - (orderIdx.get(b.nodeIds[0]) ?? 0),
  );

  const inDeg = new Map<string, number>();
  for (const n of bizNodes) inDeg.set(n.id, parents.get(n.id)!.length);
  const queue = entryOrder.filter((id) => (inDeg.get(id) ?? 0) === 0);
  const topoOrder: string[] = [];
  const layerOf = new Map<string, number>();
  for (const id of queue) layerOf.set(id, 0);

  let qi = 0;
  while (qi < queue.length) {
    const u = queue[qi++];
    topoOrder.push(u);
    const ul = layerOf.get(u) ?? 0;
    for (const edge of adj.get(u) ?? []) {
      const nextLayer = Math.max(layerOf.get(edge.to) ?? 0, ul + 1);
      layerOf.set(edge.to, nextLayer);
      const deg = (inDeg.get(edge.to) ?? 0) - 1;
      inDeg.set(edge.to, deg);
      if (deg === 0) queue.push(edge.to);
    }
  }
  for (const id of entryOrder) {
    if (!layerOf.has(id)) {
      layerOf.set(id, 0);
      topoOrder.push(id);
    }
  }

  return {
    bizNodes,
    annotNodes,
    rawForwardEdges,
    explicitLoopEdges,
    backEdgeKeys,
    adj,
    parents,
    entryOrder,
    components,
    layerOf,
    topoOrder,
  };
}

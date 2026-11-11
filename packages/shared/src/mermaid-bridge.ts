/**
 * @fileoverview Mermaid DSL 语义双向桥 (Bi-Directional Mermaid Bridge)
 * @description 提供画布 → Mermaid 的确定性导出，以及 Mermaid → 画布的增量语义融合。
 *              增量融合严格保留既有节点的坐标、样式与 lockMode，仅生成新增/变更操作，
 *              彻底避免“改一行代码重洗全图布局”。
 */

import type { FlowEdge, FlowNode, FlowNodeType } from './types.js';

/** Mermaid 节点形状语法映射（9 种流程节点） */
const NODE_SHAPE_SYNTAX: Record<FlowNodeType, string> = {
  'start-end': '(["%L%"])',
  process: '["%L%"]',
  decision: '{"%L%"}',
  io: '[/%L%/]',
  document: '[\\%L%\\]',
  subprocess: '[["%L%"]]',
  database: '[("%L%")]',
  comment: '{{"%L%"}}',
  group: '("%L%")',
  pool: '["%L%"]',
  lane: '["%L%"]',
};

/** 导出时会被 Mermaid 语法破坏的字符 */
function sanitizeLabel(label: string): string {
  return (label ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/["[\]{}|]/g, ' ')
    .trim();
}

/** 解析时剥离包裹引号与空白 */
function unwrapLabel(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  let text = raw.trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1);
  }
  return text.replace(/#quot;/g, '"').trim();
}

/**
 * 将单个节点渲染为 Mermaid 形状语法
 */
function renderNodeShape(nodeId: string, type: FlowNodeType, label: string): string {
  const template = NODE_SHAPE_SYNTAX[type] ?? NODE_SHAPE_SYNTAX.process;
  return `${nodeId}${template.replace('%L%', sanitizeLabel(label))}`;
}

function resolveNodeLabel(node: FlowNode): string {
  return node.data?.label || node.data?.laneTitle || node.id;
}

/**
 * 画布 → Mermaid 确定性导出
 *
 * - Pool / Lane 编译为嵌套 `subgraph`
 * - 9 种流程节点编译为标准 flowchart 形状语法
 * - 输出顺序完全确定（同输入必定得到同输出）
 *
 * @param nodes 全部节点（含 pool / lane 容器）
 * @param edges 全部连线
 * @param pools 泳道池节点（可省略，缺省时自动从 nodes 中筛选）
 * @param lanes 泳道节点（可省略，缺省时自动从 nodes 中筛选）
 */
export function diagramToMermaid(
  nodes: FlowNode[],
  edges: FlowEdge[],
  pools?: FlowNode[],
  lanes?: FlowNode[],
): string {
  const poolList = (pools ?? nodes.filter((n) => n.type === 'pool')).slice();
  const laneList = (lanes ?? nodes.filter((n) => n.type === 'lane')).slice();
  const flowNodes = nodes.filter((n) => n.type !== 'pool' && n.type !== 'lane');

  const poolIds = new Set(poolList.map((p) => p.id));
  const laneIds = new Set(laneList.map((l) => l.id));

  const topLanes = laneList.filter((l) => !l.parentId || !poolIds.has(l.parentId));
  const orphanNodes = flowNodes.filter(
    (n) => !n.parentId || (!laneIds.has(n.parentId) && !poolIds.has(n.parentId)),
  );

  const direction =
    poolList.length > 0 && poolList.every((p) => p.data?.orientation === 'vertical') ? 'TB' : 'LR';

  const lines: string[] = [`flowchart ${direction}`];

  const emitLane = (lane: FlowNode, indent: string) => {
    lines.push(`${indent}subgraph ${lane.id}["${sanitizeLabel(resolveNodeLabel(lane))}"]`);
    const laneNodes = flowNodes
      .filter((n) => n.parentId === lane.id)
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const node of laneNodes) {
      lines.push(`${indent}  ${renderNodeShape(node.id, node.type, resolveNodeLabel(node))}`);
    }
    lines.push(`${indent}end`);
  };

  const orderedPools = poolList.slice().sort((a, b) => a.id.localeCompare(b.id));

  for (const pool of orderedPools) {
    lines.push(`subgraph ${pool.id}["${sanitizeLabel(resolveNodeLabel(pool))}"]`);
    if (pool.data?.orientation === 'vertical') {
      lines.push('  direction TB');
    }

    const laneOrder = pool.data?.laneOrder ?? [];
    const poolLanes = laneList.filter((l) => l.parentId === pool.id);
    const orderedLanes = [
      ...laneOrder
        .map((id) => poolLanes.find((l) => l.id === id))
        .filter((l): l is FlowNode => Boolean(l)),
      ...poolLanes.filter((l) => !laneOrder.includes(l.id)).sort((a, b) => a.id.localeCompare(b.id)),
    ];

    for (const lane of orderedLanes) {
      emitLane(lane, '  ');
    }

    const directNodes = flowNodes
      .filter((n) => n.parentId === pool.id)
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const node of directNodes) {
      lines.push(`  ${renderNodeShape(node.id, node.type, resolveNodeLabel(node))}`);
    }

    lines.push('end');
  }

  for (const lane of topLanes.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    emitLane(lane, '');
  }

  for (const node of orphanNodes.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    lines.push(renderNodeShape(node.id, node.type, resolveNodeLabel(node)));
  }

  const sortedEdges = edges.slice().sort((a, b) => {
    const ka = `${a.source}\u0000${a.target}\u0000${a.id}`;
    const kb = `${b.source}\u0000${b.target}\u0000${b.id}`;
    return ka.localeCompare(kb);
  });

  for (const edge of sortedEdges) {
    const label =
      edge.data?.label ?? (typeof edge.label === 'string' ? edge.label : undefined);
    const cleanLabel = label ? sanitizeLabel(label) : '';
    lines.push(
      cleanLabel
        ? `${edge.source} -->|${cleanLabel}| ${edge.target}`
        : `${edge.source} --> ${edge.target}`,
    );
  }

  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Mermaid → 画布 增量语义融合
// ---------------------------------------------------------------------------

/** 增量融合产出的操作（与 MCP apply_ops 操作语义一致） */
export type MermaidBridgeOp =
  | { op: 'add_lane'; id: string; label: string }
  | { op: 'add_node'; id: string; type: FlowNodeType; label: string; laneId?: string }
  | { op: 'update_node'; id: string; label: string }
  | { op: 'move_to_lane'; nodeId: string; laneId: string }
  | { op: 'connect'; source: string; target: string; label?: string }
  | { op: 'update_edge'; id: string; label: string }
  | { op: 'disconnect'; edgeId: string };

/** 增量融合结果 */
export interface MermaidDiffResult {
  /** 需要按序应用的操作集合 */
  ops: MermaidBridgeOp[];
  /** 命中既有节点（坐标、样式与 lockMode 100% 保留） */
  preservedNodeIds: string[];
  /** 新增节点 ID */
  addedNodeIds: string[];
  /** 文本发生变化的节点 ID */
  updatedNodeIds: string[];
  /** 新增连线 ID（由 source→target 合成） */
  addedEdgeIds: string[];
  /** 需要删除的既有连线 ID */
  removedEdgeIds: string[];
  /** 新增泳道 ID */
  addedLaneIds: string[];
  /** Mermaid 中缺失但画布仍安全保留的节点 ID（非破坏性） */
  missingNodeIds: string[];
}

interface ParsedNode {
  id: string;
  label?: string;
  type: FlowNodeType;
  laneId?: string;
}

interface ParsedEdge {
  sourceId: string;
  targetId: string;
  label?: string;
}

interface ParsedMermaid {
  nodes: ParsedNode[];
  edges: ParsedEdge[];
  lanes: Array<{ id: string; label: string }>;
}

const EDGE_ARROW_RE = /(-\.->|==>|-->|---)/;

/**
 * 解析节点记号（可含形状语法），例如：
 * `A["审批"]`、`B{判断}`、`C[(数据库)]`、`D`
 */
function parseNodeToken(token: string): ParsedNode | null {
  const trimmed = token.trim();
  if (!trimmed) return null;

  const idMatch = /^([A-Za-z0-9_\-.]+)\s*([\s\S]*)$/.exec(trimmed);
  if (!idMatch) return null;

  const id = idMatch[1];
  const shape = idMatch[2].trim();
  if (!shape) {
    return { id, type: 'process' };
  }

  const parseWrapped = (open: string, close: string, type: FlowNodeType): ParsedNode | null => {
    if (!(shape.startsWith(open) && shape.endsWith(close))) return null;
    const inner = shape.slice(open.length, shape.length - close.length);
    return { id, type, label: unwrapLabel(inner) };
  };

  const candidates: Array<() => ParsedNode | null> = [
    () => parseWrapped('([', '])', 'start-end'),
    () => parseWrapped('((', '))', 'start-end'),
    () => parseWrapped('[[', ']]', 'subprocess'),
    () => parseWrapped('[(', ')]', 'database'),
    () => parseWrapped('[/', '/]', 'io'),
    () => parseWrapped('[\\', '\\]', 'document'),
    () => parseWrapped('{{', '}}', 'comment'),
    () => parseWrapped('{', '}', 'decision'),
    () => parseWrapped('[', ']', 'process'),
    () => parseWrapped('(', ')', 'group'),
  ];

  for (const candidate of candidates) {
    const parsed = candidate();
    if (parsed) return parsed;
  }

  return { id, type: 'process', label: unwrapLabel(shape) };
}

/**
 * 解析 Mermaid 源码（支持 flowchart/graph 的常用子集）
 */
export function parseMermaid(mermaidText: string): ParsedMermaid {
  const nodes = new Map<string, ParsedNode>();
  const edges: ParsedEdge[] = [];
  const lanes: Array<{ id: string; label: string }> = [];
  const laneStack: string[] = [];

  const registerNode = (parsed: ParsedNode | null): ParsedNode | null => {
    if (!parsed) return null;
    const existing = nodes.get(parsed.id);
    if (existing) {
      if (parsed.label !== undefined) existing.label = parsed.label;
      if (parsed.type !== 'process') existing.type = parsed.type;
      if (laneStack.length > 0 && existing.laneId === undefined) {
        existing.laneId = laneStack[laneStack.length - 1];
      }
      return existing;
    }
    const next: ParsedNode = {
      ...parsed,
      laneId: parsed.laneId ?? (laneStack.length > 0 ? laneStack[laneStack.length - 1] : undefined),
    };
    nodes.set(next.id, next);
    return next;
  };

  const rawLines = mermaidText.split(/\r?\n/);

  for (const rawLine of rawLines) {
    const line = rawLine.replace(/%%[\s\S]*$/, '').trim();
    if (!line) continue;

    if (/^(flowchart|graph)\b/i.test(line)) continue;

    if (/^subgraph\b/i.test(line)) {
      const rest = line.replace(/^subgraph\b/i, '').trim();
      const laneMatch = /^([A-Za-z0-9_\-.]+)\s*(.*)$/.exec(rest);
      let laneId: string;
      let laneLabel: string;
      if (laneMatch) {
        laneId = laneMatch[1];
        const shapePart = laneMatch[2].trim();
        const shapeMatch = /^[\[({]+([\s\S]*?)[\])}]+$/.exec(shapePart);
        laneLabel = unwrapLabel(shapeMatch ? shapeMatch[1] : shapePart) || laneId;
      } else {
        laneId = `lane-auto-${lanes.length + 1}`;
        laneLabel = unwrapLabel(rest) || laneId;
      }
      lanes.push({ id: laneId, label: laneLabel });
      laneStack.push(laneId);
      continue;
    }

    if (/^end\b/i.test(line)) {
      laneStack.pop();
      continue;
    }

    if (
      /^(direction|classDef|class|style|linkStyle|click|accTitle|accDescr|note)\b/i.test(line)
    ) {
      continue;
    }

    if (EDGE_ARROW_RE.test(line)) {
      const normalized = line
        .replace(/\s--\s+(.+?)\s+-->\s/g, ' -->|$1| ')
        .replace(/\s--\s+(.+?)\s+---\s/g, ' ---|$1| ');
      const parts = normalized.split(EDGE_ARROW_RE);
      if (parts.length < 3) continue;

      let previousToken = parts[0];
      for (let i = 1; i < parts.length; i += 2) {
        const targetPart = parts[i + 1] ?? '';
        let label: string | undefined;
        let targetToken = targetPart;

        const labelMatch = /^\s*\|([\s\S]*?)\|\s*([\s\S]*)$/.exec(targetPart);
        if (labelMatch) {
          label = unwrapLabel(labelMatch[1]);
          targetToken = labelMatch[2];
        }

        const sourceNode = registerNode(parseNodeToken(previousToken));
        const targetNode = registerNode(parseNodeToken(targetToken));
        if (!sourceNode || !targetNode) break;

        edges.push({ sourceId: sourceNode.id, targetId: targetNode.id, label });
        previousToken = targetToken;
      }
      continue;
    }

    // 独立节点声明
    if (/[A-Za-z0-9_\-.]+/.test(line)) {
      registerNode(parseNodeToken(line));
    }
  }

  return {
    nodes: Array.from(nodes.values()),
    edges,
    lanes,
  };
}

function normalizeLabelKey(label: string | undefined): string | undefined {
  if (label === undefined) return undefined;
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Mermaid → 画布 增量语义融合
 *
 * 匹配优先级：节点 ID 完全一致 → 节点 Label 完全一致。
 * 命中既有节点时绝不输出坐标/样式/lockMode 相关操作，画布上的手工布局 100% 保留。
 */
export function diffMermaidToOps(
  mermaidText: string,
  existingNodes: FlowNode[],
  existingEdges: FlowEdge[],
): MermaidDiffResult {
  const parsed = parseMermaid(mermaidText);

  const existingById = new Map(existingNodes.map((n) => [n.id, n]));
  const existingByLabel = new Map<string, FlowNode>();
  for (const node of existingNodes) {
    if (node.type === 'pool' || node.type === 'lane') continue;
    const key = normalizeLabelKey(node.data?.label);
    if (key && !existingByLabel.has(key)) existingByLabel.set(key, node);
  }

  const existingLanes = existingNodes.filter((n) => n.type === 'lane');
  const existingPools = existingNodes.filter((n) => n.type === 'pool');

  const resolvedIds = new Map<string, string>();
  const result: MermaidDiffResult = {
    ops: [],
    preservedNodeIds: [],
    addedNodeIds: [],
    updatedNodeIds: [],
    addedEdgeIds: [],
    removedEdgeIds: [],
    addedLaneIds: [],
    missingNodeIds: [],
  };

  const laneResolve = new Map<string, string>();
  for (const lane of parsed.lanes) {
    const matchedLane = existingLanes.find(
      (candidate) => candidate.id === lane.id || candidate.data?.label === lane.label,
    );
    const matched = matchedLane ?? existingPools.find(
      (candidate) => candidate.id === lane.id || candidate.data?.label === lane.label,
    );
    if (matched) {
      laneResolve.set(lane.id, matched.id);
    } else {
      laneResolve.set(lane.id, lane.id);
      result.ops.push({ op: 'add_lane', id: lane.id, label: lane.label });
      result.addedLaneIds.push(lane.id);
    }
  }

  for (const parsedNode of parsed.nodes) {
    const byId = existingById.get(parsedNode.id);
    const labelKey = normalizeLabelKey(parsedNode.label);
    const byLabel = labelKey ? existingByLabel.get(labelKey) : undefined;
    const matched = byId ?? byLabel;

    if (matched) {
      resolvedIds.set(parsedNode.id, matched.id);
      result.preservedNodeIds.push(matched.id);

      if (labelKey && labelKey !== normalizeLabelKey(matched.data?.label)) {
        result.ops.push({ op: 'update_node', id: matched.id, label: labelKey });
        result.updatedNodeIds.push(matched.id);
      }

      const parsedLaneId = parsedNode.laneId ? laneResolve.get(parsedNode.laneId) : undefined;
      if (parsedLaneId && parsedLaneId !== matched.parentId) {
        result.ops.push({ op: 'move_to_lane', nodeId: matched.id, laneId: parsedLaneId });
      }
      continue;
    }

    resolvedIds.set(parsedNode.id, parsedNode.id);
    const laneId = parsedNode.laneId ? laneResolve.get(parsedNode.laneId) : undefined;
    result.ops.push({
      op: 'add_node',
      id: parsedNode.id,
      type: parsedNode.type,
      label: parsedNode.label ?? parsedNode.id,
      ...(laneId ? { laneId } : {}),
    });
    result.addedNodeIds.push(parsedNode.id);
  }

  const parsedNodeIds = new Set(resolvedIds.values());
  for (const node of existingNodes) {
    if (node.type === 'pool' || node.type === 'lane') continue;
    if (!parsedNodeIds.has(node.id)) result.missingNodeIds.push(node.id);
  }

  const existingEdgeKey = new Map<string, FlowEdge>();
  for (const edge of existingEdges) {
    const key = `${edge.source}\u0000${edge.target}`;
    if (!existingEdgeKey.has(key)) existingEdgeKey.set(key, edge);
  }

  const parsedEdgeKeys = new Set<string>();
  for (const parsedEdge of parsed.edges) {
    const source = resolvedIds.get(parsedEdge.sourceId);
    const target = resolvedIds.get(parsedEdge.targetId);
    if (!source || !target) continue;

    const key = `${source}\u0000${target}`;
    parsedEdgeKeys.add(key);

    const existing = existingEdgeKey.get(key);
    if (existing) {
      const parsedLabel = normalizeLabelKey(parsedEdge.label);
      const existingLabel = normalizeLabelKey(
        existing.data?.label ?? (typeof existing.label === 'string' ? existing.label : undefined),
      );
      if (parsedLabel && parsedLabel !== existingLabel) {
        result.ops.push({ op: 'update_edge', id: existing.id, label: parsedLabel });
      }
      continue;
    }

    result.ops.push({
      op: 'connect',
      source,
      target,
      ...(parsedEdge.label ? { label: parsedEdge.label } : {}),
    });
    result.addedEdgeIds.push(`${source}->${target}`);
  }

  for (const edge of existingEdges) {
    if (!parsedNodeIds.has(edge.source) || !parsedNodeIds.has(edge.target)) continue;
    const key = `${edge.source}\u0000${edge.target}`;
    if (!parsedEdgeKeys.has(key)) {
      result.ops.push({ op: 'disconnect', edgeId: edge.id });
      result.removedEdgeIds.push(edge.id);
    }
  }

  return result;
}

/**
 * @fileoverview MCP (Model Context Protocol) 核心协议与工具定义
 * @description 遵循 MCP JSON-RPC 2.0 规范，定义 FlowStudio 7 大协同操作工具
 */

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpInsertNodeSpec {
  id?: string;
  type?: string;
  label: string;
  laneId?: string;
  style?: Record<string, unknown>;
}

export type McpOp =
  | { op: 'add_node'; type: string; label: string; id?: string; laneId?: string; role?: 'main' | 'branch' | 'annotation'; attachTo?: string; style?: Record<string, unknown> }
  | { op: 'update_node'; id: string; label?: string; style?: Record<string, unknown> }
  | { op: 'delete_node'; id: string }
  | { op: 'connect'; source: string; target: string; label?: string; kind?: 'next' | 'branch' | 'loop' | 'jump' | 'annotate' | 'tree'; style?: Record<string, unknown> }
  | { op: 'disconnect'; edgeId?: string; source?: string; target?: string }
  | { op: 'add_lane'; label: string; id?: string; poolId?: string }
  | { op: 'move_to_lane'; nodeId: string; laneId: string }
  | { op: 'move_node'; id: string; position: { x: number; y: number } }
  | { op: 'update_edge'; id: string; label?: string; style?: Record<string, unknown> }
  | {
      op: 'insert_between';
      source: string;
      target: string;
      node: McpInsertNodeSpec;
      edgeLabel?: string;
      upstreamLabel?: string;
      downstreamLabel?: string;
      direction?: 'RIGHT' | 'DOWN';
    };

export interface CompactDiagram {
  id: string;
  title: string;
  paradigm?: string;
  mainOrder?: string[];
  lanes: Array<{ id: string; label: string }>;
  nodes: Array<{
    id: string;
    type: string;
    label: string;
    laneId?: string;
    role?: 'main' | 'branch' | 'annotation';
    attachTo?: string;
    position: { x: number; y: number };
    lockMode?: 'none' | 'position' | 'full';
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    label?: string;
    kind?: 'next' | 'branch' | 'loop' | 'jump' | 'annotate' | 'tree';
  }>;
}

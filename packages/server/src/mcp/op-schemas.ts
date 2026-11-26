/**
 * @fileoverview MCP 工具入参 Zod 校验 Schema
 * @description 为 apply_ops 等高风险 AI 工具提供严格的运行期入参校验，避免畸形操作污染画布
 */

import { z } from 'zod';
import { borderHandleSchema, EDGE_STROKE_STYLES, FLOW_NODE_TYPES, diagramSpecSchema } from '@flowstudio/shared';

const positionSchema = z.object({ x: z.number(), y: z.number() });

const styleSchema = z.record(z.string(), z.unknown());

const edgeStyleSchema = z.object({
  strokeColor: z.string().optional(),
  strokeWidth: z.number().positive().max(20).optional(),
  strokeStyle: z.enum(EDGE_STROKE_STYLES).optional(),
  animated: z.boolean().optional(),
}).passthrough();

const edgeStrokeStyleSchema = z.enum(EDGE_STROKE_STYLES);
const edgeRoutingSchema = z.enum(['orthogonal', 'straight']);

const flowNodeTypeSchema = z.enum([...FLOW_NODE_TYPES]);

export const mcpOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_node'),
    type: flowNodeTypeSchema.optional(),
    label: z.string().min(1),
    id: z.string().min(1).optional(),
    laneId: z.string().min(1).optional(),
    role: z.enum(['main', 'branch', 'annotation']).optional(),
    attachTo: z.string().min(1).optional(),
    earlyExit: z.boolean().optional(),
    style: styleSchema.optional(),
  }),
  z.object({
    op: z.literal('update_node'),
    id: z.string().min(1),
    label: z.string().min(1).optional(),
    earlyExit: z.boolean().optional(),
    style: styleSchema.optional(),
  }),
  z.object({
    op: z.literal('delete_node'),
    id: z.string().min(1),
  }),
  z.object({
    op: z.literal('connect'),
    source: z.string().min(1),
    target: z.string().min(1),
    sourceHandle: borderHandleSchema.optional(),
    targetHandle: borderHandleSchema.optional(),
    label: z.string().optional(),
    kind: z.enum(['next', 'branch', 'loop', 'jump', 'annotate', 'tree']).optional(),
    strokeStyle: edgeStrokeStyleSchema.optional(),
    routingType: edgeRoutingSchema.optional(),
    style: edgeStyleSchema.optional(),
  }),
  z.object({
    op: z.literal('disconnect'),
    edgeId: z.string().min(1).optional(),
    source: z.string().min(1).optional(),
    target: z.string().min(1).optional(),
  }),
  z.object({
    op: z.literal('add_lane'),
    label: z.string().min(1),
    id: z.string().min(1).optional(),
    poolId: z.string().min(1).optional(),
  }),
  z.object({
    op: z.literal('move_to_lane'),
    nodeId: z.string().min(1),
    laneId: z.string().min(1),
  }),
  z.object({
    op: z.literal('move_node'),
    id: z.string().min(1),
    position: positionSchema,
  }),
  z.object({
    op: z.literal('update_edge'),
    id: z.string().min(1),
    label: z.string().optional(),
    sourceHandle: borderHandleSchema.optional(),
    targetHandle: borderHandleSchema.optional(),
    strokeStyle: edgeStrokeStyleSchema.optional(),
    routingType: edgeRoutingSchema.optional(),
    style: edgeStyleSchema.optional(),
  }),
  z.object({
    op: z.literal('insert_between'),
    source: z.string().min(1),
    target: z.string().min(1),
    node: z.object({
      id: z.string().min(1).optional(),
      type: flowNodeTypeSchema.optional(),
      label: z.string().min(1),
      laneId: z.string().min(1).optional(),
      style: styleSchema.optional(),
    }),
    edgeLabel: z.string().optional(),
    upstreamLabel: z.string().optional(),
    downstreamLabel: z.string().optional(),
    direction: z.enum(['RIGHT', 'DOWN']).optional(),
    strokeStyle: edgeStrokeStyleSchema.optional(),
    routingType: edgeRoutingSchema.optional(),
  }),
]);

export const applyOpsInputSchema = z.object({
  diagramId: z.string().min(1, 'diagramId 不能为空'),
  agentName: z.string().optional(),
  atomic: z.boolean().optional().default(false),
  ops: z.array(mcpOpSchema).min(1, 'ops 不能为空').max(100, '单次 ops 数量不能超过 100'),
});

export const scaffoldDiagramInputSchema = z.object({
  diagramId: z.string().min(1),
  title: z.string().optional(),
  agentName: z.string().optional(),
  spec: diagramSpecSchema,
});

export const autoLayoutInputSchema = z.object({
  diagramId: z.string().min(1),
  direction: z.enum(['RIGHT', 'DOWN']).optional().describe('排版方向：DOWN (纵向默认) 或 RIGHT (横向)'),
  mode: z.enum(['circuit', 'layered', 'tree']).optional().describe('排版模式：circuit (电路控制流) / layered (ELK分层) / tree (树状纯直线)'),
  edgeRouting: z.enum(['orthogonal', 'straight']).optional().describe('可选覆盖连线路由：orthogonal 正交折线 / straight 纯直线；省略则自动保留原图路由'),
  agentName: z.string().optional(),
});

export const getSelectionInputSchema = z.object({
  diagramId: z.string().min(1),
  nickname: z.string().optional(),
});

export const undoAiBatchInputSchema = z.object({
  diagramId: z.string().min(1),
  batchId: z.string().min(1).optional(),
});

export const listSnapshotsInputSchema = z.object({
  diagramId: z.string().min(1),
});

export const restoreSnapshotInputSchema = z.object({
  diagramId: z.string().min(1),
  snapshotId: z.string().min(1),
});

export const searchNodesInputSchema = z.object({
  diagramId: z.string().min(1),
  query: z.string().optional(),
  laneId: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const renameDiagramInputSchema = z.object({
  diagramId: z.string().min(1),
  title: z.string().min(1),
});

export const deleteDiagramInputSchema = z.object({
  diagramId: z.string().min(1),
});

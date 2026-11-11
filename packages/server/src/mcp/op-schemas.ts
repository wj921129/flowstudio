/**
 * @fileoverview MCP 工具入参 Zod 校验 Schema
 * @description 为 apply_ops 等高风险 AI 工具提供严格的运行期入参校验，避免畸形操作污染画布
 */

import { z } from 'zod';

const positionSchema = z.object({ x: z.number(), y: z.number() });

const styleSchema = z.record(z.string(), z.unknown());

export const mcpOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_node'),
    type: z.string().min(1).optional(),
    label: z.string().min(1),
    id: z.string().min(1).optional(),
    laneId: z.string().min(1).optional(),
    style: styleSchema.optional(),
  }),
  z.object({
    op: z.literal('update_node'),
    id: z.string().min(1),
    label: z.string().min(1).optional(),
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
    label: z.string().optional(),
    style: styleSchema.optional(),
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
    style: styleSchema.optional(),
  }),
  z.object({
    op: z.literal('insert_between'),
    source: z.string().min(1),
    target: z.string().min(1),
    node: z.object({
      id: z.string().min(1).optional(),
      type: z.string().min(1).optional(),
      label: z.string().min(1),
      laneId: z.string().min(1).optional(),
      style: styleSchema.optional(),
    }),
    edgeLabel: z.string().optional(),
    upstreamLabel: z.string().optional(),
    downstreamLabel: z.string().optional(),
    direction: z.enum(['RIGHT', 'DOWN']).optional(),
  }),
]);

export const applyOpsInputSchema = z.object({
  diagramId: z.string().min(1, 'chartId 不能为空'),
  agentName: z.string().optional(),
  ops: z.array(mcpOpSchema).min(1, 'ops 不能为空'),
});

export const scaffoldDiagramInputSchema = z.object({
  diagramId: z.string().min(1),
  title: z.string().optional(),
  lanes: z
    .array(z.object({ id: z.string().min(1), label: z.string().min(1) }))
    .optional(),
  nodes: z.array(
    z.object({
      id: z.string().min(1),
      type: z.string().min(1),
      label: z.string().min(1),
      laneId: z.string().min(1).optional(),
    }),
  ),
  edges: z.array(
    z.object({
      source: z.string().min(1),
      target: z.string().min(1),
      label: z.string().optional(),
    }),
  ),
  agentName: z.string().optional(),
});

export const autoLayoutInputSchema = z.object({
  diagramId: z.string().min(1),
  direction: z.enum(['RIGHT', 'DOWN']).optional(),
});

export const getSelectionInputSchema = z.object({
  diagramId: z.string().min(1),
  nickname: z.string().optional(),
});

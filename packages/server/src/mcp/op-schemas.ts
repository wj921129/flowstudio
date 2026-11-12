/**
 * @fileoverview MCP 工具入参 Zod 校验 Schema
 * @description 为 apply_ops 等高风险 AI 工具提供严格的运行期入参校验，避免畸形操作污染画布
 */

import { z } from 'zod';
import { diagramSpecSchema } from '@flowstudio/shared';

const positionSchema = z.object({ x: z.number(), y: z.number() });

const styleSchema = z.record(z.string(), z.unknown());

/**
 * 允许 AI 创建的流程 / 形状 / UML / 架构节点类型。
 * pool / lane 是容器结构，只能通过 scaffold_diagram 的 lanes 或 add_lane 创建，
 * 严禁经 add_node / insert_between / scaffold nodes 伪造，否则会破坏「pool → lane → 节点」层级。
 */
const flowNodeTypeSchema = z.enum([
  'start-end',
  'process',
  'decision',
  'io',
  'document',
  'subprocess',
  'database',
  'comment',
  'group',
  'uml-lifeline',
  'uml-activation',
  'uml-message',
  'arch-microservice',
  'arch-gateway',
  'arch-db-shard',
  'arch-cache',
  'arch-k8s-pod',
  'arch-docker',
  'rich-card',
]);

export const mcpOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_node'),
    type: flowNodeTypeSchema.optional(),
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
      type: flowNodeTypeSchema.optional(),
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
  agentName: z.string().optional(),
  spec: diagramSpecSchema,
});

export const autoLayoutInputSchema = z.object({
  diagramId: z.string().min(1),
  direction: z.enum(['RIGHT', 'DOWN']).optional(),
});

export const getSelectionInputSchema = z.object({
  diagramId: z.string().min(1),
  nickname: z.string().optional(),
});

import { z } from 'zod';
import { FLOW_NODE_TYPES } from '../types.js';

export const flowNodeTypeSchema = z.enum(FLOW_NODE_TYPES as unknown as [string, ...string[]]);

export const xyPositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const dimensionsSchema = z.object({
  width: z.number(),
  height: z.number(),
});

export const nodeLockModeSchema = z.enum(['none', 'position', 'full']);

export const flowNodeDataSchema = z.object({
  label: z.string(),
  type: flowNodeTypeSchema,
  lockMode: nodeLockModeSchema.optional(),
  parentId: z.string().optional(),
  isFrame: z.boolean().optional(),
  isCollapsed: z.boolean().optional(),
  orientation: z.enum(['horizontal', 'vertical']).optional(),
  laneOrder: z.array(z.string()).optional(),
  headerColor: z.string().optional(),
  laneTitle: z.string().optional(),
  headerSize: z.number().optional(),
  style: z.record(z.string(), z.unknown()).optional(),
  description: z.string().optional(),
  envTag: z.string().max(32).optional(),
  protocol: z.string().max(32).optional(),
  health: z.enum(['ok', 'warn', 'error']).optional(),
  markdown: z.string().max(20000).optional(),
  cardStatus: z.enum(['draft', 'wip', 'done']).optional(),
  owner: z.string().max(64).optional(),
  messageKind: z.enum(['sync', 'async', 'return']).optional(),
}).passthrough();

export const flowNodeSchema = z.object({
  id: z.string().min(1),
  type: flowNodeTypeSchema,
  position: xyPositionSchema,
  data: flowNodeDataSchema,
  parentId: z.string().optional(),
  extent: z.literal('parent').optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  selected: z.boolean().optional(),
  dragging: z.boolean().optional(),
  style: z.record(z.string(), z.unknown()).optional(),
  className: z.string().optional(),
  zIndex: z.number().optional(),
}).passthrough();

export const flowEdgeDataSchema = z.object({
  label: z.string().optional(),
  labelRatio: z.number().min(0).max(1).optional(),
  style: z.record(z.string(), z.unknown()).optional(),
  waypoints: z.array(xyPositionSchema).optional(),
  routingType: z.enum(['orthogonal', 'bezier', 'straight']).optional(),
  kind: z.enum(['next', 'branch', 'loop', 'jump', 'annotate', 'tree']).optional(),
}).passthrough().optional();

export const flowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  type: z.string().optional(),
  data: flowEdgeDataSchema,
  label: z.string().optional(),
  animated: z.boolean().optional(),
  selected: z.boolean().optional(),
  style: z.record(z.string(), z.unknown()).optional(),
  className: z.string().optional(),
  zIndex: z.number().optional(),
}).passthrough();

export const flowDiagramSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  nodes: z.array(flowNodeSchema),
  edges: z.array(flowEdgeSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  description: z.string().optional(),
  version: z.string().optional(),
}).passthrough();

export const createDiagramInputSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(100, '标题不能超过 100 字符'),
  description: z.string().max(500, '描述不能超过 500 字符').optional(),
  thumbnail: z.string().optional(),
});

export const updateDiagramInputSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(100, '标题不能超过 100 字符').optional(),
  description: z.string().max(500, '描述不能超过 500 字符').optional(),
  thumbnail: z.string().optional(),
});

export const awarenessUserStateSchema = z.object({
  clientId: z.string().min(1),
  nickname: z.string().min(1),
  color: z.string().min(1),
  cursor: xyPositionSchema.nullable(),
  selectedNodeIds: z.array(z.string()),
  viewport: z
    .object({
      x: z.number(),
      y: z.number(),
      zoom: z.number(),
    })
    .optional(),
  spotlightNodeIds: z.array(z.string()).optional(),
  isAi: z.boolean().optional(),
  agentName: z.string().optional(),
});

export const revertBatchItemsRequestSchema = z.object({
  entityIds: z.array(z.string().min(1)).min(1, '至少需要指定一个待撤回实体'),
});

export const aiBatchEntityDiffSchema = z.object({
  entityId: z.string().min(1),
  entityType: z.enum(['node', 'edge']),
  opType: z.enum(['add', 'update', 'delete']),
  beforeState: z.record(z.string(), z.unknown()).nullable(),
  afterState: z.record(z.string(), z.unknown()).nullable(),
  reverted: z.boolean().optional(),
});

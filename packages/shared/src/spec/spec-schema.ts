import { z } from 'zod';
import { EDGE_STROKE_STYLES } from '../constants.js';
import { FLOW_NODE_TYPES, type FlowNodeType } from '../types.js';

export const borderHandleSchema = z
  .string()
  .regex(/^(top|right|bottom|left)(@(\d+(?:\.\d+)?))?$/, '连接桩格式须为 top|right|bottom|left 或 side@0.04~0.96')
  .refine((val) => {
    const idx = val.indexOf('@');
    if (idx === -1) return true;
    const num = Number.parseFloat(val.slice(idx + 1));
    return Number.isFinite(num) && num >= 0.04 && num <= 0.96;
  }, '连接桩偏移量必须在 0.04~0.96 之间');

const specNodeTypeSchema = z.enum(
  FLOW_NODE_TYPES.filter((t) => t !== 'pool' && t !== 'lane') as unknown as [FlowNodeType, ...FlowNodeType[]],
);

export const specNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: specNodeTypeSchema.optional(),
  role: z.enum(['main', 'branch', 'annotation']).optional(),
  laneId: z.string().min(1).optional(),
  attachTo: z.string().min(1).optional(),
  description: z.string().optional(),
});

export const specEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  kind: z.enum(['next', 'branch', 'loop', 'jump', 'annotate', 'tree']).optional(),
  label: z.string().optional(),
  strokeStyle: z.enum(EDGE_STROKE_STYLES).optional(),
  routingType: z.enum(['orthogonal', 'straight']).optional(),
  sourceHandle: borderHandleSchema.optional(),
  targetHandle: borderHandleSchema.optional(),
});

export const diagramSpecSchema = z.object({
  paradigm: z.enum(['vertical-flow', 'timeline-annotated', 'swimlane', 'tiered-dag', 'tree']),
  orientation: z.enum(['horizontal', 'vertical']).optional(),
  edgeRouting: z.enum(['orthogonal', 'straight']).optional(),
  title: z.string().optional(),
  lanes: z.array(z.object({ id: z.string().min(1), label: z.string().min(1) })).optional(),
  nodes: z.array(specNodeSchema),
  edges: z.array(specEdgeSchema),
}).refine((s) => s.paradigm !== 'swimlane' || Boolean(s.lanes && s.lanes.length > 0), {
  message: 'swimlane 范式必须提供非空 lanes',
});
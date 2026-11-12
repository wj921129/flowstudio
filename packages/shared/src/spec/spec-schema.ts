import { z } from 'zod';
import { FLOW_NODE_TYPES, type FlowNodeType } from '../types.js';

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
});

export const diagramSpecSchema = z.object({
  paradigm: z.enum(['vertical-flow', 'timeline-annotated', 'swimlane', 'tiered-dag', 'tree']),
  title: z.string().optional(),
  lanes: z.array(z.object({ id: z.string().min(1), label: z.string().min(1) })).optional(),
  nodes: z.array(specNodeSchema),
  edges: z.array(specEdgeSchema),
}).refine((s) => s.paradigm !== 'swimlane' || Boolean(s.lanes && s.lanes.length > 0), {
  message: 'swimlane 范式必须提供非空 lanes',
});
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
  role: z.enum(['main', 'branch', 'annotation']).optional().describe('语义角色：main 主干 / branch 分支 / annotation 附注（circuit-flow 可省略）'),
  laneId: z.string().min(1).optional().describe('swimlane 所属泳道 ID'),
  attachTo: z.string().min(1).optional().describe('附注宿主业务节点 ID'),
  description: z.string().optional(),
  earlyExit: z.boolean().optional().describe('是否中途 throw/return 提前结束（不汇入主流程）'),
});

export const specEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  kind: z.enum(['next', 'branch', 'loop', 'jump', 'annotate', 'tree']).optional().describe('边语义：next 顺延 / branch 分支 / loop 循环回退 / jump 跨段旁路 / annotate 附注 / tree 树边'),
  label: z.string().optional(),
  strokeStyle: z.enum(EDGE_STROKE_STYLES).optional().describe('线型：solid 实线 / dashed 虚线（异步/旁路）/ dotted 点线'),
  routingType: z.enum(['orthogonal', 'straight']).optional().describe('单边路由覆盖：orthogonal 正交折线 / straight 纯直线'),
  sourceHandle: borderHandleSchema.optional(),
  targetHandle: borderHandleSchema.optional(),
});

export const diagramSpecSchema = z.object({
  paradigm: z.enum(['circuit-flow', 'timeline-annotated', 'swimlane', 'tiered-dag', 'tree']).describe('范式：circuit-flow 电路控制流(首选) / tree 树状直线调用图 / swimlane 跨角色泳道 / tiered-dag 分层拓扑 / timeline-annotated 纵向时间线'),
  orientation: z.enum(['horizontal', 'vertical']).optional().describe('主方向：circuit-flow 默认 vertical(纵向)，swimlane 默认 horizontal(横向)'),
  edgeRouting: z.enum(['orthogonal', 'straight']).optional().describe('默认连线路由：orthogonal 正交折线(默认) / straight 纯直线'),
  title: z.string().optional(),
  lanes: z.array(z.object({ id: z.string().min(1), label: z.string().min(1) })).optional().describe('swimlane 泳道有序定义列表'),
  nodes: z.array(specNodeSchema).describe('节点集合'),
  edges: z.array(specEdgeSchema).describe('连线集合'),
}).refine((s) => s.paradigm !== 'swimlane' || Boolean(s.lanes && s.lanes.length > 0), {
  message: 'swimlane 范式必须提供非空 lanes',
});

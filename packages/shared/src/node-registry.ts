/**
 * @fileoverview 流程图节点注册中心 (Node Registry)
 * @description 单一真实数据源 (SSOT)，统管所有节点类型的默认尺寸、连接桩、中文标签、图标与 MCP 描述
 */

import {
  FlowNodeType,
  NodeRegistryEntry,
  NodeHandleDef,
  Dimensions,
  FLOW_NODE_TYPES,
} from './types.js';

/**
 * 辅助函数：生成标准 4 方向连接桩 (上、右、下、左)
 */
const createStandardHandles = (): NodeHandleDef[] => [
  { id: 'top', position: 'top', type: 'both' },
  { id: 'right', position: 'right', type: 'both' },
  { id: 'bottom', position: 'bottom', type: 'both' },
  { id: 'left', position: 'left', type: 'both' },
];

/**
 * 9 大核心流程图节点注册表原始记录 (Record 格式)
 */
export const NODE_REGISTRY_RECORD: Record<FlowNodeType, NodeRegistryEntry> = {
  'start-end': {
    type: 'start-end',
    label: '开始/结束',
    icon: 'CirclePlay',
    defaultSize: { width: 120, height: 60 },
    handles: createStandardHandles(),
    mcpDescription: '流程开始或结束端点节点（圆角胶囊形/椭圆）',
  },
  process: {
    type: 'process',
    label: '处理',
    icon: 'Square',
    defaultSize: { width: 160, height: 80 },
    handles: createStandardHandles(),
    mcpDescription: '常规任务处理或计算操作步骤节点（标准矩形）',
  },
  decision: {
    type: 'decision',
    label: '判断',
    icon: 'Diamond',
    defaultSize: { width: 140, height: 100 },
    handles: createStandardHandles(),
    mcpDescription: '条件分支与逻辑判断节点，包含多路走向（菱形）',
  },
  io: {
    type: 'io',
    label: '输入输出',
    icon: 'ArrowRightLeft',
    defaultSize: { width: 160, height: 80 },
    handles: createStandardHandles(),
    mcpDescription: '数据、物资或外部信息的输入与输出节点（平行四边形）',
  },
  document: {
    type: 'document',
    label: '文档',
    icon: 'FileText',
    defaultSize: { width: 160, height: 80 },
    handles: createStandardHandles(),
    mcpDescription: '报表、单据、文件或文档输出节点（底部波浪形矩形）',
  },
  subprocess: {
    type: 'subprocess',
    label: '子流程',
    icon: 'Workflow',
    defaultSize: { width: 160, height: 80 },
    handles: createStandardHandles(),
    mcpDescription: '预定义过程或复用子流程调用节点（双垂直侧边线矩形）',
  },
  database: {
    type: 'database',
    label: '数据库',
    icon: 'Database',
    defaultSize: { width: 120, height: 100 },
    handles: createStandardHandles(),
    mcpDescription: '数据库存储介质或持久化数据源节点（圆柱形）',
  },
  comment: {
    type: 'comment',
    label: '注释便签',
    icon: 'StickyNote',
    defaultSize: { width: 200, height: 120 },
    handles: createStandardHandles(),
    mcpDescription: '流程图说明注释或高亮备忘便签节点（折角便签卡片）',
  },
  group: {
    type: 'group',
    label: '分组框',
    icon: 'Layers',
    defaultSize: { width: 400, height: 300 },
    handles: [], // 分组框不承载连线桩
    mcpDescription: '泳道或逻辑容器节点，用于在视觉与层级上编组子节点（矩形容器框）',
  },
};

/**
 * 9 大节点注册中心列表
 */
export const NODE_REGISTRY_LIST: readonly NodeRegistryEntry[] = Object.freeze(
  FLOW_NODE_TYPES.map((type) => NODE_REGISTRY_RECORD[type])
);

/**
 * 9 大节点注册中心 Map 实例（作为领域模型单一源 SSOT）
 */
export const NODE_REGISTRY: Map<FlowNodeType, NodeRegistryEntry> = new Map(
  FLOW_NODE_TYPES.map((type) => [type, NODE_REGISTRY_RECORD[type]])
);

/**
 * 根据节点类型获取其注册项元数据
 * @param type 流程图节点类型
 * @returns 节点注册配置项，若不存在则返回 undefined
 */
export function getNodeRegistryEntry(type: FlowNodeType): NodeRegistryEntry | undefined {
  return NODE_REGISTRY.get(type);
}

/**
 * 获取所有已注册的节点配置列表
 * @returns 节点注册配置数组
 */
export function getAllNodeRegistryEntries(): NodeRegistryEntry[] {
  return Array.from(NODE_REGISTRY.values());
}

/**
 * 校验输入值是否为合法的流程图节点类型
 * @param value 任意输入值
 * @returns 是否属于 FlowNodeType
 */
export function isFlowNodeType(value: unknown): value is FlowNodeType {
  return typeof value === 'string' && NODE_REGISTRY.has(value as FlowNodeType);
}

/**
 * 获取指定节点类型的默认尺寸
 * @param type 流程图节点类型
 * @returns 宽高尺寸对象
 */
export function getDefaultNodeSize(type: FlowNodeType): Dimensions {
  const entry = NODE_REGISTRY.get(type);
  if (entry) {
    return { ...entry.defaultSize };
  }
  return { width: 160, height: 80 };
}

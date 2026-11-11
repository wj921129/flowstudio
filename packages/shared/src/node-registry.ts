/**
 * @fileoverview 流程图节点注册中心 (Node Registry)
 * @description 单一真实数据源 (SSOT)，统管所有节点类型的默认尺寸、连接桩、中文标签、图标与 MCP 描述
 */

import {
  FlowNodeType,
  NodeRegistryEntry,
  NodeHandleDef,
  Dimensions,
  NodeCategory,
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
 * 辅助函数：生成水平双向连接桩 (左、右)
 */
const createHorizontalHandles = (): NodeHandleDef[] => [
  { id: 'right', position: 'right', type: 'both' },
  { id: 'left', position: 'left', type: 'both' },
];

/**
 * 全部节点注册表原始记录 (Record 格式)，覆盖流程、泳道、UML、架构与形状五类
 */
export const NODE_REGISTRY_RECORD: Record<FlowNodeType, NodeRegistryEntry> = {
  'start-end': {
    type: 'start-end',
    label: '开始/结束',
    icon: 'CirclePlay',
    category: '流程',
    defaultSize: { width: 120, height: 60 },
    handles: createStandardHandles(),
    mcpDescription: '流程开始或结束端点节点（圆角胶囊形/椭圆）',
  },
  process: {
    type: 'process',
    label: '处理',
    icon: 'Square',
    category: '流程',
    defaultSize: { width: 160, height: 80 },
    handles: createStandardHandles(),
    mcpDescription: '常规任务处理或计算操作步骤节点（标准矩形）',
  },
  decision: {
    type: 'decision',
    label: '判断',
    icon: 'Diamond',
    category: '流程',
    defaultSize: { width: 140, height: 100 },
    handles: createStandardHandles(),
    mcpDescription: '条件分支与逻辑判断节点，包含多路走向（菱形）',
  },
  io: {
    type: 'io',
    label: '输入输出',
    icon: 'ArrowRightLeft',
    category: '流程',
    defaultSize: { width: 160, height: 80 },
    handles: createStandardHandles(),
    mcpDescription: '数据、物资或外部信息的输入与输出节点（平行四边形）',
  },
  document: {
    type: 'document',
    label: '文档',
    icon: 'FileText',
    category: '流程',
    defaultSize: { width: 160, height: 80 },
    handles: createStandardHandles(),
    mcpDescription: '报表、单据、文件或文档输出节点（底部波浪形矩形）',
  },
  subprocess: {
    type: 'subprocess',
    label: '子流程',
    icon: 'Workflow',
    category: '流程',
    defaultSize: { width: 160, height: 80 },
    handles: createStandardHandles(),
    mcpDescription: '预定义过程或复用子流程调用节点（双垂直侧边线矩形）',
  },
  database: {
    type: 'database',
    label: '数据库',
    icon: 'Database',
    category: '流程',
    defaultSize: { width: 120, height: 100 },
    handles: createStandardHandles(),
    mcpDescription: '数据库存储介质或持久化数据源节点（圆柱形）',
  },
  comment: {
    type: 'comment',
    label: '注释便签',
    icon: 'StickyNote',
    category: '形状',
    defaultSize: { width: 200, height: 120 },
    handles: createStandardHandles(),
    mcpDescription: '流程图说明注释或高亮备忘便签节点（折角便签卡片）',
  },
  group: {
    type: 'group',
    label: '分组框',
    icon: 'Layers',
    category: '形状',
    defaultSize: { width: 400, height: 300 },
    handles: [], // 分组框不承载连线桩
    mcpDescription: '逻辑容器节点，用于在视觉与层级上编组子节点（矩形容器框）',
  },
  pool: {
    type: 'pool',
    label: '泳道池',
    icon: 'Columns3',
    category: '泳道',
    defaultSize: { width: 800, height: 400 },
    handles: [], // 泳道池容器不直接承载普通连线
    mcpDescription: '泳道池容器节点，支持横向或纵向多个泳道划分，包含整体表头（Pool）',
  },
  lane: {
    type: 'lane',
    label: '泳道',
    icon: 'Rows3',
    category: '泳道',
    defaultSize: { width: 750, height: 200 },
    handles: [], // 泳道本身为承载条带
    mcpDescription: '单一泳道节点，属于泳道池的子容器（Lane），负责容纳归属该泳道的步骤节点',
  },
  'uml-lifeline': {
    type: 'uml-lifeline',
    label: '生命线',
    icon: 'GitCommitVertical',
    category: 'UML',
    defaultSize: { width: 160, height: 480 },
    handles: createHorizontalHandles(),
    mcpDescription: 'UML 时序图生命线图元：顶部参与者头部框加纵向虚线（Lifeline）',
  },
  'uml-activation': {
    type: 'uml-activation',
    label: '激活块',
    icon: 'RectangleVertical',
    category: 'UML',
    defaultSize: { width: 32, height: 120 },
    handles: createHorizontalHandles(),
    mcpDescription: 'UML 时序图激活块图元：生命线上的窄高亮竖条，表示对象活跃期（Activation）',
  },
  'uml-message': {
    type: 'uml-message',
    label: '消息箭头',
    icon: 'MoveHorizontal',
    category: 'UML',
    defaultSize: { width: 240, height: 44 },
    handles: createHorizontalHandles(),
    mcpDescription:
      'UML 时序图消息箭头图元，messageKind 支持 sync（同步实线实心箭头）/ async（异步实线开放箭头）/ return（返回虚线开放箭头）',
  },
  'arch-microservice': {
    type: 'arch-microservice',
    label: '微服务',
    icon: 'Boxes',
    category: '架构',
    defaultSize: { width: 160, height: 96 },
    handles: createStandardHandles(),
    mcpDescription: '云原生微服务组件节点，支持 envTag 环境标签、protocol 调用协议与 health 健康度元数据',
  },
  'arch-gateway': {
    type: 'arch-gateway',
    label: '网关',
    icon: 'Router',
    category: '架构',
    defaultSize: { width: 160, height: 96 },
    handles: createStandardHandles(),
    mcpDescription: 'API 网关 / 入口路由组件节点，支持 envTag、protocol 与 health 元数据',
  },
  'arch-db-shard': {
    type: 'arch-db-shard',
    label: '数据库分片',
    icon: 'DatabaseZap',
    category: '架构',
    defaultSize: { width: 140, height: 120 },
    handles: createStandardHandles(),
    mcpDescription: '数据库分片存储组件节点（多片圆柱），支持 envTag 与 health 元数据',
  },
  'arch-cache': {
    type: 'arch-cache',
    label: '缓存集群',
    icon: 'Zap',
    category: '架构',
    defaultSize: { width: 140, height: 110 },
    handles: createStandardHandles(),
    mcpDescription: '分布式缓存集群组件节点（Redis 等），支持 envTag 与 health 元数据',
  },
  'arch-k8s-pod': {
    type: 'arch-k8s-pod',
    label: 'K8s Pod',
    icon: 'Ship',
    category: '架构',
    defaultSize: { width: 150, height: 110 },
    handles: createStandardHandles(),
    mcpDescription: 'Kubernetes Pod 编排单元节点，支持 envTag 环境标签与 health 健康度元数据',
  },
  'arch-docker': {
    type: 'arch-docker',
    label: 'Docker 容器',
    icon: 'Container',
    category: '架构',
    defaultSize: { width: 150, height: 100 },
    handles: createStandardHandles(),
    mcpDescription: 'Docker 容器运行时组件节点，支持 envTag、protocol 与 health 元数据',
  },
  'rich-card': {
    type: 'rich-card',
    label: '富文本卡片',
    icon: 'TextSelect',
    category: '形状',
    defaultSize: { width: 260, height: 190 },
    handles: createStandardHandles(),
    mcpDescription:
      '富文本卡片节点：markdown 内容、cardStatus 状态标签（draft/wip/done）与 owner 负责人头像气泡',
  },
};

/**
 * 节点分类排序索引（侧边栏 Tab 顺序）
 */
export const NODE_CATEGORY_ORDER: readonly NodeCategory[] = ['流程', '泳道', '架构', 'UML', '形状'];

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
 * 动态注册或更新节点类型至注册中心
 * @param entry 节点注册配置项
 */
export function registerNodeType(entry: NodeRegistryEntry): void {
  NODE_REGISTRY.set(entry.type, entry);
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

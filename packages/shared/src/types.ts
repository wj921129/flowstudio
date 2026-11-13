/**
 * @fileoverview FlowStudio 核心领域模型与类型定义
 * @description 包含节点类型、连线类型、图表结构、连接桩定义与样式数据结构
 */

/**
 * 流程图 9 种基础节点类型与 2 种泳道容器类型枚举
 */
export const FlowNodeTypeEnum = {
  StartEnd: 'start-end',
  Process: 'process',
  Decision: 'decision',
  IO: 'io',
  Document: 'document',
  Subprocess: 'subprocess',
  Database: 'database',
  Comment: 'comment',
  Group: 'group',
  Pool: 'pool',
  Lane: 'lane',
  UmlLifeline: 'uml-lifeline',
  UmlActivation: 'uml-activation',
  UmlMessage: 'uml-message',
  ArchMicroservice: 'arch-microservice',
  ArchGateway: 'arch-gateway',
  ArchDbShard: 'arch-db-shard',
  ArchCache: 'arch-cache',
  ArchK8sPod: 'arch-k8s-pod',
  ArchDocker: 'arch-docker',
  RichCard: 'rich-card',
} as const;

/**
 * 流程图节点类型联合类型（含流程节点、泳道容器、UML 图元、架构图元与富文本卡片）
 */
export type FlowNodeType =
  | 'start-end'
  | 'process'
  | 'decision'
  | 'io'
  | 'document'
  | 'subprocess'
  | 'database'
  | 'comment'
  | 'group'
  | 'pool'
  | 'lane'
  | 'uml-lifeline'
  | 'uml-activation'
  | 'uml-message'
  | 'arch-microservice'
  | 'arch-gateway'
  | 'arch-db-shard'
  | 'arch-cache'
  | 'arch-k8s-pod'
  | 'arch-docker'
  | 'rich-card';

/**
 * 所有支持的节点类型列表（只读元组）
 */
export const FLOW_NODE_TYPES: readonly FlowNodeType[] = [
  'start-end',
  'process',
  'decision',
  'io',
  'document',
  'subprocess',
  'database',
  'comment',
  'group',
  'pool',
  'lane',
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
] as const;

/**
 * 节点资产库侧边栏分组分类
 */
export type NodeCategory = '流程' | '泳道' | '架构' | 'UML' | '形状';

export const NODE_CATEGORIES: readonly NodeCategory[] = ['流程', '泳道', '架构', 'UML', '形状'];

/**
 * UML 消息箭头类型
 * - 'sync': 同步消息（实线实心箭头）
 * - 'async': 异步消息（实线开放箭头）
 * - 'return': 返回消息（虚线开放箭头）
 */
export type UmlMessageKind = 'sync' | 'async' | 'return';

/**
 * 架构图元健康度指示
 */
export type NodeHealth = 'ok' | 'warn' | 'error';

/**
 * 富文本卡片状态标签
 */
export type RichCardStatus = 'draft' | 'wip' | 'done';

/**
 * 坐标位置
 */
export interface XYPosition {
  x: number;
  y: number;
}

/**
 * 尺寸大小
 */
export interface Dimensions {
  width: number;
  height: number;
}

/**
 * 节点尺寸类型别名（兼容 NodeSize 命名）
 */
export type NodeSize = Dimensions;

/**
 * 节点连接桩位置
 */
export type HandlePosition = 'top' | 'right' | 'bottom' | 'left';

/**
 * 连接桩连接方向
 * - 'source': 仅作为连线起点
 * - 'target': 仅作为连线终点
 * - 'both': 既可作为起点也可作为终点
 */
export type HandleType = 'source' | 'target' | 'both';

/**
 * 节点连接桩元数据定义
 */
export interface NodeHandleDef {
  /** 连接桩唯一标识 */
  id: string;
  /** 桩所在方位 */
  position: HandlePosition;
  /** 桩的流向类型 */
  type: HandleType;
}

/**
 * 节点样式自定义数据
 */
export interface NodeStyleData {
  /** 填充背景色 */
  fillColor?: string;
  /** 边框颜色 */
  borderColor?: string;
  /** 边框线宽 (px) */
  borderWidth?: number;
  /** 边框样式 (实线/虚线) */
  borderStyle?: 'solid' | 'dashed';
  /** 字号大小 (px) */
  fontSize?: number;
  /** 字体颜色 */
  fontColor?: string;
  /** 扩展属性 */
  [key: string]: unknown;
}

/**
 * 连线样式自定义数据
 */
export interface EdgeStyleData {
  /** 连线描边颜色 */
  strokeColor?: string;
  /** 连线线宽 (px) */
  strokeWidth?: number;
  /** 连线线型 (实线/虚线) */
  strokeStyle?: 'solid' | 'dashed';
  /** 是否呈现流动动画 */
  animated?: boolean;
  /** 扩展属性 */
  [key: string]: unknown;
}

/**
 * 节点锚定锁模式
 * - 'none': 未锁定（默认可自由编辑）
 * - 'position': 坐标锁定，允许改文案/样式，禁止移动与自动排版
 * - 'full': 完全锁定，禁止移动、修改与删除（AI 修改需跳过并告警）
 */
export type NodeLockMode = 'none' | 'position' | 'full';

/**
 * 流程图节点携带的数据负载 (FlowNode.data)
 */
export interface FlowNodeData {
  /** 节点显示文本 */
  label: string;
  /** 节点类型 */
  type: FlowNodeType;
  /** 节点锚定锁模式（默认 'none'） */
  lockMode?: NodeLockMode;
  /** 所属父容器或 Group ID */
  parentId?: string;
  /** 组合形态：true 为显式容器框(带标题和底色)，false/undefined 为纯逻辑组合 */
  isFrame?: boolean;
  /** 折叠状态 (针对容器框) */
  isCollapsed?: boolean;
  /** 泳道池方向：水平 (横向) 或 垂直 (纵向) */
  orientation?: 'horizontal' | 'vertical';
  /** 泳道池包含的子泳道 ID 有序列表 */
  laneOrder?: string[];
  /** 泳道或池表头颜色 */
  headerColor?: string;
  /** 泳道标题 */
  laneTitle?: string;
  /** 泳道或池表头宽度/高度 (默认 40px) */
  headerSize?: number;
  /** 节点自定义样式覆盖 */
  style?: NodeStyleData;
  /** 节点详细描述说明 */
  description?: string;
  /** 架构图元：环境标签 (Prod / Staging / Dev) */
  envTag?: string;
  /** 架构图元：调用协议 (HTTP / gRPC / Kafka 等) */
  protocol?: string;
  /** 架构图元：健康度指示点 */
  health?: NodeHealth;
  /** 富文本卡片：Markdown 内容 */
  markdown?: string;
  /** 富文本卡片：状态标签 */
  cardStatus?: RichCardStatus;
  /** 富文本卡片：负责人昵称（头像气泡） */
  owner?: string;
  /** UML 消息箭头类型（仅 uml-message） */
  messageKind?: UmlMessageKind;
  /** 扩展属性 */
  [key: string]: unknown;
}

/**
 * 流程图连线携带的数据负载 (FlowEdge.data)
 */
export interface FlowEdgeData {
  /** 连线标签文本 */
  label?: string;
  /** 连线自定义样式覆盖 */
  style?: EdgeStyleData;
  /** 手动调线折拐点坐标集合 */
  waypoints?: XYPosition[];
  /** 连线路由策略: orthogonal | bezier | straight */
  routingType?: 'orthogonal' | 'bezier' | 'straight';
  /** 扩展属性 */
  [key: string]: unknown;
}

/**
 * 流程图节点完整实体结构（对齐 React Flow 节点模型并提供标准强类型）
 */
export interface FlowNode {
  /** 节点全局唯一 ID */
  id: string;
  /** 节点类型 */
  type: FlowNodeType;
  /** 节点在画布中的绝对/相对坐标 */
  position: XYPosition;
  /** 节点绑定的业务数据 */
  data: FlowNodeData;
  /** 父节点 ID（用于分组与泳道容器嵌套） */
  parentId?: string;
  /** 移动范围约束（通常用于子节点限制在父容器内） */
  extent?: 'parent';
  /** 节点渲染宽度 */
  width?: number;
  /** 节点渲染高度 */
  height?: number;
  /** 是否处于选中态 */
  selected?: boolean;
  /** 是否正在被拖拽 */
  dragging?: boolean;
  /** 自定义行内样式 */
  style?: Record<string, unknown>;
  /** 自定义 CSS 类名 */
  className?: string;
  /** 图层层级 */
  zIndex?: number;
  /** 扩展属性 */
  [key: string]: unknown;
}

/**
 * 流程图连线完整实体结构（对齐 React Flow 连线模型并提供标准强类型）
 */
export interface FlowEdge {
  /** 连线全局唯一 ID */
  id: string;
  /** 起始源节点 ID */
  source: string;
  /** 目标节点 ID */
  target: string;
  /** 起始源连接桩 ID */
  sourceHandle?: string;
  /** 目标连接桩 ID */
  targetHandle?: string;
  /** 连线渲染组件类型（如 'smoothstep' | 'orthogonal' | 'straight'） */
  type?: string;
  /** 连线绑定的业务数据 */
  data?: FlowEdgeData;
  /** 连线文本标签 */
  label?: string;
  /** 是否呈现流动动画 */
  animated?: boolean;
  /** 是否处于选中态 */
  selected?: boolean;
  /** 自定义行内样式 */
  style?: Record<string, unknown>;
  /** 自定义 CSS 类名 */
  className?: string;
  /** 图层层级 */
  zIndex?: number;
  /** 扩展属性 */
  [key: string]: unknown;
}

/**
 * 流程图图表持久化完整模型
 */
export interface FlowDiagram {
  /** 图表唯一标识 */
  id: string;
  /** 图表标题 */
  title: string;
  /** 图表中所有节点列表 */
  nodes: FlowNode[];
  /** 图表中所有连线列表 */
  edges: FlowEdge[];
  /** 创建时间 (ISO 8601 字符串) */
  createdAt: string;
  /** 最后更新时间 (ISO 8601 字符串) */
  updatedAt: string;
  /** 图表补充描述 */
  description?: string;
  /** Schema 版本号 */
  version?: string;
  /** 扩展元数据 */
  [key: string]: unknown;
}

/**
 * 节点注册中心配置项（单一真实数据源 SSOT）
 */
export interface NodeRegistryEntry {
  /** 节点类型 */
  type: FlowNodeType;
  /** UI 菜单与默认标题中呈现的中文名称 */
  label: string;
  /** 对应 Lucide 图标名称 */
  icon: string;
  /** 默认宽高尺寸 */
  defaultSize: Dimensions;
  /** 预定义连接桩集合 */
  handles: NodeHandleDef[];
  /** 节点资产库侧边栏分组分类 */
  category: NodeCategory;
  /** MCP / AI Agent 交互描述（用于语义化提示与生成） */
  mcpDescription: string;
}

/**
 * 图表简要元数据（用于列表、看板、卡片展示）
 */
export interface DiagramSummary {
  /** 图表唯一标识 */
  id: string;
  /** 图表标题 */
  title: string;
  /** 图表补充描述 */
  description: string;
  /** SVG 缩略图字符串 */
  thumbnail: string;
  /** 创建时间 (ISO 8601 字符串) */
  createdAt: string;
  /** 最后更新时间 (ISO 8601 字符串) */
  updatedAt: string;
}

/**
 * 局域网免登用户身份模型
 */
export interface UserIdentity {
  /** 浏览器客户端唯一 ID */
  clientId: string;
  /** 用户昵称 */
  nickname: string;
  /** 分配的高对比度专属颜色 (十六进制) */
  color: string;
  /** 是否首次访问（用于弹窗提示） */
  isFirstVisit?: boolean;
}

/**
 * Hocuspocus Awareness 广播状态
 */
export interface AwarenessUserState {
  /** 客户端 ID */
  clientId: string;
  /** 用户昵称 */
  nickname: string;
  /** 分配的颜色 */
  color: string;
  /** 鼠标在画布中的世界坐标 (Flow Position)，移出时为 null */
  cursor: { x: number; y: number } | null;
  /** 当前选中的节点 ID 集合 */
  selectedNodeIds: string[];
  /** 当前画布视口偏移与缩放（用于局域网评审跟随带看） */
  viewport?: { x: number; y: number; zoom: number };
  /** 当前聚光灯高亮的因果链路节点 ID 集合 */
  spotlightNodeIds?: string[];
  /** 是否为 AI 协作者身份 */
  isAi?: boolean;
  /** AI 协作者名称（如 Agent / 模型名） */
  agentName?: string;
  aiPlanning?: { isPlanning: boolean; prompt?: string };
}

/**
 * AI 批次实体类型
 */
export type AiBatchEntityType = 'node' | 'edge';

/**
 * AI 批次实体操作类型
 */
export type AiBatchOpType = 'add' | 'update' | 'delete';

/**
 * AI 批次实体级 Diff 明细
 */
export interface AiBatchEntityDiff {
  /** 实体唯一 ID（节点或连线） */
  entityId: string;
  /** 实体类型 */
  entityType: AiBatchEntityType;
  /** 操作类型 */
  opType: AiBatchOpType;
  /** 操作前完整状态快照（add 为 null） */
  beforeState: Record<string, unknown> | null;
  /** 操作后完整状态快照（delete 为 null） */
  afterState: Record<string, unknown> | null;
  /** 该项是否已被撤回/采纳 */
  reverted?: boolean;
}

/**
 * AI 批次状态
 */
export type AiBatchStatus = 'active' | 'partially_reverted' | 'reverted';

/**
 * 持久化 AI 批次账本记录
 */
export interface AiBatchRecord {
  /** 批次唯一标识 */
  batchId: string;
  /** 所属图表 ID */
  diagramId: string;
  /** AI 协作者名称 */
  agentName?: string;
  /** 批次变更摘要 */
  summary: string;
  /** 批次当前状态 */
  status: AiBatchStatus;
  /** 实体级 Diff 明细 */
  diffs: AiBatchEntityDiff[];
  /** 创建时间 (ISO 8601 字符串) */
  createdAt: string;
}

/**
 * 撤回时被安全跳过的明细（人类已二次修改或已锁定）
 */
export interface AiBatchSkippedDetail {
  /** 实体 ID */
  entityId: string;
  /** 实体类型 */
  entityType: AiBatchEntityType;
  /** 被跳过的具体字段（如 label / position / style） */
  field?: string;
  /** 跳过原因 */
  reason: string;
}

/**
 * 单点/多点精细化撤回（Cherry-Pick）请求契约
 */
export interface RevertBatchItemsRequest {
  /** 需要撤回的实体 ID 列表 */
  entityIds: string[];
}

/**
 * AI 批次撤回结果契约
 */
export interface AiBatchRevertResult {
  /** 是否执行成功 */
  success: boolean;
  /** 是否有实际改动 */
  reverted: boolean;
  /** 批次 ID */
  batchId: string;
  /** 图表 ID */
  diagramId: string;
  /** 已成功撤回的实体 ID 列表 */
  revertedEntityIds: string[];
  /** 被安全跳过的明细 */
  skipped: AiBatchSkippedDetail[];
  /** 跳过数量 */
  skippedCount: number;
  /** 批次撤回后的最新状态 */
  status: AiBatchStatus;
  /** 面向用户的提示文案 */
  message: string;
}

/**
 * 协作者专属高对比度配色池
 */
export const COLLABORATOR_COLORS: readonly string[] = [
  '#6366F1',
  '#EC4899',
  '#10B981',
  '#F59E0B',
  '#8B5CF6',
  '#06B6D4',
  '#3B82F6',
  '#EF4444',
] as const;

/**
 * 图表历史快照摘要
 */
export interface SnapshotSummary {
  /** 快照唯一标识 */
  id: string;
  /** 所属图表 ID */
  diagramId: string;
  /** 快照备注标题 */
  label: string;
  /** 触发类型：手动触发 | AI批次前自动快照 | 自动安全备份 | 定时轮巡快照 */
  triggerType: 'manual' | 'ai_batch' | 'auto' | 'timer';
  /** 创建时间 ISO 字符串 */
  createdAt: string;
}


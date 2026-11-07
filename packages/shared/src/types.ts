/**
 * @fileoverview FlowStudio 核心领域模型与类型定义
 * @description 包含节点类型、连线类型、图表结构、连接桩定义与样式数据结构
 */

/**
 * 流程图 9 种基础节点类型枚举
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
} as const;

/**
 * 流程图节点类型联合类型
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
  | 'group';

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
] as const;

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
 * 流程图节点携带的数据负载 (FlowNode.data)
 */
export interface FlowNodeData {
  /** 节点显示文本 */
  label: string;
  /** 节点类型 */
  type: FlowNodeType;
  /** 所属父容器或 Group ID */
  parentId?: string;
  /** 组合形态：true 为显式容器框(带标题和底色)，false/undefined 为纯逻辑组合 */
  isFrame?: boolean;
  /** 折叠状态 (针对容器框) */
  isCollapsed?: boolean;
  /** 节点自定义样式覆盖 */
  style?: NodeStyleData;
  /** 节点详细描述说明 */
  description?: string;
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
  /** MCP / AI Agent 交互描述（用于语义化提示与生成） */
  mcpDescription: string;
}

/**
 * @fileoverview FlowStudio 全局共享常量
 * @description 包含本地持久化 Key、图表默认配置、样式预设与交互参数
 */

import { FlowNodeType, NodeStyleData, EdgeStyleData, FLOW_NODE_TYPES } from './types.js';
import { NODE_REGISTRY_RECORD } from './node-registry.js';

/**
 * 流程图 LocalStorage 持久化存储键
 */
export const FS_DIAGRAM_STORAGE_KEY = 'fs-diagram';

/**
 * 主题偏好设置 LocalStorage 存储键
 */
export const FS_THEME_STORAGE_KEY = 'fs-theme';

/**
 * 存储键聚合字典
 */
export const STORAGE_KEYS = {
  DIAGRAM: FS_DIAGRAM_STORAGE_KEY,
  THEME: FS_THEME_STORAGE_KEY,
} as const;

/**
 * 默认图表标题
 */
export const DEFAULT_DIAGRAM_TITLE = '未命名流程图';

/**
 * 默认连线类型（标准正交折线）
 */
export const DEFAULT_EDGE_TYPE = 'smoothstep';

/**
 * 自动保存防抖延迟时间 (毫秒)
 */
export const AUTO_SAVE_DEBOUNCE_MS = 500;

/**
 * 各节点类型的默认显示标签（直接从 NODE_REGISTRY_RECORD 派生，严格保证单一真实源 SSOT）
 */
export const DEFAULT_NODE_LABELS: Record<FlowNodeType, string> = Object.freeze(
  Object.fromEntries(
    FLOW_NODE_TYPES.map((type) => [type, NODE_REGISTRY_RECORD[type].label])
  ) as Record<FlowNodeType, string>
);

/**
 * 节点默认样式数据
 */
export const DEFAULT_NODE_STYLE: Readonly<NodeStyleData> = {
  borderWidth: 1.5,
  borderStyle: 'solid',
  fontSize: 14,
};

/**
 * 连线默认样式数据
 */
export const DEFAULT_EDGE_STYLE: Readonly<EdgeStyleData> = {
  strokeWidth: 1.5,
  strokeStyle: 'solid',
  animated: false,
};

/**
 * 画布缩放范围限制
 */
export const CANVAS_ZOOM_LIMITS = {
  minZoom: 0.1,
  maxZoom: 2.5,
} as const;

/**
 * 画布网格吸附步长 [x, y]（可变元组类型以直接兼容 React Flow 的 snapGrid 参数）
 */
export const DEFAULT_SNAP_GRID: [number, number] = [15, 15];

/**
 * 默认视口配置
 */
export const DEFAULT_VIEWPORT = {
  x: 0,
  y: 0,
  zoom: 1,
} as const;

/**
 * @fileoverview FlowStudio 全局共享常量
 * @description 包含本地持久化 Key、图表默认配置、样式预设与交互参数
 */

import { FlowNodeType, NodeStyleData, EdgeStyleData } from './types.js';

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
 * 各节点类型的默认显示标签
 */
export const DEFAULT_NODE_LABELS: Record<FlowNodeType, string> = {
  'start-end': '开始/结束',
  process: '处理步骤',
  decision: '条件判断',
  io: '输入/输出',
  document: '文档说明',
  subprocess: '子流程',
  database: '数据存储',
  comment: '便签注释',
  group: '新建分组',
};

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
 * 画布网格吸附步长 [x, y]
 */
export const DEFAULT_SNAP_GRID: readonly [number, number] = [15, 15] as const;

/**
 * 默认视口配置
 */
export const DEFAULT_VIEWPORT = {
  x: 0,
  y: 0,
  zoom: 1,
} as const;

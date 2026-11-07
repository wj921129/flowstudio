/**
 * @fileoverview FlowStore React Hook 统一导出
 * @description 便于 React 组件便捷订阅与消费 FlowStudio 全局画布状态
 */

export { useFlowStore, flowStore } from '../stores/flow-store';
export type {
  ActiveTool,
  DiagramSnapshot,
  FlowStore,
  FlowStoreState,
  FlowStoreActions,
} from '../stores/flow-store';

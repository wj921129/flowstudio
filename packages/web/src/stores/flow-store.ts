/**
 * @fileoverview FlowStudio 全局流程图状态管理 (Zustand Store)
 * @description 管理节点、连线、工具模式、选择态以及快照撤销/重做历史
 */

import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from '@xyflow/react';
import type {
  FlowNode,
  FlowEdge,
  FlowNodeData,
  FlowEdgeData,
  FlowNodeType,
} from '@flowstudio/shared';
import { DEFAULT_EDGE_TYPE } from '@flowstudio/shared';
import { createNodeFromType, generateEdgeId } from '../lib/node-utils';

/**
 * 画布操作工具模式枚举
 * - 'select': 选择模式（框选、点击选择、拖拽节点）
 * - 'pan': 漫游平移模式（拖动画布）
 * - 'connect': 快速连线模式
 */
export type ActiveTool = 'select' | 'pan' | 'connect';

/**
 * 历史快照单元（用于撤销/重做）
 */
export interface DiagramSnapshot {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/**
 * FlowStore 状态定义
 */
export interface FlowStoreState {
  /** 当前画布节点列表 */
  nodes: FlowNode[];
  /** 当前画布连线列表 */
  edges: FlowEdge[];
  /** 当前选中的节点 ID 集合 */
  selectedNodeIds: string[];
  /** 当前选中的连线 ID，若无则为 null */
  selectedEdgeId: string | null;
  /** 当前激活的操作工具模式 */
  activeTool: ActiveTool;
  /** 是否可撤销 */
  canUndo: boolean;
  /** 是否可重做 */
  canRedo: boolean;
}

/**
 * 内部历史管理状态扩展
 */
interface FlowStoreInternalState extends FlowStoreState {
  historyPast: DiagramSnapshot[];
  historyFuture: DiagramSnapshot[];
  isInteracting: boolean;
}

/**
 * FlowStore 操作动作定义
 */
export interface FlowStoreActions {
  /** 节点状态变更处理器（位置拖拽、选择、尺寸等） */
  onNodesChange: (changes: NodeChange[]) => void;
  /** 连线状态变更处理器（选择、删除等） */
  onEdgesChange: (changes: EdgeChange[]) => void;
  /** 节点连线建立处理器 */
  onConnect: (connection: Connection) => void;
  /** 添加指定类型的节点至目标画布坐标 */
  addNode: (type: FlowNodeType, position: { x: number; y: number }) => FlowNode;
  /** 删除所有选中的节点及其相连的连线，以及选中的连线 */
  deleteSelected: () => void;
  /** 更新指定节点的业务数据 */
  updateNodeData: (id: string, data: Partial<FlowNodeData>) => void;
  /** 更新指定连线的业务数据 */
  updateEdgeData: (id: string, data: Partial<FlowEdgeData>) => void;
  /** 设置选中的节点 ID 列表 */
  setSelectedNodes: (ids: string[]) => void;
  /** 设置选中的连线 ID */
  setSelectedEdge: (id: string | null) => void;
  /** 切换激活工具 */
  setActiveTool: (tool: ActiveTool) => void;
  /** 撤销操作 */
  undo: () => void;
  /** 重做操作 */
  redo: () => void;
  /** 全量替换图表数据（通常用于数据水合与新建/重置图表） */
  setDiagram: (nodes: FlowNode[], edges: FlowEdge[]) => void;
}

export type FlowStore = FlowStoreInternalState & FlowStoreActions;

/** 历史快照最大存储上限 */
const MAX_HISTORY_LENGTH = 50;

/**
 * 深拷贝快照，保障历史切片不可变
 */
function cloneSnapshot(nodes: FlowNode[], edges: FlowEdge[]): DiagramSnapshot {
  if (typeof structuredClone === 'function') {
    return {
      nodes: structuredClone(nodes),
      edges: structuredClone(edges),
    };
  }
  return {
    nodes: JSON.parse(JSON.stringify(nodes)),
    edges: JSON.parse(JSON.stringify(edges)),
  };
}

/**
 * 记录历史快照辅助计算
 */
function pushHistorySnapshot(
  currentPast: DiagramSnapshot[],
  nodes: FlowNode[],
  edges: FlowEdge[]
) {
  const snapshot = cloneSnapshot(nodes, edges);
  const nextPast = [...currentPast, snapshot];
  if (nextPast.length > MAX_HISTORY_LENGTH) {
    nextPast.shift();
  }
  return {
    historyPast: nextPast,
    historyFuture: [],
    canUndo: true,
    canRedo: false,
  };
}

/**
 * 创建 FlowStore Zustand 实例
 */
export const useFlowStore = create<FlowStore>((set, get) => ({
  // 初始状态
  nodes: [],
  edges: [],
  selectedNodeIds: [],
  selectedEdgeId: null,
  activeTool: 'select',
  canUndo: false,
  canRedo: false,
  historyPast: [],
  historyFuture: [],
  isInteracting: false,

  // 动作定义
  onNodesChange: (changes: NodeChange[]) => {
    const { nodes, edges, historyPast, isInteracting } = get();

    // 判断是否仅包含选中状态变更（无需入历史栈）
    const isSelectionOnly =
      changes.length > 0 && changes.every((c) => c.type === 'select');

    let nextInteracting = isInteracting;
    let shouldPushHistory = false;

    if (!isSelectionOnly) {
      const hasDragStart = changes.some(
        (c) =>
          (c.type === 'position' && (c as unknown as { dragging?: boolean }).dragging === true) ||
          (c.type === 'dimensions' && (c as unknown as { resizing?: boolean }).resizing === true)
      );
      const hasDragEnd = changes.some(
        (c) =>
          (c.type === 'position' && (c as unknown as { dragging?: boolean }).dragging === false) ||
          (c.type === 'dimensions' && (c as unknown as { resizing?: boolean }).resizing === false)
      );

      if (hasDragStart) {
        if (!isInteracting) {
          // 交互拖拽刚触发：记录开始前的稳定快照
          shouldPushHistory = true;
          nextInteracting = true;
        }
      } else if (hasDragEnd) {
        nextInteracting = false;
      } else if (!isInteracting) {
        // 非拖拽连发过程中的修改（如测试调用、直接赋值或节点移除等）
        shouldPushHistory = true;
      }
    }

    const historyUpdate = shouldPushHistory
      ? pushHistorySnapshot(historyPast, nodes, edges)
      : {};

    const nextNodes = applyNodeChanges(changes as any, nodes) as FlowNode[];

    // 若存在节点删除，级联清除相关连线以保持图表引用一致
    const hasRemove = changes.some((c) => c.type === 'remove');
    let nextEdges = edges;
    if (hasRemove) {
      const activeNodeIdSet = new Set(nextNodes.map((n) => n.id));
      nextEdges = edges.filter(
        (e) => activeNodeIdSet.has(e.source) && activeNodeIdSet.has(e.target)
      );
    }

    const nextSelectedNodeIds = nextNodes
      .filter((n) => n.selected)
      .map((n) => n.id);

    set({
      nodes: nextNodes,
      edges: nextEdges,
      selectedNodeIds: nextSelectedNodeIds,
      isInteracting: nextInteracting,
      ...historyUpdate,
    });
  },

  onEdgesChange: (changes: EdgeChange[]) => {
    const { nodes, edges, historyPast } = get();

    const isSelectionOnly =
      changes.length > 0 && changes.every((c) => c.type === 'select');
    const shouldPushHistory = !isSelectionOnly;

    const historyUpdate = shouldPushHistory
      ? pushHistorySnapshot(historyPast, nodes, edges)
      : {};

    const nextEdges = applyEdgeChanges(changes as any, edges) as FlowEdge[];
    const selectedEdge = nextEdges.find((e) => e.selected);

    set({
      edges: nextEdges,
      selectedEdgeId: selectedEdge ? selectedEdge.id : null,
      ...historyUpdate,
    });
  },

  onConnect: (connection: Connection) => {
    if (!connection.source || !connection.target) {
      return;
    }

    const { nodes, edges, historyPast } = get();

    const newEdge: FlowEdge = {
      id: generateEdgeId(connection.source, connection.target),
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle ?? undefined,
      targetHandle: connection.targetHandle ?? undefined,
      type: DEFAULT_EDGE_TYPE,
      animated: false,
    };

    const nextEdges = addEdge(newEdge as any, edges) as FlowEdge[];
    if (nextEdges.length === edges.length) {
      return;
    }

    const historyUpdate = pushHistorySnapshot(historyPast, nodes, edges);

    set({
      edges: nextEdges,
      ...historyUpdate,
    });
  },

  addNode: (type: FlowNodeType, position: { x: number; y: number }): FlowNode => {
    const { nodes, edges, historyPast } = get();
    const historyUpdate = pushHistorySnapshot(historyPast, nodes, edges);

    const newNode = createNodeFromType(type, position);
    const nextNodes = [...nodes, newNode];

    set({
      nodes: nextNodes,
      ...historyUpdate,
    });

    return newNode;
  },

  deleteSelected: () => {
    const { nodes, edges, selectedNodeIds, selectedEdgeId, historyPast } = get();

    // 收集需删除的节点 ID
    const nodeIdsToDelete = new Set(selectedNodeIds);
    for (const n of nodes) {
      if (n.selected) {
        nodeIdsToDelete.add(n.id);
      }
    }

    // 收集需删除的连线 ID（直接选中 + 连接到被删除节点的连线）
    const edgeIdsToDelete = new Set<string>();
    if (selectedEdgeId) {
      edgeIdsToDelete.add(selectedEdgeId);
    }
    for (const e of edges) {
      if (
        e.selected ||
        nodeIdsToDelete.has(e.source) ||
        nodeIdsToDelete.has(e.target)
      ) {
        edgeIdsToDelete.add(e.id);
      }
    }

    if (nodeIdsToDelete.size === 0 && edgeIdsToDelete.size === 0) {
      return;
    }

    const historyUpdate = pushHistorySnapshot(historyPast, nodes, edges);

    const nextNodes = nodes.filter((n) => !nodeIdsToDelete.has(n.id));
    const nextEdges = edges.filter((e) => !edgeIdsToDelete.has(e.id));

    set({
      nodes: nextNodes,
      edges: nextEdges,
      selectedNodeIds: [],
      selectedEdgeId: null,
      ...historyUpdate,
    });
  },

  updateNodeData: (id: string, data: Partial<FlowNodeData>) => {
    const { nodes, edges, historyPast } = get();
    const targetNode = nodes.find((n) => n.id === id);
    if (!targetNode) {
      return;
    }

    const historyUpdate = pushHistorySnapshot(historyPast, nodes, edges);

    const nextNodes = nodes.map((n) => {
      if (n.id === id) {
        return {
          ...n,
          data: {
            ...n.data,
            ...data,
            style: {
              ...n.data.style,
              ...data.style,
            },
          },
        };
      }
      return n;
    });

    set({
      nodes: nextNodes,
      ...historyUpdate,
    });
  },

  updateEdgeData: (id: string, data: Partial<FlowEdgeData>) => {
    const { nodes, edges, historyPast } = get();
    const targetEdge = edges.find((e) => e.id === id);
    if (!targetEdge) {
      return;
    }

    const historyUpdate = pushHistorySnapshot(historyPast, nodes, edges);

    const nextEdges = edges.map((e) => {
      if (e.id === id) {
        return {
          ...e,
          data: {
            ...e.data,
            ...data,
            style: {
              ...e.data?.style,
              ...data.style,
            },
          },
        };
      }
      return e;
    });

    set({
      edges: nextEdges,
      ...historyUpdate,
    });
  },

  setSelectedNodes: (ids: string[]) => {
    const idSet = new Set(ids);
    const nextNodes = get().nodes.map((n) => ({
      ...n,
      selected: idSet.has(n.id),
    }));
    set({
      nodes: nextNodes,
      selectedNodeIds: ids,
    });
  },

  setSelectedEdge: (id: string | null) => {
    const nextEdges = get().edges.map((e) => ({
      ...e,
      selected: id !== null && e.id === id,
    }));
    set({
      edges: nextEdges,
      selectedEdgeId: id,
    });
  },

  setActiveTool: (tool: ActiveTool) => {
    set({ activeTool: tool });
  },

  undo: () => {
    const { historyPast, historyFuture, nodes, edges } = get();
    if (historyPast.length === 0) {
      return;
    }

    const previous = historyPast[historyPast.length - 1];
    const newPast = historyPast.slice(0, historyPast.length - 1);
    const currentSnapshot = cloneSnapshot(nodes, edges);
    const newFuture = [currentSnapshot, ...historyFuture];

    const restoredNodeIds = new Set(previous.nodes.map((n) => n.id));
    const nextSelectedNodeIds = get().selectedNodeIds.filter((id) =>
      restoredNodeIds.has(id)
    );
    const restoredEdgeIds = new Set(previous.edges.map((e) => e.id));
    const nextSelectedEdgeId =
      get().selectedEdgeId && restoredEdgeIds.has(get().selectedEdgeId!)
        ? get().selectedEdgeId
        : null;

    set({
      nodes: previous.nodes,
      edges: previous.edges,
      selectedNodeIds: nextSelectedNodeIds,
      selectedEdgeId: nextSelectedEdgeId,
      historyPast: newPast,
      historyFuture: newFuture,
      canUndo: newPast.length > 0,
      canRedo: true,
    });
  },

  redo: () => {
    const { historyPast, historyFuture, nodes, edges } = get();
    if (historyFuture.length === 0) {
      return;
    }

    const next = historyFuture[0];
    const newFuture = historyFuture.slice(1);
    const currentSnapshot = cloneSnapshot(nodes, edges);
    const newPast = [...historyPast, currentSnapshot];

    const restoredNodeIds = new Set(next.nodes.map((n) => n.id));
    const nextSelectedNodeIds = get().selectedNodeIds.filter((id) =>
      restoredNodeIds.has(id)
    );
    const restoredEdgeIds = new Set(next.edges.map((e) => e.id));
    const nextSelectedEdgeId =
      get().selectedEdgeId && restoredEdgeIds.has(get().selectedEdgeId!)
        ? get().selectedEdgeId
        : null;

    set({
      nodes: next.nodes,
      edges: next.edges,
      selectedNodeIds: nextSelectedNodeIds,
      selectedEdgeId: nextSelectedEdgeId,
      historyPast: newPast,
      historyFuture: newFuture,
      canUndo: true,
      canRedo: newFuture.length > 0,
    });
  },

  setDiagram: (nodes: FlowNode[], edges: FlowEdge[]) => {
    const snapshot = cloneSnapshot(nodes, edges);
    set({
      nodes: snapshot.nodes,
      edges: snapshot.edges,
      selectedNodeIds: [],
      selectedEdgeId: null,
      historyPast: [],
      historyFuture: [],
      canUndo: false,
      canRedo: false,
      isInteracting: false,
    });
  },
}));

/**
 * 导出 store 实例，供非 React 组件环境或测试直接调用
 */
export const flowStore = useFlowStore;

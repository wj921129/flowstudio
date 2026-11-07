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
import { createNodeFromType, generateEdgeId, generateUniqueId } from '../lib/node-utils';
import {
  computeBoundingBox,
  toLocalPosition,
  toWorldPosition,
  getNodeDimensions,
} from '../features/canvas/utils/group-calculator';

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
  /** 将当前选中的多个节点进行成组包装 */
  groupSelectedNodes: (options?: { asFrame?: boolean; label?: string }) => string | null;
  /** 解散指定的组合节点或当前选中的组合节点 */
  ungroupNodes: (groupIds?: string[]) => void;
  /** 批量对齐选中的多个节点 */
  alignSelectedNodes: (alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
  /** 批量均匀分布选中的多个节点 */
  distributeSelectedNodes: (axis: 'horizontal' | 'vertical') => void;
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
    if (changes.length === 0) {
      return;
    }

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
    if (changes.length === 0) {
      return;
    }

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

    const nextSelectedNodeIds = previous.nodes
      .filter((n) => n.selected)
      .map((n) => n.id);
    const nextSelectedEdgeId =
      previous.edges.find((e) => e.selected)?.id ?? null;

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

    const nextSelectedNodeIds = next.nodes
      .filter((n) => n.selected)
      .map((n) => n.id);
    const nextSelectedEdgeId =
      next.edges.find((e) => e.selected)?.id ?? null;

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

  groupSelectedNodes: (options?: { asFrame?: boolean; label?: string }): string | null => {
    const { nodes, edges, selectedNodeIds, historyPast } = get();

    // 筛选被选中的节点集合
    const selectedSet = new Set(selectedNodeIds);
    const targetNodes = nodes.filter((n) => selectedSet.has(n.id) || n.selected);

    if (targetNodes.length < 2) {
      return null;
    }

    // 计算世界绝对坐标与外接包围盒
    const nodeMap = new Map<string, FlowNode>(nodes.map((n) => [n.id, n]));
    const getAbsolutePos = (node: FlowNode): { x: number; y: number } => {
      if (node.parentId && nodeMap.has(node.parentId)) {
        const parent = nodeMap.get(node.parentId)!;
        const parentPos = getAbsolutePos(parent);
        return toWorldPosition(node.position, parentPos);
      }
      return { ...node.position };
    };

    const worldNodes: FlowNode[] = targetNodes.map((n) => ({
      ...n,
      position: getAbsolutePos(n),
    }));

    const bbox = computeBoundingBox(worldNodes, 20);
    const groupId = generateUniqueId('group');
    const isFrame = options?.asFrame ?? false;
    const label = options?.label ?? (isFrame ? '容器框' : '组合');

    const groupNode: FlowNode = {
      id: groupId,
      type: 'group',
      position: { x: bbox.x, y: bbox.y },
      width: bbox.width,
      height: bbox.height,
      style: {
        width: bbox.width,
        height: bbox.height,
      },
      data: {
        label,
        type: 'group',
        isFrame,
      },
      selected: true,
    };

    const targetIdSet = new Set(targetNodes.map((n) => n.id));

    // 子节点转为相对于 group 的局部坐标，并配置 extent: 'parent'
    const updatedNodes = nodes.map((n) => {
      if (targetIdSet.has(n.id)) {
        const absPos = getAbsolutePos(n);
        const localPos = toLocalPosition(absPos, groupNode.position);
        return {
          ...n,
          parentId: groupId,
          extent: 'parent' as const,
          position: localPos,
          selected: false,
          data: {
            ...n.data,
            parentId: groupId,
          },
        };
      }
      return {
        ...n,
        selected: false,
      };
    });

    // 在 React Flow 中，父容器节点在节点数组中必须位于其子节点之前
    const firstTargetIndex = updatedNodes.findIndex((n) => targetIdSet.has(n.id));
    const insertIndex = firstTargetIndex >= 0 ? firstTargetIndex : 0;
    const nextNodes = [
      ...updatedNodes.slice(0, insertIndex),
      groupNode,
      ...updatedNodes.slice(insertIndex),
    ];

    const historyUpdate = pushHistorySnapshot(historyPast, nodes, edges);

    set({
      nodes: nextNodes,
      selectedNodeIds: [groupId],
      selectedEdgeId: null,
      ...historyUpdate,
    });

    return groupId;
  },

  ungroupNodes: (groupIds?: string[]) => {
    const { nodes, edges, selectedNodeIds, historyPast } = get();

    // 确定目标 group 节点 ID 列表
    let targetGroupIds: string[] = [];
    if (groupIds && groupIds.length > 0) {
      targetGroupIds = groupIds;
    } else {
      const selectedSet = new Set(selectedNodeIds);
      targetGroupIds = nodes
        .filter((n) => (selectedSet.has(n.id) || n.selected) && n.type === 'group')
        .map((n) => n.id);
    }

    if (targetGroupIds.length === 0) {
      return;
    }

    const groupSet = new Set(targetGroupIds);
    const groupMap = new Map<string, FlowNode>();
    for (const n of nodes) {
      if (groupSet.has(n.id)) {
        groupMap.set(n.id, n);
      }
    }

    const childIds: string[] = [];
    const nextNodes: FlowNode[] = [];

    for (const n of nodes) {
      if (groupSet.has(n.id)) {
        // 销毁 Group 节点本身
        continue;
      }

      if (n.parentId && groupSet.has(n.parentId)) {
        const parentGroup = groupMap.get(n.parentId)!;
        const worldPos = toWorldPosition(n.position, parentGroup.position);
        childIds.push(n.id);
        const { parentId, extent, ...rest } = n;
        nextNodes.push({
          ...rest,
          position: worldPos,
          selected: true,
          data: {
            ...n.data,
            parentId: undefined,
          },
        });
      } else {
        nextNodes.push(n);
      }
    }

    const historyUpdate = pushHistorySnapshot(historyPast, nodes, edges);

    set({
      nodes: nextNodes,
      selectedNodeIds: childIds,
      selectedEdgeId: null,
      ...historyUpdate,
    });
  },

  alignSelectedNodes: (alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    const { nodes, edges, selectedNodeIds, historyPast } = get();
    const selectedSet = new Set(selectedNodeIds);
    const targetNodes = nodes.filter((n) => selectedSet.has(n.id) || n.selected);

    if (targetNodes.length < 2) {
      return;
    }

    const historyUpdate = pushHistorySnapshot(historyPast, nodes, edges);

    // 计算对齐基准线
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const node of targetNodes) {
      const { width, height } = getNodeDimensions(node);
      minX = Math.min(minX, node.position.x);
      maxX = Math.max(maxX, node.position.x + width);
      minY = Math.min(minY, node.position.y);
      maxY = Math.max(maxY, node.position.y + height);
    }

    const nextNodes = nodes.map((node) => {
      if (!selectedSet.has(node.id) && !node.selected) {
        return node;
      }
      const { width, height } = getNodeDimensions(node);
      let nextX = node.position.x;
      let nextY = node.position.y;

      switch (alignment) {
        case 'left':
          nextX = minX;
          break;
        case 'center':
          nextX = Math.round((minX + maxX) / 2 - width / 2);
          break;
        case 'right':
          nextX = maxX - width;
          break;
        case 'top':
          nextY = minY;
          break;
        case 'middle':
          nextY = Math.round((minY + maxY) / 2 - height / 2);
          break;
        case 'bottom':
          nextY = maxY - height;
          break;
      }

      return {
        ...node,
        position: { x: nextX, y: nextY },
      };
    });

    set({
      nodes: nextNodes,
      ...historyUpdate,
    });
  },

  distributeSelectedNodes: (axis: 'horizontal' | 'vertical') => {
    const { nodes, edges, selectedNodeIds, historyPast } = get();
    const selectedSet = new Set(selectedNodeIds);
    const targetNodes = nodes.filter((n) => selectedSet.has(n.id) || n.selected);

    if (targetNodes.length < 3) {
      return;
    }

    const historyUpdate = pushHistorySnapshot(historyPast, nodes, edges);

    if (axis === 'horizontal') {
      const sorted = [...targetNodes].sort((a, b) => a.position.x - b.position.x);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const totalSpan = last.position.x - first.position.x;
      const step = totalSpan / (sorted.length - 1);

      const posMap = new Map<string, number>();
      sorted.forEach((node, index) => {
        posMap.set(node.id, Math.round(first.position.x + index * step));
      });

      const nextNodes = nodes.map((node) => {
        if (posMap.has(node.id)) {
          return {
            ...node,
            position: { ...node.position, x: posMap.get(node.id)! },
          };
        }
        return node;
      });

      set({ nodes: nextNodes, ...historyUpdate });
    } else {
      const sorted = [...targetNodes].sort((a, b) => a.position.y - b.position.y);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const totalSpan = last.position.y - first.position.y;
      const step = totalSpan / (sorted.length - 1);

      const posMap = new Map<string, number>();
      sorted.forEach((node, index) => {
        posMap.set(node.id, Math.round(first.position.y + index * step));
      });

      const nextNodes = nodes.map((node) => {
        if (posMap.has(node.id)) {
          return {
            ...node,
            position: { ...node.position, y: posMap.get(node.id)! },
          };
        }
        return node;
      });

      set({ nodes: nextNodes, ...historyUpdate });
    }
  },

  setDiagram: (nodes: FlowNode[], edges: FlowEdge[]) => {
    const snapshot = cloneSnapshot(nodes, edges);
    const cleanNodes = snapshot.nodes.map((n) => ({
      ...n,
      selected: false,
      dragging: false,
    }));
    const cleanEdges = snapshot.edges.map((e) => ({
      ...e,
      selected: false,
    }));

    set({
      nodes: cleanNodes,
      edges: cleanEdges,
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

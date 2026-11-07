/**
 * @fileoverview FlowStudio 全局流程图状态管理 (Zustand Store)
 * @description 管理节点、连线、工具模式、选择态以及快照撤销/重做历史，并与 YjsDiagramBridge 实现无缝 CRDT 协同绑定
 */

import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  MarkerType,
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
import type { YjsDiagramBridge } from '../features/collaboration/yjs-doc-bridge';
import type { CollaborativeUndoManager } from '../features/collaboration/undo-manager';

/**
 * 画布操作工具模式枚举
 */
export type ActiveTool = 'select' | 'pan' | 'connect';

/**
 * 历史快照单元（用于单机撤销/重做）
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
  /** 当前流程图标题 */
  diagramTitle: string;
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
  /** 节点状态变更处理器 */
  onNodesChange: (changes: NodeChange[]) => void;
  /** 连线状态变更处理器 */
  onEdgesChange: (changes: EdgeChange[]) => void;
  /** 节点连线建立处理器 */
  onConnect: (connection: Connection) => void;
  /** 添加指定类型的节点 */
  addNode: (type: FlowNodeType, position: { x: number; y: number }) => FlowNode;
  /** 批量添加节点至画布 */
  addNodes: (newNodes: FlowNode[]) => void;
  /** 删除所有选中的节点及其相连的连线 */
  deleteSelected: () => void;
  /** 更新指定节点的业务数据 */
  updateNodeData: (id: string, data: Partial<FlowNodeData>) => void;
  /** 更新指定节点的宽高尺寸 (px) */
  updateNodeDimensions: (id: string, width: number, height: number) => void;
  /** 批量更新多个节点的业务数据 */
  batchUpdateNodeData: (updates: Array<{ id: string; data: Partial<FlowNodeData> }>) => void;
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
  /** 全量替换图表数据 */
  setDiagram: (nodes: FlowNode[], edges: FlowEdge[]) => void;
  /** 设置当前图表标题 */
  setDiagramTitle: (title: string) => void;
  /** 绑定 Yjs 协同桥接与协同撤销管理器 */
  bindCollaboration: (bridge: YjsDiagramBridge, undoManager: CollaborativeUndoManager) => () => void;
  /** 解除 Yjs 协同绑定 */
  unbindCollaboration: () => void;
}

export type FlowStore = FlowStoreInternalState & FlowStoreActions;

/** 历史快照最大存储上限 */
const MAX_HISTORY_LENGTH = 50;

let activeBridge: YjsDiagramBridge | null = null;
let activeUndoManager: CollaborativeUndoManager | null = null;
let unsubscribeBridge: (() => void) | null = null;
let unsubscribeUndoManager: (() => void) | null = null;

function commitGraph(nodes: FlowNode[], edges: FlowEdge[]) {
  if (activeBridge) {
    activeBridge.setDiagram(nodes, edges);
    activeUndoManager?.stopCapturing();
  }
}

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

export const useFlowStore = create<FlowStore>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeIds: [],
  selectedEdgeId: null,
  activeTool: 'select',
  canUndo: false,
  canRedo: false,
  diagramTitle: '未命名流程图',
  historyPast: [],
  historyFuture: [],
  isInteracting: false,

  onNodesChange: (changes: NodeChange[]) => {
    if (changes.length === 0) return;

    const { nodes, edges, historyPast, isInteracting } = get();

    const isSelectionOnly =
      changes.length > 0 && changes.every((c) => c.type === 'select');

    let nextInteracting = isInteracting;
    let shouldPushHistory = false;

    const isDraggingOnly =
      changes.length > 0 &&
      changes.every(
        (c) =>
          c.type === 'position' && (c as unknown as { dragging?: boolean }).dragging === true
      );

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

    if (!isSelectionOnly) {
      if (hasDragStart) {
        if (!isInteracting) {
          shouldPushHistory = true;
          nextInteracting = true;
        }
      } else if (hasDragEnd) {
        nextInteracting = false;
      } else if (!isInteracting) {
        shouldPushHistory = true;
      }
    }

    const historyUpdate = shouldPushHistory
      ? pushHistorySnapshot(historyPast, nodes, edges)
      : {};

    const nextNodes = applyNodeChanges(changes as any, nodes) as FlowNode[];

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

    if (!isDraggingOnly && !isSelectionOnly) {
      commitGraph(nextNodes, nextEdges);
    } else if (hasDragEnd) {
      commitGraph(nextNodes, nextEdges);
    }
  },

  onEdgesChange: (changes: EdgeChange[]) => {
    if (changes.length === 0) return;

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

    if (!isSelectionOnly) {
      commitGraph(nodes, nextEdges);
    }
  },

  onConnect: (connection: Connection) => {
    if (!connection.source || !connection.target) return;

    const { nodes, edges, historyPast } = get();

    const newEdge: FlowEdge = {
      id: generateEdgeId(connection.source, connection.target),
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle ?? undefined,
      targetHandle: connection.targetHandle ?? undefined,
      type: 'orthogonal',
      markerEnd: { type: MarkerType.ArrowClosed },
      animated: false,
    };

    const nextEdges = addEdge(newEdge as any, edges) as FlowEdge[];
    if (nextEdges.length === edges.length) return;

    const historyUpdate = pushHistorySnapshot(historyPast, nodes, edges);

    set({
      edges: nextEdges,
      ...historyUpdate,
    });

    commitGraph(nodes, nextEdges);
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

    commitGraph(nextNodes, edges);
    return newNode;
  },

  addNodes: (newNodes: FlowNode[]) => {
    const { nodes, edges, historyPast } = get();
    if (newNodes.length === 0) return;

    const historyUpdate = pushHistorySnapshot(historyPast, nodes, edges);
    const newIds = newNodes.map((n) => n.id);

    const nextNodes = [
      ...nodes.map((n) => ({ ...n, selected: false })),
      ...newNodes.map((n) => ({ ...n, selected: true })),
    ];

    set({
      nodes: nextNodes,
      selectedNodeIds: newIds,
      selectedEdgeId: null,
      ...historyUpdate,
    });

    commitGraph(nextNodes, edges);
  },

  deleteSelected: () => {
    const { nodes, edges, selectedNodeIds, selectedEdgeId, historyPast } = get();

    const nodeIdsToDelete = new Set(selectedNodeIds);
    for (const n of nodes) {
      if (n.selected) {
        nodeIdsToDelete.add(n.id);
      }
    }

    let hasNewCascades = true;
    while (hasNewCascades) {
      hasNewCascades = false;
      for (const n of nodes) {
        if (n.parentId && nodeIdsToDelete.has(n.parentId) && !nodeIdsToDelete.has(n.id)) {
          nodeIdsToDelete.add(n.id);
          hasNewCascades = true;
        }
      }
    }

    const edgeIdsToDelete = new Set<string>();
    if (selectedEdgeId) {
      edgeIdsToDelete.add(selectedEdgeId);
    }
    for (const e of edges) {
      if (e.selected || nodeIdsToDelete.has(e.source) || nodeIdsToDelete.has(e.target)) {
        edgeIdsToDelete.add(e.id);
      }
    }

    if (nodeIdsToDelete.size === 0 && edgeIdsToDelete.size === 0) return;

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

    commitGraph(nextNodes, nextEdges);
  },

  updateNodeData: (id: string, data: Partial<FlowNodeData>) => {
    const { nodes, edges, historyPast } = get();
    const targetNode = nodes.find((n) => n.id === id);
    if (!targetNode) return;

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

    commitGraph(nextNodes, edges);
  },

  updateNodeDimensions: (id: string, width: number, height: number) => {
    const { nodes, edges, historyPast } = get();
    const targetNode = nodes.find((n) => n.id === id);
    if (!targetNode) return;

    const historyUpdate = pushHistorySnapshot(historyPast, nodes, edges);

    const nextNodes = nodes.map((n) => {
      if (n.id === id) {
        return {
          ...n,
          width,
          height,
          style: {
            ...n.style,
            width,
            height,
          },
        };
      }
      return n;
    });

    set({
      nodes: nextNodes,
      ...historyUpdate,
    });

    commitGraph(nextNodes, edges);
  },

  batchUpdateNodeData: (updates: Array<{ id: string; data: Partial<FlowNodeData> }>) => {
    const { nodes, edges, historyPast } = get();
    if (updates.length === 0) return;

    const historyUpdate = pushHistorySnapshot(historyPast, nodes, edges);
    const updateMap = new Map(updates.map((u) => [u.id, u.data]));

    const nextNodes = nodes.map((n) => {
      if (updateMap.has(n.id)) {
        const patch = updateMap.get(n.id)!;
        return {
          ...n,
          data: {
            ...n.data,
            ...patch,
            style: {
              ...n.data.style,
              ...patch.style,
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

    commitGraph(nextNodes, edges);
  },

  updateEdgeData: (id: string, data: Partial<FlowEdgeData>) => {
    const { nodes, edges, historyPast } = get();
    const targetEdge = edges.find((e) => e.id === id);
    if (!targetEdge) return;

    const historyUpdate = pushHistorySnapshot(historyPast, nodes, edges);

    const nextEdges = edges.map((e) => {
      if (e.id === id) {
        const nextAnimated =
          data.style?.animated !== undefined ? data.style.animated : e.animated;
        const nextLabel = data.label !== undefined ? data.label : e.label;
        return {
          ...e,
          label: nextLabel,
          animated: nextAnimated,
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

    commitGraph(nodes, nextEdges);
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
    if (activeUndoManager) {
      activeUndoManager.undo();
      return;
    }

    const { historyPast, historyFuture, nodes, edges } = get();
    if (historyPast.length === 0) return;

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
    if (activeUndoManager) {
      activeUndoManager.redo();
      return;
    }

    const { historyPast, historyFuture, nodes, edges } = get();
    if (historyFuture.length === 0) return;

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

    const selectedSet = new Set(selectedNodeIds);
    const targetNodes = nodes.filter((n) => selectedSet.has(n.id) || n.selected);
    if (targetNodes.length < 2) return null;

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

    commitGraph(nextNodes, edges);
    return groupId;
  },

  ungroupNodes: (groupIds?: string[]) => {
    const { nodes, edges, selectedNodeIds, historyPast } = get();

    let targetGroupIds: string[] = [];
    if (groupIds && groupIds.length > 0) {
      targetGroupIds = groupIds;
    } else {
      targetGroupIds = nodes
        .filter((n) => n.type === 'group' && (selectedNodeIds.includes(n.id) || n.selected))
        .map((n) => n.id);
    }

    if (targetGroupIds.length === 0) return;

    const groupSet = new Set(targetGroupIds);
    const groupMap = new Map<string, FlowNode>();
    for (const n of nodes) {
      if (groupSet.has(n.id)) {
        groupMap.set(n.id, n);
      }
    }

    const nextNodes: FlowNode[] = [];
    const unGroupedChildIds: string[] = [];

    for (const n of nodes) {
      if (groupSet.has(n.id)) continue;

      if (n.parentId && groupSet.has(n.parentId)) {
        const parentGroup = groupMap.get(n.parentId);
        const parentPos = parentGroup ? parentGroup.position : { x: 0, y: 0 };
        const absPos = toWorldPosition(n.position, parentPos);

        const { parentId, extent, ...restData } = n.data;

        nextNodes.push({
          ...n,
          position: absPos,
          parentId: undefined,
          extent: undefined,
          selected: true,
          data: {
            ...restData,
          },
        });
        unGroupedChildIds.push(n.id);
      } else {
        nextNodes.push(n);
      }
    }

    const historyUpdate = pushHistorySnapshot(historyPast, nodes, edges);

    set({
      nodes: nextNodes,
      selectedNodeIds: unGroupedChildIds,
      selectedEdgeId: null,
      ...historyUpdate,
    });

    commitGraph(nextNodes, edges);
  },

  alignSelectedNodes: (alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    const { nodes, edges, selectedNodeIds, historyPast } = get();
    const selectedSet = new Set(selectedNodeIds);
    const targetNodes = nodes.filter((n) => selectedSet.has(n.id) || n.selected);

    if (targetNodes.length < 2) return;

    const historyUpdate = pushHistorySnapshot(historyPast, nodes, edges);
    let targetValue = 0;

    switch (alignment) {
      case 'left':
        targetValue = Math.min(...targetNodes.map((n) => n.position.x));
        break;
      case 'center': {
        const centers = targetNodes.map(
          (n) => n.position.x + getNodeDimensions(n).width / 2
        );
        targetValue = centers.reduce((a, b) => a + b, 0) / centers.length;
        break;
      }
      case 'right':
        targetValue = Math.max(
          ...targetNodes.map((n) => n.position.x + getNodeDimensions(n).width)
        );
        break;
      case 'top':
        targetValue = Math.min(...targetNodes.map((n) => n.position.y));
        break;
      case 'middle': {
        const middles = targetNodes.map(
          (n) => n.position.y + getNodeDimensions(n).height / 2
        );
        targetValue = middles.reduce((a, b) => a + b, 0) / middles.length;
        break;
      }
      case 'bottom':
        targetValue = Math.max(
          ...targetNodes.map((n) => n.position.y + getNodeDimensions(n).height)
        );
        break;
    }

    const targetIdSet = new Set(targetNodes.map((n) => n.id));
    const nextNodes = nodes.map((node) => {
      if (!targetIdSet.has(node.id)) return node;

      const dim = getNodeDimensions(node);
      const nextPos = { ...node.position };

      switch (alignment) {
        case 'left':
          nextPos.x = targetValue;
          break;
        case 'center':
          nextPos.x = Math.round(targetValue - dim.width / 2);
          break;
        case 'right':
          nextPos.x = Math.round(targetValue - dim.width);
          break;
        case 'top':
          nextPos.y = targetValue;
          break;
        case 'middle':
          nextPos.y = Math.round(targetValue - dim.height / 2);
          break;
        case 'bottom':
          nextPos.y = Math.round(targetValue - dim.height);
          break;
      }

      return { ...node, position: nextPos };
    });

    set({ nodes: nextNodes, ...historyUpdate });
    commitGraph(nextNodes, edges);
  },

  distributeSelectedNodes: (axis: 'horizontal' | 'vertical') => {
    const { nodes, edges, selectedNodeIds, historyPast } = get();
    const selectedSet = new Set(selectedNodeIds);
    const targetNodes = nodes.filter((n) => selectedSet.has(n.id) || n.selected);

    if (targetNodes.length < 3) return;

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
      commitGraph(nextNodes, edges);
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
      commitGraph(nextNodes, edges);
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

    commitGraph(cleanNodes, cleanEdges);
  },

  setDiagramTitle: (title: string) => {
    const trimmed = title.trim();
    set({ diagramTitle: trimmed });
    if (activeBridge) {
      activeBridge.setTitle(trimmed);
    }
  },

  bindCollaboration: (bridge: YjsDiagramBridge, undoManager: CollaborativeUndoManager) => {
    activeBridge = bridge;
    activeUndoManager = undoManager;

    const bridgeState = bridge.toReactFlowState();
    if (bridgeState.nodes.length > 0 || bridgeState.edges.length > 0) {
      set({
        nodes: bridgeState.nodes,
        edges: bridgeState.edges,
        diagramTitle: bridgeState.title,
      });
    } else {
      const { nodes, edges, diagramTitle } = get();
      if (nodes.length > 0 || edges.length > 0) {
        bridge.setDiagram(nodes, edges);
      }
      if (diagramTitle) {
        bridge.setTitle(diagramTitle);
      }
    }

    if (unsubscribeBridge) unsubscribeBridge();
    unsubscribeBridge = bridge.subscribe((state) => {
      const currentSelectedNodeIds = get().selectedNodeIds;
      const currentSelectedEdgeId = get().selectedEdgeId;
      const mergedNodes = state.nodes.map((n) => ({
        ...n,
        selected: currentSelectedNodeIds.includes(n.id),
      }));
      const mergedEdges = state.edges.map((e) => ({
        ...e,
        selected: e.id === currentSelectedEdgeId,
      }));
      set({
        nodes: mergedNodes,
        edges: mergedEdges,
        diagramTitle: state.title,
      });
    });

    if (unsubscribeUndoManager) unsubscribeUndoManager();
    unsubscribeUndoManager = undoManager.subscribe((status) => {
      set({
        canUndo: status.canUndo,
        canRedo: status.canRedo,
      });
    });

    return () => {
      get().unbindCollaboration();
    };
  },

  unbindCollaboration: () => {
    if (unsubscribeBridge) {
      unsubscribeBridge();
      unsubscribeBridge = null;
    }
    if (unsubscribeUndoManager) {
      unsubscribeUndoManager();
      unsubscribeUndoManager = null;
    }
    activeBridge = null;
    activeUndoManager = null;
  },
}));

export const flowStore = useFlowStore;

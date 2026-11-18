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
  XYPosition,
  MermaidBridgeOp,
} from '@flowstudio/shared';
import { DEFAULT_EDGE_TYPE } from '@flowstudio/shared';
import { createNodeFromType, generateEdgeId, generateUniqueId, type CreateNodeOptions } from '../lib/node-utils';
import {
  computeBoundingBox,
  toLocalPosition,
  toWorldPosition,
  getNodeDimensions,
} from '../features/canvas/utils/group-calculator';
import {
  computeDragAlignment,
  resolveSnapThreshold,
  type AlignGuide,
} from '../features/canvas/utils/alignment-snap';
import type { YjsDiagramBridge } from '../features/collaboration/yjs-doc-bridge';
import type { CollaborativeUndoManager } from '../features/collaboration/undo-manager';
import { isNodeLocked } from '../features/canvas/utils/node-lock-manager';

/**
 * 画布操作工具模式枚举
 */
export type ActiveTool = 'select' | 'pan' | 'connect';
export type EdgeConnectMode = 'orthogonal' | 'straight';

/**
 * 历史快照单元（用于单机撤销/重做）
 */
export interface DiagramSnapshot {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface IncrementalGraphDelta {
  putNodes?: FlowNode[];
  removeNodeIds?: string[];
  putEdges?: FlowEdge[];
  removeEdgeIds?: string[];
  selectNodeIds?: string[];
  clearSelection?: boolean;
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
  edgeConnectMode: EdgeConnectMode;
  isShiftPressed: boolean;
  isSpacePanning: boolean;
  editingEdgeLabelId: string | null;
  selectedEdgeLabelId: string | null;
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
  /** 拖拽中命中的智能对齐参考线 (仅本地瞬态，不写入协同文档) */
  alignmentGuides: AlignGuide[];
  /** 当前视口缩放比例，用于换算对齐感应半径 */
  viewportZoom: number;
  /** 智能对齐吸附开关 (按住 Alt 临时关闭) */
  alignmentSnapEnabled: boolean;
  /** 因果链路聚光灯走查是否激活 */
  spotlightActive: boolean;
  /** 聚光灯聚焦的目标节点或连线 ID */
  spotlightTargetId: string | null;
  /** 决策节点分支过滤 ('all' | 'yes' | 'no' | string | null) */
  spotlightBranchFilter: string | null;
  /** 当前正在跟随视角的协作者 ID */
  followingUserId: string | null;
  /** AI 批次画布级 Visual Diff 逐项审阅是否激活 */
  aiReviewActive: boolean;
  /** 当前正在审阅的 AI 批次 ID */
  aiReviewBatchId: string | null;
  /** AI 批次审阅中已被确认保留（豁免整批撤回）的实体 ID 集合 (FS-028) */
  aiAcceptedEntityIds: Set<string>;
  /** 已被用户关闭提示的 AI 批次 ID 集合 (FS-029，防止 remount 后反复弹窗) */
  dismissedAiBatchIds: Set<string>;
  /** Mermaid 代码抽屉是否展开 */
  mermaidDrawerOpen: boolean;
  copilotOpen: boolean;
  /** 全局浮动轻提示消息 */
  toastMessage: string | null;
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
  /** 已有连线端点重连处理器 */
  reconnectEdge: (oldEdge: FlowEdge, newConnection: Connection) => void;
  /** 添加指定类型的节点 */
  addNode: (type: FlowNodeType, position: { x: number; y: number }, options?: CreateNodeOptions) => FlowNode;
  /** 批量添加节点至画布 */
  addNodes: (newNodes: FlowNode[]) => void;
  /** 删除所有选中的节点及其相连的连线 */
  deleteSelected: () => void;
  /** 更新指定节点的业务数据 */
  updateNodeData: (id: string, data: Partial<FlowNodeData>) => void;
  /** 更新指定节点的宽高尺寸 (px) */
  updateNodeDimensions: (id: string, width: number, height: number) => void;
  /** 开始中心锚定缩放：记录当前中心，后续尺寸变化时两侧等量扩展 */
  startCenteredResize: (id: string) => void;
  /** 结束中心锚定缩放并落库 */
  finishCenteredResize: (id: string) => void;
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
  setEdgeConnectMode: (mode: EdgeConnectMode) => void;
  toggleEdgeConnectMode: () => void;
  setShiftPressed: (pressed: boolean) => void;
  setSpacePanning: (panning: boolean) => void;
  setEditingEdgeLabelId: (id: string | null) => void;
  setSelectedEdgeLabelId: (id: string | null) => void;
  deleteEdgeLabel: (id: string) => void;
  /** 记录视口缩放比例，供拖拽对齐感应半径换算 */
  setViewportZoom: (zoom: number) => void;
  /** 临时启停拖拽智能对齐吸附 */
  setAlignmentSnapEnabled: (enabled: boolean) => void;
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
  /** 批量追加子图（节点与连线）至画布 */
  appendSubgraph: (newNodes: FlowNode[], newEdges: FlowEdge[]) => void;
  /** 局部增量更新图元（仅提交变更节点与连线至协同文档） */
  applyIncrementalUpdate: (delta: IncrementalGraphDelta) => void;
  /** 全量替换图表数据 */
  setDiagram: (nodes: FlowNode[], edges: FlowEdge[]) => void;
  /** 设置当前图表标题 */
  setDiagramTitle: (title: string) => void;
  /** 重置画布图表状态（用于切换图表或离开画布时的状态清理，杜绝跨图残留） */
  resetDiagramState: () => void;
  /** 切换因果链路聚光灯走查模式 */
  toggleSpotlightMode: (enabled?: boolean) => void;
  /** 设置聚光灯聚焦目标与分支过滤 */
  setSpotlightTarget: (targetId: string | null, branchFilter?: string | null) => void;
  /** 设置跟随协作者视角 */
  setFollowingUser: (userId: string | null) => void;
  /** 循环切换选中节点的锁定模式 (none -> position -> full -> none) */
  toggleSelectedLockMode: () => void;
  /** 启停 AI 批次 Visual Diff 审阅台 */
  setAiReviewMode: (active: boolean, batchId?: string | null) => void;
  /** 标记保留指定 AI 实体，使其免受整批撤回影响 (FS-028) */
  acceptAiEntity: (entityId: string) => void;
  /** 清理已采纳的 AI 实体记录 (FS-028) */
  clearAiAcceptedEntities: () => void;
  /** 关闭并忽略指定 AI 批次横幅提示 (FS-029) */
  dismissAiBatch: (batchId: string) => void;
  /** 开关 Mermaid 代码抽屉 */
  setMermaidDrawerOpen: (open: boolean) => void;
  setCopilotOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  /** 应用 Mermaid 增量融合产生的操作集合 */
  applyMermaidOps: (ops: MermaidBridgeOp[]) => { addedNodes: number; addedEdges: number };
  /** 弹出全局轻提示 Toast */
  showToast: (message: string, duration?: number) => void;
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
let toastTimer: any = null;

/**
 * 正在做中心锚定缩放的节点 → 缩放开始时的中心点。
 * React Flow 的 resizer 只会锚定对角，这里按尺寸反算位置，实现"左右同步、上下同步"
 */
const centeredResizes = new Map<string, { x: number; y: number }>();

function commitBridgeDelta(fn: (bridge: YjsDiagramBridge) => void) {
  if (activeBridge) {
    activeBridge.transact(() => {
      fn(activeBridge!);
    });
    activeUndoManager?.stopCapturing();
  }
}

function sortNodesByDepth(nodes: FlowNode[]): FlowNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depthCache = new Map<string, number>();

  const getDepth = (node: FlowNode): number => {
    const cached = depthCache.get(node.id);
    if (cached !== undefined) return cached;

    let depth = 0;
    const visited = new Set<string>([node.id]);
    let curr: FlowNode | undefined = node;
    while (curr?.parentId && !visited.has(curr.parentId)) {
      visited.add(curr.parentId);
      const parent = byId.get(curr.parentId);
      if (!parent) break;
      depth++;
      curr = parent;
    }
    depthCache.set(node.id, depth);
    return depth;
  };

  return [...nodes].sort((a, b) => getDepth(a) - getDepth(b));
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

/**
 * 读取 position change 中的落点与拖拽标记：React Flow 的类型把二者分散在子类型里，
 * 这里收敛为一个结构，供智能对齐吸附复用
 */
function readPositionChange(
  change: NodeChange
): { id: string; position: XYPosition; dragging: boolean } | null {
  if (change.type !== 'position') return null;

  const raw = change as unknown as { position?: XYPosition; dragging?: boolean };
  if (!raw.position || typeof raw.dragging !== 'boolean') return null;

  return { id: change.id, position: raw.position, dragging: raw.dragging };
}

export const useFlowStore = create<FlowStore>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeIds: [],
  selectedEdgeId: null,
  activeTool: 'select',
  edgeConnectMode: 'orthogonal',
  isShiftPressed: false,
  isSpacePanning: false,
  editingEdgeLabelId: null,
  selectedEdgeLabelId: null,
  canUndo: false,
  canRedo: false,
  diagramTitle: '未命名流程图',
  historyPast: [],
  historyFuture: [],
  isInteracting: false,
  alignmentGuides: [],
  viewportZoom: 1,
  alignmentSnapEnabled: true,
  spotlightActive: false,
  spotlightTargetId: null,
  spotlightBranchFilter: null,
  followingUserId: null,
  aiReviewActive: false,
  aiReviewBatchId: null,
  aiAcceptedEntityIds: new Set<string>(),
  dismissedAiBatchIds: new Set<string>(),
  mermaidDrawerOpen: false,
  copilotOpen: false,
  toastMessage: null,

  onNodesChange: (changes: NodeChange[]) => {
    if (changes.length === 0) return;

    const {
      nodes,
      edges,
      historyPast,
      isInteracting,
      alignmentGuides,
      viewportZoom,
      alignmentSnapEnabled,
    } = get();

    // 锚定锁守卫：过滤掉被锁定节点自身以及包含锁定子节点的容器的 position 变更 (B3)
    const lockedNodeIds = new Set(nodes.filter((n) => isNodeLocked(n, 'position')).map((n) => n.id));
    const lockedContainers = new Set<string>();
    for (const n of nodes) {
      if (n.parentId && lockedNodeIds.has(n.id)) {
        let curr: string | undefined = n.parentId;
        while (curr) {
          lockedContainers.add(curr);
          const pNode = nodes.find((x) => x.id === curr);
          curr = pNode?.parentId;
        }
      }
    }

    const safeChanges = changes.filter((c) => {
      if (c.type === 'position' || c.type === 'dimensions') {
        if (lockedNodeIds.has(c.id) || lockedContainers.has(c.id)) {
          return false;
        }
      }
      return true;
    });

    if (safeChanges.length === 0) return;

    const isSelectionOnly =
      safeChanges.length > 0 && safeChanges.every((c) => c.type === 'select');

    // React Flow 对节点 DOM 尺寸的纯测量上报，只应在本地生效，见下方提交守卫
    const isMeasureOnly = safeChanges.every(
      (c) =>
        c.type === 'select' ||
        (c.type === 'dimensions' &&
          (c as unknown as { dimensions?: unknown }).dimensions !== undefined &&
          (c as unknown as { setAttributes?: unknown }).setAttributes === undefined &&
          (c as unknown as { resizing?: unknown }).resizing === undefined)
    );

    let nextInteracting = isInteracting;
    let shouldPushHistory = false;

    const isDraggingOnly =
      safeChanges.length > 0 &&
      safeChanges.every(
        (c) =>
          c.type === 'select' ||
          (c.type === 'position' && (c as unknown as { dragging?: boolean }).dragging === true)
      ) &&
      safeChanges.some(
        (c) => c.type === 'position' && (c as unknown as { dragging?: boolean }).dragging === true
      );

    const hasDragStart = safeChanges.some(
      (c) =>
        (c.type === 'position' && (c as unknown as { dragging?: boolean }).dragging === true) ||
        (c.type === 'dimensions' && (c as unknown as { resizing?: boolean }).resizing === true)
    );
    const hasDragEnd = safeChanges.some(
      (c) =>
        (c.type === 'position' && (c as unknown as { dragging?: boolean }).dragging === false) ||
        (c.type === 'dimensions' && (c as unknown as { resizing?: boolean }).resizing === false)
    );

    if (!isSelectionOnly && !isMeasureOnly) {
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

    /**
     * 拖拽落点改写：拖动过程中与松手帧都叠加智能对齐偏移，否则松手帧会带回未吸附的
     * 原始指针位置，节点在释放瞬间从对齐线上弹开。React Flow 每帧从指针重算落点、
     * 不回读节点当前位置，因此这里的改写不会自我放大
     */
    let effectiveChanges: NodeChange[] = safeChanges;
    let nextGuides: AlignGuide[] = [];

    const proposedPositions = new Map<string, XYPosition>();
    for (const change of safeChanges) {
      const parsed = readPositionChange(change);
      if (parsed) proposedPositions.set(parsed.id, parsed.position);
    }

    if (proposedPositions.size > 0 && alignmentSnapEnabled) {
      const snapped = computeDragAlignment(
        nodes,
        proposedPositions,
        resolveSnapThreshold(viewportZoom)
      );

      if (snapped.guides.length > 0) {
        // 松手帧只保留落点修正，参考线随之撤除
        nextGuides = hasDragEnd ? [] : snapped.guides;
        effectiveChanges = effectiveChanges.map((change) => {
          const parsed = readPositionChange(change);
          if (!parsed) return change;
          const position = snapped.positions.get(parsed.id);
          return position ? ({ ...change, position } as NodeChange) : change;
        });
      }
    }

    let nextNodes = applyNodeChanges(effectiveChanges as any, nodes) as FlowNode[];

    // 中心锚定缩放：React Flow 的 resizer 只锚定对角，这里按新尺寸把位置回算为 center - size/2。
    // 刻意不做栅格吸附：吸附会让左右（上下）两侧位移不相等
    if (centeredResizes.size > 0) {
      nextNodes = nextNodes.map((n) => {
        const center = centeredResizes.get(n.id);
        if (!center) return n;

        const { width, height } = getNodeDimensions(n);
        return {
          ...n,
          position: { x: center.x - width / 2, y: center.y - height / 2 },
        };
      });
    }

    const hasRemove = safeChanges.some((c) => c.type === 'remove');
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

    const guidesChanged = nextGuides.length > 0 || alignmentGuides.length > 0;

    set({
      nodes: nextNodes,
      edges: nextEdges,
      selectedNodeIds: nextSelectedNodeIds,
      isInteracting: nextInteracting,
      ...(guidesChanged ? { alignmentGuides: nextGuides } : {}),
      ...historyUpdate,
    });

    /*
     * 纯测量变更若写入 Y.Doc，会触发桥回灌把 React Flow 的 handleBounds 清零，
     * 连线拖拽与边渲染随之失效，因此这里与选中态一样不提交
     */
    if ((!isDraggingOnly && !isSelectionOnly && !isMeasureOnly) || hasDragEnd) {
      const nextNodeMap = new Map(nextNodes.map((n) => [n.id, n]));
      const removedIds: string[] = [];
      const addedOrReplaced: FlowNode[] = [];
      const patches: Array<{ id: string; patch: Partial<FlowNode> }> = [];

      for (const change of safeChanges) {
        if (change.type === 'remove') {
          removedIds.push(change.id);
        } else if (change.type === 'add') {
          const n = nextNodeMap.get(change.item.id);
          if (n) addedOrReplaced.push(n);
        } else if (change.type === 'replace') {
          const n = nextNodeMap.get(change.id);
          if (n) addedOrReplaced.push(n);
        } else if (change.type === 'position') {
          const dragging = (change as unknown as { dragging?: boolean }).dragging;
          if (dragging !== true) {
            const n = nextNodeMap.get(change.id);
            if (n) patches.push({ id: n.id, patch: { position: n.position } });
          }
        } else if (change.type === 'dimensions') {
          const raw = change as unknown as {
            dimensions?: unknown;
            setAttributes?: unknown;
            resizing?: unknown;
          };
          const isPureMeasure =
            raw.dimensions !== undefined &&
            raw.setAttributes === undefined &&
            raw.resizing === undefined;
          if (!isPureMeasure) {
            const n = nextNodeMap.get(change.id);
            if (n) {
              patches.push({
                id: n.id,
                patch: {
                  width: n.width,
                  height: n.height,
                  style: n.style,
                  ...(centeredResizes.has(n.id) ? { position: n.position } : {}),
                },
              });
            }
          }
        }
      }

      if (removedIds.length > 0 || addedOrReplaced.length > 0 || patches.length > 0) {
        commitBridgeDelta((bridge) => {
          if (removedIds.length > 0) bridge.removeNodes(removedIds);
          if (addedOrReplaced.length > 0) bridge.putNodes(addedOrReplaced);
          if (patches.length > 0) bridge.patchNodes(patches);
        });
      }
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
      const nextEdgeMap = new Map(nextEdges.map((e) => [e.id, e]));
      const removedIds: string[] = [];
      const addedOrReplaced: FlowEdge[] = [];
      for (const change of changes) {
        if (change.type === 'remove') {
          removedIds.push(change.id);
        } else if (change.type === 'add') {
          const e = nextEdgeMap.get(change.item.id);
          if (e) addedOrReplaced.push(e);
        } else if (change.type === 'replace') {
          const e = nextEdgeMap.get(change.id);
          if (e) addedOrReplaced.push(e);
        }
      }
      if (removedIds.length > 0 || addedOrReplaced.length > 0) {
        commitBridgeDelta((bridge) => {
          if (removedIds.length > 0) bridge.removeEdges(removedIds);
          if (addedOrReplaced.length > 0) bridge.putEdges(addedOrReplaced);
        });
      }
    }
  },

  onConnect: (connection: Connection) => {
    if (!connection.source || !connection.target) return;

    const { nodes, edges, historyPast, edgeConnectMode, isShiftPressed } = get();
    const effectiveMode = isShiftPressed
      ? edgeConnectMode === 'orthogonal'
        ? 'straight'
        : 'orthogonal'
      : edgeConnectMode;

    const newEdge: FlowEdge = {
      id: generateEdgeId(connection.source, connection.target),
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle ?? undefined,
      targetHandle: connection.targetHandle ?? undefined,
      type: effectiveMode,
      ...(effectiveMode === 'straight' ? { data: { routingType: 'straight' } } : {}),
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

    const addedEdge = nextEdges.find((e) => e.id === newEdge.id) ?? newEdge;
    commitBridgeDelta((bridge) => {
      bridge.putEdges([addedEdge]);
    });
  },

  reconnectEdge: (oldEdge: FlowEdge, newConnection: Connection) => {
    if (!newConnection.source || !newConnection.target || newConnection.source === newConnection.target) {
      return;
    }
    const { nodes, edges, historyPast } = get();
    const historyUpdate = pushHistorySnapshot(historyPast, nodes, edges);

    const nextEdges = edges.map((e) => {
      if (e.id !== oldEdge.id) return e;
      const nextData = { ...(e.data || {}) };
      delete nextData.waypoints;
      return {
        ...e,
        source: newConnection.source!,
        target: newConnection.target!,
        sourceHandle: newConnection.sourceHandle ?? undefined,
        targetHandle: newConnection.targetHandle ?? undefined,
        data: nextData,
      };
    });

    set({
      edges: nextEdges,
      ...historyUpdate,
    });

    const updatedEdge = nextEdges.find((e) => e.id === oldEdge.id);
    if (updatedEdge) {
      commitBridgeDelta((bridge) => {
        bridge.putEdges([updatedEdge]);
      });
    }
  },

  addNode: (type: FlowNodeType, position: { x: number; y: number }, options?: CreateNodeOptions): FlowNode => {
    const { nodes, edges, historyPast } = get();
    const historyUpdate = pushHistorySnapshot(historyPast, nodes, edges);

    if (type === 'pool') {
      const poolId = generateUniqueId('pool');
      const lane1Id = `lane-${Date.now().toString(36)}-1`;
      const lane2Id = `lane-${Date.now().toString(36)}-2`;

      const poolNode: FlowNode = {
        id: poolId,
        type: 'pool',
        position,
        width: 800,
        height: 440,
        data: {
          label: '业务泳道池',
          type: 'pool',
          orientation: 'horizontal',
          laneOrder: [lane1Id, lane2Id],
          headerSize: 40,
        },
      };

      const lane1Node: FlowNode = {
        id: lane1Id,
        type: 'lane',
        parentId: poolId,
        extent: 'parent',
        position: { x: 0, y: 40 },
        width: 800,
        height: 200,
        data: { label: '泳道 1', type: 'lane', laneTitle: '泳道 1' },
      };

      const lane2Node: FlowNode = {
        id: lane2Id,
        type: 'lane',
        parentId: poolId,
        extent: 'parent',
        position: { x: 0, y: 240 },
        width: 800,
        height: 200,
        data: { label: '泳道 2', type: 'lane', laneTitle: '泳道 2' },
      };

      get().addNodes([poolNode, lane1Node, lane2Node]);
      set({ selectedNodeIds: [poolId] });
      return poolNode;
    }

    if (type === 'lane') {
      const pool =
        nodes.find((n) => n.type === 'pool' && (n.selected || get().selectedNodeIds.includes(n.id))) ||
        [...nodes].reverse().find((n) => n.type === 'pool');

      if (pool) {
        const poolLanes = nodes.filter((n) => n.parentId === pool.id);
        const laneId = `lane-${Date.now().toString(36)}-${poolLanes.length + 1}`;
        const isHorizontal = (pool.data?.orientation ?? 'horizontal') === 'horizontal';
        const headerSize = (pool.data?.headerSize as number) || 40;

        let laneX = 0;
        let laneY = 0;
        let laneW = pool.width ?? 800;
        let laneH = 200;

        if (isHorizontal) {
          laneW = pool.width ?? 800;
          laneH = 200;
          laneX = 0;
          const maxBottom = poolLanes.reduce(
            (max, l) => Math.max(max, l.position.y + (l.height ?? 200)),
            headerSize
          );
          laneY = maxBottom;
        } else {
          laneW = 240;
          laneH = (pool.height ?? 440) - headerSize;
          laneY = headerSize;
          const maxRight = poolLanes.reduce(
            (max, l) => Math.max(max, l.position.x + (l.width ?? 240)),
            0
          );
          laneX = maxRight;
        }

        const newLane: FlowNode = {
          id: laneId,
          type: 'lane',
          parentId: pool.id,
          extent: 'parent',
          position: { x: laneX, y: laneY },
          width: laneW,
          height: laneH,
          data: {
            label: `泳道 ${poolLanes.length + 1}`,
            type: 'lane',
            laneTitle: `泳道 ${poolLanes.length + 1}`,
          },
        };

        const currentOrder = (pool.data?.laneOrder as string[]) || poolLanes.map((l) => l.id);
        const nextOrder = [...currentOrder, laneId];
        const nextPoolW = isHorizontal ? pool.width : Math.max(pool.width ?? 600, laneX + laneW);
        const nextPoolH = isHorizontal ? Math.max(pool.height ?? 400, laneY + laneH) : pool.height;

        const nextNodes = nodes.map((n) =>
          n.id === pool.id
            ? {
                ...n,
                width: nextPoolW,
                height: nextPoolH,
                style: { ...(n.style || {}), width: nextPoolW, height: nextPoolH },
                data: { ...n.data, laneOrder: nextOrder },
              }
            : n
        );

        set({
          nodes: [...nextNodes, newLane],
          selectedNodeIds: [laneId],
          ...historyUpdate,
        });
        const updatedPool = nextNodes.find((n) => n.id === pool.id);
        commitBridgeDelta((bridge) => {
          if (updatedPool) {
            bridge.patchNode(pool.id, {
              width: updatedPool.width,
              height: updatedPool.height,
              style: updatedPool.style,
              data: updatedPool.data,
            });
          }
          bridge.putNodes([newLane]);
        });
        return newLane;
      } else {
        const poolId = generateUniqueId('pool');
        const laneId = `lane-${Date.now().toString(36)}-1`;
        const poolNode: FlowNode = {
          id: poolId,
          type: 'pool',
          position,
          width: 800,
          height: 240,
          data: {
            label: '业务泳道池',
            type: 'pool',
            orientation: 'horizontal',
            laneOrder: [laneId],
            headerSize: 40,
          },
        };
        const laneNode: FlowNode = {
          id: laneId,
          type: 'lane',
          parentId: poolId,
          extent: 'parent',
          position: { x: 0, y: 40 },
          width: 800,
          height: 200,
          data: { label: '泳道 1', type: 'lane', laneTitle: '泳道 1' },
        };
        get().addNodes([poolNode, laneNode]);
        set({ selectedNodeIds: [laneId] });
        return laneNode;
      }
    }

    const newNode = createNodeFromType(type, position, options);
    const nextNodes = [...nodes, newNode];

    set({
      nodes: nextNodes,
      ...historyUpdate,
    });

    commitBridgeDelta((bridge) => {
      bridge.putNodes([newNode]);
    });
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

    commitBridgeDelta((bridge) => {
      bridge.putNodes(newNodes);
    });
  },

  appendSubgraph: (newNodes: FlowNode[], newEdges: FlowEdge[]) => {
    const { nodes, edges, historyPast } = get();
    if (newNodes.length === 0 && newEdges.length === 0) return;

    const existingNodeIds = new Set(nodes.map((n) => n.id));
    const existingEdgeIds = new Set(edges.map((e) => e.id));
    const idMap = new Map<string, string>();

    // 冲突 ID 安全重映射，防止 React Key 重复或覆盖已有图元
    const safeNodes: FlowNode[] = newNodes.map((n) => {
      let finalId = n.id;
      if (existingNodeIds.has(finalId)) {
        finalId = `${n.id}-${Math.random().toString(36).slice(2, 6)}`;
        idMap.set(n.id, finalId);
      }
      return { ...n, id: finalId, selected: true };
    });

    if (idMap.size > 0) {
      for (const n of safeNodes) {
        if (n.parentId && idMap.has(n.parentId)) {
          n.parentId = idMap.get(n.parentId);
        }
      }
    }

    const safeEdges: FlowEdge[] = newEdges.map((e) => {
      let finalEdgeId = e.id;
      if (existingEdgeIds.has(finalEdgeId)) {
        finalEdgeId = `${e.id}-${Math.random().toString(36).slice(2, 6)}`;
      }
      const source = idMap.get(e.source) ?? e.source;
      const target = idMap.get(e.target) ?? e.target;
      return { ...e, id: finalEdgeId, source, target };
    });

    const historyUpdate = pushHistorySnapshot(historyPast, nodes, edges);
    const newIds = safeNodes.map((n) => n.id);

    const nextNodes = [
      ...nodes.map((n) => ({ ...n, selected: false })),
      ...safeNodes,
    ];
    const nextEdges = [...edges, ...safeEdges];

    set({
      nodes: nextNodes,
      edges: nextEdges,
      selectedNodeIds: newIds,
      selectedEdgeId: null,
      ...historyUpdate,
    });

    commitBridgeDelta((bridge) => {
      if (safeNodes.length > 0) bridge.putNodes(safeNodes);
      if (safeEdges.length > 0) bridge.putEdges(safeEdges);
    });
  },

  deleteSelected: () => {
    const { nodes, edges, selectedNodeIds, selectedEdgeId, selectedEdgeLabelId, historyPast } = get();

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

    // 锚定锁事前防线：
    // 1. 完全锁定 (full) 的节点本身禁止删除；
    // 2. 若容器（pool/lane/group）内部有不可删除的锁定子节点，该父容器整体禁止删除，防止子节点 parentId 悬挂与坐标错位 (B5)
    let hasProtectedNodes = true;
    while (hasProtectedNodes) {
      hasProtectedNodes = false;
      for (const n of nodes) {
        if (!nodeIdsToDelete.has(n.id)) continue;

        // 节点自身 full 锁定
        if (isNodeLocked(n, 'delete')) {
          nodeIdsToDelete.delete(n.id);
          hasProtectedNodes = true;
          continue;
        }

        // 容器保护：如果容器内包含存活的锁定后代，父级容器坚决禁删！
        const isContainer = ['pool', 'lane', 'group'].includes(n.type ?? '');
        if (isContainer) {
          const hasLockedChild = nodes.some(
            (child) => child.parentId === n.id && (!nodeIdsToDelete.has(child.id) || isNodeLocked(child, 'delete'))
          );
          if (hasLockedChild) {
            nodeIdsToDelete.delete(n.id);
            const unmarkDescendants = (parentId: string) => {
              for (const child of nodes) {
                if (child.parentId === parentId) {
                  if (nodeIdsToDelete.has(child.id)) {
                    nodeIdsToDelete.delete(child.id);
                    unmarkDescendants(child.id);
                  }
                }
              }
            };
            unmarkDescendants(n.id);
            hasProtectedNodes = true;
          }
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

    if (nodeIdsToDelete.size === 0 && edgeIdsToDelete.size === 0) {
      if (selectedEdgeLabelId) {
        get().deleteEdgeLabel(selectedEdgeLabelId);
      }
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

    commitBridgeDelta((bridge) => {
      if (nodeIdsToDelete.size > 0) bridge.removeNodes(Array.from(nodeIdsToDelete));
      if (edgeIdsToDelete.size > 0) bridge.removeEdges(Array.from(edgeIdsToDelete));
    });
  },

  updateNodeData: (id: string, data: Partial<FlowNodeData>) => {
    const { nodes, edges, historyPast } = get();
    const targetNode = nodes.find((n) => n.id === id);
    if (!targetNode) return;

    // 锚定锁事前防线：完全锁定 (full) 的节点禁止修改数据与样式 (除非本次动作是切换锁定模式自身)
    if (targetNode.data?.lockMode === 'full' && data.lockMode === undefined) {
      return;
    }

    const historyUpdate = pushHistorySnapshot(historyPast, nodes, edges);

    let updatedData: FlowNodeData | null = null;
    const nextNodes = nodes.map((n) => {
      if (n.id === id) {
        updatedData = {
          ...n.data,
          ...data,
          style: {
            ...n.data.style,
            ...data.style,
          },
        };
        return {
          ...n,
          data: updatedData,
        };
      }
      return n;
    });

    set({
      nodes: nextNodes,
      ...historyUpdate,
    });

    if (updatedData) {
      commitBridgeDelta((bridge) => {
        bridge.patchNode(id, { data: updatedData! });
      });
    }
  },

  updateNodeDimensions: (id: string, width: number, height: number) => {
    const { nodes, edges, historyPast } = get();
    const targetNode = nodes.find((n) => n.id === id);
    if (!targetNode) return;

    const historyUpdate = pushHistorySnapshot(historyPast, nodes, edges);

    let updatedNode: FlowNode | null = null;
    const nextNodes = nodes.map((n) => {
      if (n.id === id) {
        updatedNode = {
          ...n,
          width,
          height,
          style: {
            ...n.style,
            width,
            height,
          },
        };
        return updatedNode;
      }
      return n;
    });

    set({
      nodes: nextNodes,
      ...historyUpdate,
    });

    if (updatedNode) {
      const target = updatedNode as FlowNode;
      commitBridgeDelta((bridge) => {
        bridge.patchNode(id, { width: target.width, height: target.height, style: target.style });
      });
    }
  },

  startCenteredResize: (id: string) => {
    const node = get().nodes.find((n) => n.id === id);
    if (!node) return;

    const { width, height } = getNodeDimensions(node);
    centeredResizes.set(id, {
      x: node.position.x + width / 2,
      y: node.position.y + height / 2,
    });
  },

  finishCenteredResize: (id: string) => {
    if (!centeredResizes.delete(id)) return;

    const node = get().nodes.find((n) => n.id === id);
    if (!node) return;
    commitBridgeDelta((bridge) => {
      bridge.patchNode(id, {
        position: node.position,
        width: node.width,
        height: node.height,
        style: node.style,
      });
    });
  },

  batchUpdateNodeData: (updates: Array<{ id: string; data: Partial<FlowNodeData> }>) => {
    const { nodes, edges, historyPast } = get();
    if (updates.length === 0) return;

    const historyUpdate = pushHistorySnapshot(historyPast, nodes, edges);
    const updateMap = new Map(updates.map((u) => [u.id, u.data]));
    const patches: Array<{ id: string; patch: Partial<FlowNode> }> = [];

    const nextNodes = nodes.map((n) => {
      if (updateMap.has(n.id)) {
        const patch = updateMap.get(n.id)!;
        // 锚定锁守卫：完全锁定 (full) 的节点禁止批量修改内容与样式，除非是切换 lockMode 自身
        if (isNodeLocked(n, 'content') && patch.lockMode === undefined) {
          return n;
        }
        const nextData: FlowNodeData = {
          ...n.data,
          ...patch,
          style: {
            ...n.data.style,
            ...patch.style,
          },
        };
        patches.push({ id: n.id, patch: { data: nextData } });
        return {
          ...n,
          data: nextData,
        };
      }
      return n;
    });

    set({
      nodes: nextNodes,
      ...historyUpdate,
    });

    if (patches.length > 0) {
      commitBridgeDelta((bridge) => {
        bridge.patchNodes(patches);
      });
    }
  },

  updateEdgeData: (id: string, data: Partial<FlowEdgeData>) => {
    const { nodes, edges, historyPast } = get();
    const targetEdge = edges.find((e) => e.id === id);
    if (!targetEdge) return;

    const historyUpdate = pushHistorySnapshot(historyPast, nodes, edges);

    let updatedEdge: FlowEdge | null = null;
    const nextEdges = edges.map((e) => {
      if (e.id === id) {
        const nextAnimated =
          data.style?.animated !== undefined ? data.style.animated : e.animated;
        const nextLabel = 'label' in data ? (data.label || undefined) : e.label;
        updatedEdge = {
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
        return updatedEdge;
      }
      return e;
    });

    set({
      edges: nextEdges,
      ...historyUpdate,
    });

    if (updatedEdge) {
      const target = updatedEdge as FlowEdge;
      commitBridgeDelta((bridge) => {
        bridge.patchEdge(id, {
          label: target.label,
          animated: target.animated,
          data: target.data,
        });
      });
    }
  },

  setSelectedNodes: (ids: string[]) => {
    const idSet = new Set(ids);
    const nextNodes = get().nodes.map((n) => ({
      ...n,
      selected: idSet.has(n.id),
    }));
    set((s) => ({
      nodes: nextNodes,
      selectedNodeIds: ids,
      selectedEdgeLabelId: ids.length > 0 ? null : s.selectedEdgeLabelId,
    }));
  },

  setSelectedEdge: (id: string | null) => {
    const nextEdges = get().edges.map((e) => ({
      ...e,
      selected: id !== null && e.id === id,
    }));
    set((s) => ({
      edges: nextEdges,
      selectedEdgeId: id,
      selectedEdgeLabelId: id !== null ? null : s.selectedEdgeLabelId,
    }));
  },

  setActiveTool: (tool: ActiveTool) => {
    set({ activeTool: tool, alignmentGuides: [] });
  },

  setEdgeConnectMode: (mode: EdgeConnectMode) => {
    set({ edgeConnectMode: mode });
  },

  toggleEdgeConnectMode: () => {
    set((s) => ({
      edgeConnectMode: s.edgeConnectMode === 'orthogonal' ? 'straight' : 'orthogonal',
    }));
  },

  setShiftPressed: (pressed: boolean) => {
    set((s) => (s.isShiftPressed === pressed ? s : { isShiftPressed: pressed }));
  },

  setSpacePanning: (panning: boolean) => {
    set((s) => (s.isSpacePanning === panning ? s : { isSpacePanning: panning }));
  },

  setEditingEdgeLabelId: (id: string | null) => {
    set({ editingEdgeLabelId: id });
  },

  setSelectedEdgeLabelId: (id: string | null) => {
    if (id === null) {
      set({ selectedEdgeLabelId: null });
      return;
    }
    set((s) => ({
      selectedEdgeLabelId: id,
      selectedNodeIds: [],
      selectedEdgeId: null,
      nodes: s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
      edges: s.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
    }));
  },

  deleteEdgeLabel: (id: string) => {
    const { nodes, edges, historyPast } = get();
    const target = edges.find((e) => e.id === id);
    if (!target || (!target.data?.label && !target.label)) {
      set({ selectedEdgeLabelId: null });
      return;
    }
    const historyUpdate = pushHistorySnapshot(historyPast, nodes, edges);
    const nextEdges = edges.map((e) => {
      if (e.id !== id) return e;
      const nextData = { ...(e.data || {}) };
      delete nextData.label;
      delete nextData.labelRatio;
      const { label: _removed, ...rest } = e;
      return { ...rest, data: nextData };
    });
    set({
      edges: nextEdges,
      selectedEdgeLabelId: null,
      editingEdgeLabelId: get().editingEdgeLabelId === id ? null : get().editingEdgeLabelId,
      ...historyUpdate,
    });
    const updatedEdge = nextEdges.find((e) => e.id === id);
    if (updatedEdge) {
      commitBridgeDelta((bridge) => {
        bridge.putEdges([updatedEdge]);
      });
    }
  },

  setViewportZoom: (zoom: number) => {
    set({ viewportZoom: zoom });
  },

  setAlignmentSnapEnabled: (enabled: boolean) => {
    const { alignmentSnapEnabled } = get();
    if (alignmentSnapEnabled === enabled) return;
    set({ alignmentSnapEnabled: enabled, alignmentGuides: [] });
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
    // 锚定锁守卫：过滤完全锁定 (full) 的节点，严禁修改其 parentId 与层级
    const targetNodes = nodes.filter(
      (n) => (selectedSet.has(n.id) || n.selected) && !isNodeLocked(n, 'hierarchy')
    );
    if (targetNodes.length < 2) {
      if (nodes.some((n) => (selectedSet.has(n.id) || n.selected) && isNodeLocked(n, 'hierarchy'))) {
        get().showToast('包含完全锁定节点，禁止重新分组');
      } else {
        get().showToast('成组至少需选择 2 个图元');
      }
      return null;
    }

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

    const childPatches = nextNodes
      .filter((n) => targetIdSet.has(n.id))
      .map((n) => ({
        id: n.id,
        patch: {
          parentId: n.parentId,
          extent: n.extent,
          position: n.position,
          data: n.data,
        },
      }));
    commitBridgeDelta((bridge) => {
      bridge.putNodes([groupNode]);
      if (childPatches.length > 0) bridge.patchNodes(childPatches);
    });
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

    // 锚定锁守卫：若分组本身或其内部子节点包含 full-lock，禁止解散
    const filteredGroupIds = targetGroupIds.filter((gid) => {
      const gNode = nodes.find((n) => n.id === gid);
      if (isNodeLocked(gNode, 'hierarchy')) return false;
      const hasLockedChild = nodes.some((n) => n.parentId === gid && isNodeLocked(n, 'hierarchy'));
      return !hasLockedChild;
    });

    if (filteredGroupIds.length === 0) {
      if (targetGroupIds.length > 0) {
        get().showToast('该组合包含锁定节点，禁止解散');
      }
      return;
    }

    const groupSet = new Set(filteredGroupIds);
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

    const ungroupedSet = new Set(unGroupedChildIds);
    const updatedChildren = nextNodes.filter((n) => ungroupedSet.has(n.id));
    commitBridgeDelta((bridge) => {
      bridge.removeNodes(filteredGroupIds);
      if (updatedChildren.length > 0) bridge.putNodes(updatedChildren);
    });
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
      // 锚定锁守卫：位置锁定 (position) 或完全锁定 (full) 的节点 100% 保持不动
      if (!targetIdSet.has(node.id) || isNodeLocked(node, 'position')) return node;

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
    const patches = nextNodes
      .filter((n) => targetIdSet.has(n.id) && !isNodeLocked(n, 'position'))
      .map((n) => ({ id: n.id, patch: { position: n.position } }));
    if (patches.length > 0) {
      commitBridgeDelta((bridge) => {
        bridge.patchNodes(patches);
      });
    }
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
        // 锚定锁守卫：位置锁定 (position) 或完全锁定 (full) 的节点保持不动
        if (posMap.has(node.id) && !isNodeLocked(node, 'position')) {
          return {
            ...node,
            position: { ...node.position, x: posMap.get(node.id)! },
          };
        }
        return node;
      });

      set({ nodes: nextNodes, ...historyUpdate });
      const patches = nextNodes
        .filter((n) => posMap.has(n.id) && !isNodeLocked(n, 'position'))
        .map((n) => ({ id: n.id, patch: { position: n.position } }));
      if (patches.length > 0) {
        commitBridgeDelta((bridge) => {
          bridge.patchNodes(patches);
        });
      }
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
        // 锚定锁守卫：位置锁定 (position) 或完全锁定 (full) 的节点保持不动
        if (posMap.has(node.id) && !isNodeLocked(node, 'position')) {
          return {
            ...node,
            position: { ...node.position, y: posMap.get(node.id)! },
          };
        }
        return node;
      });

      set({ nodes: nextNodes, ...historyUpdate });
      const patches = nextNodes
        .filter((n) => posMap.has(n.id) && !isNodeLocked(n, 'position'))
        .map((n) => ({ id: n.id, patch: { position: n.position } }));
      if (patches.length > 0) {
        commitBridgeDelta((bridge) => {
          bridge.patchNodes(patches);
        });
      }
    }
  },

  applyIncrementalUpdate: (delta: IncrementalGraphDelta) => {
    const {
      nodes,
      edges,
      historyPast,
      selectedNodeIds,
      selectedEdgeId,
      editingEdgeLabelId,
      selectedEdgeLabelId,
    } = get();

    const removedNodeSet = new Set(delta.removeNodeIds ?? []);
    const putNodes = delta.putNodes ?? [];
    const putNodeMap = new Map(putNodes.map((n) => [n.id, n]));

    let nextNodes = nodes
      .filter((n) => !removedNodeSet.has(n.id))
      .map((n) => putNodeMap.get(n.id) ?? n);

    const existingNodeIdSet = new Set(nextNodes.map((n) => n.id));
    for (const n of putNodes) {
      if (!existingNodeIdSet.has(n.id)) {
        nextNodes.push(n);
        existingNodeIdSet.add(n.id);
      }
    }

    if (putNodes.some((n) => n.parentId)) {
      nextNodes = sortNodesByDepth(nextNodes);
    }

    const activeNodeIds = new Set(nextNodes.map((n) => n.id));
    const removedEdgeSet = new Set(delta.removeEdgeIds ?? []);
    const putEdges = delta.putEdges ?? [];
    const putEdgeMap = new Map(putEdges.map((e) => [e.id, e]));

    const nextEdges = edges
      .filter(
        (e) =>
          !removedEdgeSet.has(e.id) &&
          activeNodeIds.has(e.source) &&
          activeNodeIds.has(e.target)
      )
      .map((e) => putEdgeMap.get(e.id) ?? e);

    const existingEdgeIdSet = new Set(nextEdges.map((e) => e.id));
    for (const e of putEdges) {
      if (!existingEdgeIdSet.has(e.id) && activeNodeIds.has(e.source) && activeNodeIds.has(e.target)) {
        nextEdges.push(e);
        existingEdgeIdSet.add(e.id);
      }
    }

    let nextSelectedNodeIds = selectedNodeIds;
    let nextSelectedEdgeId = selectedEdgeId;
    if (delta.clearSelection) {
      nextSelectedNodeIds = [];
      nextSelectedEdgeId = null;
      nextNodes = nextNodes.map((n) => (n.selected ? { ...n, selected: false } : n));
    } else if (delta.selectNodeIds) {
      const selSet = new Set(delta.selectNodeIds);
      nextSelectedNodeIds = delta.selectNodeIds;
      nextSelectedEdgeId = null;
      nextNodes = nextNodes.map((n) => ({ ...n, selected: selSet.has(n.id) }));
    } else {
      nextSelectedNodeIds = selectedNodeIds.filter((id) => activeNodeIds.has(id));
      nextSelectedEdgeId =
        selectedEdgeId && existingEdgeIdSet.has(selectedEdgeId) ? selectedEdgeId : null;
    }

    const finalEdges =
      delta.clearSelection || delta.selectNodeIds
        ? nextEdges.map((e) => (e.selected ? { ...e, selected: false } : e))
        : nextEdges;

    const historyUpdate = pushHistorySnapshot(historyPast, nodes, edges);

    set({
      nodes: nextNodes,
      edges: finalEdges,
      selectedNodeIds: nextSelectedNodeIds,
      selectedEdgeId: nextSelectedEdgeId,
      editingEdgeLabelId:
        editingEdgeLabelId && existingEdgeIdSet.has(editingEdgeLabelId) ? editingEdgeLabelId : null,
      selectedEdgeLabelId:
        selectedEdgeLabelId && existingEdgeIdSet.has(selectedEdgeLabelId) ? selectedEdgeLabelId : null,
      ...historyUpdate,
    });

    commitBridgeDelta((bridge) => {
      if (delta.removeNodeIds?.length) bridge.removeNodes(delta.removeNodeIds);
      if (putNodes.length > 0) bridge.putNodes(putNodes);
      if (delta.removeEdgeIds?.length) bridge.removeEdges(delta.removeEdgeIds);
      if (putEdges.length > 0) bridge.putEdges(putEdges);
    });
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

    commitBridgeDelta((bridge) => {
      bridge.setDiagram(cleanNodes, cleanEdges);
    });
  },

  setDiagramTitle: (title: string) => {
    const trimmed = title.trim();
    set({ diagramTitle: trimmed });
    if (activeBridge) {
      activeBridge.setTitle(trimmed);
    }
  },

  resetDiagramState: () => {
    centeredResizes.clear();
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    set({
      nodes: [],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeId: null,
      diagramTitle: '未命名流程图',
      historyPast: [],
      historyFuture: [],
      canUndo: false,
      canRedo: false,
      isInteracting: false,
      alignmentGuides: [],
      spotlightActive: false,
      spotlightTargetId: null,
      spotlightBranchFilter: null,
      followingUserId: null,
      aiReviewActive: false,
      aiReviewBatchId: null,
      aiAcceptedEntityIds: new Set<string>(),
      dismissedAiBatchIds: new Set<string>(),
      mermaidDrawerOpen: false,
      copilotOpen: false,
      toastMessage: null,
    });
  },

  toggleSpotlightMode: (enabled?: boolean) => {
    set((s) => ({
      spotlightActive: enabled ?? !s.spotlightActive,
      ...(!enabled && s.spotlightActive ? { spotlightTargetId: null, spotlightBranchFilter: null } : {}),
    }));
  },

  setSpotlightTarget: (targetId: string | null, branchFilter: string | null = null) => {
    set({
      spotlightActive: Boolean(targetId),
      spotlightTargetId: targetId,
      spotlightBranchFilter: branchFilter,
    });
  },

  setFollowingUser: (userId: string | null) => {
    set({ followingUserId: userId });
  },

  toggleSelectedLockMode: () => {
    const { nodes, selectedNodeIds } = get();
    if (selectedNodeIds.length === 0) return;

    const targetNodes = nodes.filter((n) => selectedNodeIds.includes(n.id) || n.selected);
    if (targetNodes.length === 0) return;

    // 循环切换顺序：none -> position (坐标锁 📌) -> full (完全锁 🔒) -> none
    const currentMode = targetNodes[0].data?.lockMode ?? 'none';
    const nextMode: 'none' | 'position' | 'full' =
      currentMode === 'none' ? 'position' : currentMode === 'position' ? 'full' : 'none';

    const updates = targetNodes.map((n) => ({
      id: n.id,
      data: { lockMode: nextMode },
    }));
    get().batchUpdateNodeData(updates);
  },

  setAiReviewMode: (active: boolean, batchId?: string | null) => {
    set({
      aiReviewActive: active,
      aiReviewBatchId: batchId ?? (active ? get().aiReviewBatchId : null),
    });
  },

  acceptAiEntity: (entityId: string) => {
    set((s) => {
      const next = new Set(s.aiAcceptedEntityIds);
      next.add(entityId);
      return { aiAcceptedEntityIds: next };
    });
  },

  clearAiAcceptedEntities: () => {
    set({ aiAcceptedEntityIds: new Set<string>() });
  },

  dismissAiBatch: (batchId: string) => {
    set((s) => {
      const next = new Set(s.dismissedAiBatchIds);
      next.add(batchId);
      return { dismissedAiBatchIds: next };
    });
  },

  setMermaidDrawerOpen: (open: boolean) => {
    set({ mermaidDrawerOpen: open });
  },

  setCopilotOpen: (open: boolean | ((prev: boolean) => boolean)) => {
    set((s) => ({ copilotOpen: typeof open === 'function' ? open(s.copilotOpen) : open }));
  },

  showToast: (message: string, duration = 3000) => {
    set({ toastMessage: message });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      set({ toastMessage: null });
    }, duration);
  },

  applyMermaidOps: (ops: MermaidBridgeOp[]) => {
    const { nodes, edges, historyPast } = get();
    let nextNodes = [...nodes];
    let nextEdges = [...edges];

    let addedNodesCount = 0;
    let addedEdgesCount = 0;

    let maxX = 80;
    let maxY = 80;
    for (const n of nextNodes) {
      if (n.type !== 'pool' && n.type !== 'lane') {
        maxX = Math.max(maxX, n.position.x + (n.width ?? 140));
        maxY = Math.max(maxY, n.position.y);
      }
    }
    let newPlacementX = maxX + 100;
    let newPlacementY = 100;

    for (const op of ops) {
      switch (op.op) {
        case 'add_pool': {
          if (!nextNodes.some((n) => n.id === op.id)) {
            const isVertical = op.orientation === 'vertical';
            const pool: FlowNode = {
              id: op.id,
              type: 'pool',
              position: { x: 50, y: 50 },
              width: isVertical ? 520 : 800,
              height: isVertical ? 640 : 240,
              data: {
                label: op.label,
                type: 'pool',
                orientation: op.orientation ?? 'horizontal',
                laneOrder: [],
                headerSize: 40,
              },
            };
            nextNodes.push(pool);
            addedNodesCount++;
          }
          break;
        }

        case 'add_lane': {
          let pool = op.poolId
            ? nextNodes.find((n) => n.id === op.poolId && n.type === 'pool')
            : nextNodes.find((n) => n.type === 'pool');
          if (!pool) {
            const poolId = op.poolId || generateUniqueId('pool');
            pool = {
              id: poolId,
              type: 'pool',
              position: { x: 50, y: 50 },
              width: 800,
              height: 240,
              data: {
                label: '业务泳道池',
                type: 'pool',
                orientation: 'horizontal',
                laneOrder: [op.id],
                headerSize: 40,
              },
            };
            nextNodes.push(pool);
            addedNodesCount++;
          } else {
            const currentOrder = pool.data?.laneOrder ?? [];
            if (!currentOrder.includes(op.id)) {
              pool = {
                ...pool,
                data: {
                  ...pool.data,
                  laneOrder: [...currentOrder, op.id],
                },
              };
              nextNodes = nextNodes.map((n) => (n.id === pool!.id ? pool! : n));
            }
          }

          if (pool && !nextNodes.some((n) => n.id === op.id)) {
            const currentPool = pool;
            // 按所属池内的泳道计数 (B11)
            const poolLanes = nextNodes.filter((n) => n.parentId === currentPool.id && n.type === 'lane');
            const laneIndex = poolLanes.length;
            const isVertical = currentPool.data?.orientation === 'vertical';
            const newLanePos = isVertical
              ? { x: laneIndex * 240, y: 40 }
              : { x: 0, y: 40 + laneIndex * 200 };

            nextNodes.push({
              id: op.id,
              type: 'lane',
              parentId: currentPool.id,
              position: newLanePos,
              width: isVertical ? 240 : (currentPool.width ?? 800),
              height: isVertical ? ((currentPool.height ?? 640) - 40) : 200,
              data: { label: op.label, type: 'lane', laneTitle: op.label },
            });

            // 撑开池高度/宽度
            if (isVertical) {
              const requiredPoolW = (laneIndex + 1) * 240;
              if ((currentPool.width ?? 0) < requiredPoolW && !isNodeLocked(currentPool, 'position')) {
                const updatedPool: FlowNode = {
                  ...currentPool,
                  width: requiredPoolW,
                  style: { ...currentPool.style, width: requiredPoolW },
                };
                nextNodes = nextNodes.map((n) => (n.id === updatedPool.id ? updatedPool : n));
              }
            } else {
              const requiredPoolH = 40 + (laneIndex + 1) * 200;
              if ((currentPool.height ?? 0) < requiredPoolH && !isNodeLocked(currentPool, 'position')) {
                const updatedPool: FlowNode = {
                  ...currentPool,
                  height: requiredPoolH,
                  style: { ...currentPool.style, height: requiredPoolH },
                };
                nextNodes = nextNodes.map((n) => (n.id === updatedPool.id ? updatedPool : n));
              }
            }

            addedNodesCount++;
          }
          break;
        }

        case 'add_node': {
          if (!nextNodes.some((n) => n.id === op.id)) {
            const newNode = createNodeFromType(op.type, { x: newPlacementX, y: newPlacementY });
            newNode.id = op.id;
            newNode.data.label = op.label;
            if (op.laneId) {
              newNode.parentId = op.laneId;
              newNode.extent = undefined;
              // 同泳道内增量布局横向偏移 (B11)
              const existingChildren = nextNodes.filter((n) => n.parentId === op.laneId);
              newNode.position = { x: 40 + existingChildren.length * 160, y: 40 };
            } else {
              newPlacementY += 120;
              if (newPlacementY > 600) {
                newPlacementY = 100;
                newPlacementX += 200;
              }
            }
            nextNodes.push(newNode);
            addedNodesCount++;
          }
          break;
        }

        case 'update_node': {
          nextNodes = nextNodes.map((n) => {
            if (n.id === op.id) {
              // 锚定锁防护：full 锁定节点不被改写 (统一锁守卫)
              if (isNodeLocked(n, 'content')) return n;
              return {
                ...n,
                data: {
                  ...n.data,
                  label: op.label,
                },
              };
            }
            return n;
          });
          break;
        }

        case 'move_to_lane': {
          // 校验目标泳道存在性 (B11)
          const laneExists = nextNodes.some((n) => n.id === op.laneId && n.type === 'lane');
          if (!laneExists) break;

          nextNodes = nextNodes.map((n) => {
            if (n.id === op.nodeId) {
              // 锚定锁守卫：position 或 full 锁定节点坚决禁止通过 Mermaid 重挂泳道导致位移与归属跳变 (B4)
              if (isNodeLocked(n, 'position')) {
                return n;
              }
              return {
                ...n,
                parentId: op.laneId,
                extent: 'parent',
              };
            }
            return n;
          });
          break;
        }

        case 'connect': {
          // 校验端点存在性 (B11)
          const srcExists = nextNodes.some((n) => n.id === op.source);
          const tgtExists = nextNodes.some((n) => n.id === op.target);
          if (!srcExists || !tgtExists) break;

          const edgeId = generateEdgeId(op.source, op.target);
          if (!nextEdges.some((e) => e.source === op.source && e.target === op.target)) {
            nextEdges.push({
              id: edgeId,
              source: op.source,
              target: op.target,
              type: 'orthogonal',
              markerEnd: { type: MarkerType.ArrowClosed },
              animated: false,
              data: op.label ? { label: op.label } : {},
            });
            addedEdgesCount++;
          }
          break;
        }

        case 'update_edge': {
          nextEdges = nextEdges.map((e) => {
            if (e.id === op.id) {
              return {
                ...e,
                data: {
                  ...e.data,
                  label: op.label,
                },
              };
            }
            return e;
          });
          break;
        }

        case 'disconnect': {
          nextEdges = nextEdges.filter((e) => e.id !== op.edgeId);
          break;
        }
      }
    }

    const historyUpdate = pushHistorySnapshot(historyPast, nodes, edges);
    set({
      nodes: nextNodes,
      edges: nextEdges,
      ...historyUpdate,
    });

    const prevNodeMap = new Map(nodes.map((n) => [n.id, n]));
    const prevEdgeMap = new Map(edges.map((e) => [e.id, e]));
    const nextEdgeIds = new Set(nextEdges.map((e) => e.id));
    const putNodes = nextNodes.filter((n) => prevNodeMap.get(n.id) !== n);
    const putEdges = nextEdges.filter((e) => prevEdgeMap.get(e.id) !== e);
    const removeEdgeIds = edges.filter((e) => !nextEdgeIds.has(e.id)).map((e) => e.id);

    if (putNodes.length > 0 || putEdges.length > 0 || removeEdgeIds.length > 0) {
      commitBridgeDelta((bridge) => {
        if (removeEdgeIds.length > 0) bridge.removeEdges(removeEdgeIds);
        if (putNodes.length > 0) bridge.putNodes(putNodes);
        if (putEdges.length > 0) bridge.putEdges(putEdges);
      });
    }

    return { addedNodes: addedNodesCount, addedEdges: addedEdgesCount };
  },

  bindCollaboration: (bridge: YjsDiagramBridge, undoManager: CollaborativeUndoManager) => {
    activeBridge = bridge;
    activeUndoManager = undoManager;

    const bridgeState = bridge.toReactFlowState();
    const rawTitle = bridge.getRawTitle();
    if (bridgeState.nodes.length > 0 || bridgeState.edges.length > 0 || rawTitle) {
      set({
        nodes: bridgeState.nodes,
        edges: bridgeState.edges,
        ...(rawTitle ? { diagramTitle: rawTitle } : {}),
      });
    } else {
      const { nodes, edges } = get();
      if (nodes.length > 0 || edges.length > 0) {
        bridge.setDiagram(nodes, edges);
      }
    }

    let prevBridgeNodes: FlowNode[] | null = bridgeState.nodes.length > 0 ? bridgeState.nodes : null;
    let prevBridgeEdges: FlowEdge[] | null = bridgeState.edges.length > 0 ? bridgeState.edges : null;
    const prevRawNodeById = new Map<string, FlowNode>(bridgeState.nodes.map((n) => [n.id, n]));
    const prevRawEdgeById = new Map<string, FlowEdge>(bridgeState.edges.map((e) => [e.id, e]));

    if (unsubscribeBridge) unsubscribeBridge();
    unsubscribeBridge = bridge.subscribe((state) => {
      if (state.metaOnly) {
        if (state.title !== get().diagramTitle) {
          set({ diagramTitle: state.title });
        }
        return;
      }

      const {
        nodes: prevNodes,
        edges: prevEdges,
        selectedNodeIds,
        selectedEdgeId,
        editingEdgeLabelId,
        selectedEdgeLabelId,
        diagramTitle,
      } = get();

      const validNodeIds = new Set(state.nodes.map((n) => n.id));
      const validEdgeIds = new Set(state.edges.map((e) => e.id));

      for (const id of Array.from(centeredResizes.keys())) {
        if (!validNodeIds.has(id)) {
          centeredResizes.delete(id);
        }
      }

      const nextSelectedNodeIds = selectedNodeIds.every((id) => validNodeIds.has(id))
        ? selectedNodeIds
        : selectedNodeIds.filter((id) => validNodeIds.has(id));
      const selectedNodeSet = new Set(nextSelectedNodeIds);
      const nextSelectedEdgeId =
        selectedEdgeId && validEdgeIds.has(selectedEdgeId) ? selectedEdgeId : null;
      const nextEditingEdgeLabelId =
        editingEdgeLabelId && validEdgeIds.has(editingEdgeLabelId) ? editingEdgeLabelId : null;
      const nextSelectedEdgeLabelId =
        selectedEdgeLabelId && validEdgeIds.has(selectedEdgeLabelId) ? selectedEdgeLabelId : null;

      const prevNodeById = new Map(prevNodes.map((n) => [n.id, n]));
      const prevEdgeById = new Map(prevEdges.map((e) => [e.id, e]));

      let mergedNodes: FlowNode[];
      if (state.nodes === prevBridgeNodes && nextSelectedNodeIds === selectedNodeIds) {
        mergedNodes = prevNodes;
      } else {
        mergedNodes = state.nodes.map((n) => {
          const prevNode = prevNodeById.get(n.id);
          const isSelected = selectedNodeSet.has(n.id);
          if (
            prevNode &&
            prevRawNodeById.get(n.id) === n &&
            Boolean(prevNode.selected) === isSelected
          ) {
            return prevNode;
          }
          const measured = (prevNode as { measured?: { width?: number; height?: number } } | undefined)?.measured;
          const isDragging = prevNode?.dragging === true;
          return {
            ...n,
            ...(measured ? { measured } : {}),
            ...(isDragging ? { position: prevNode.position, dragging: true } : {}),
            selected: isSelected,
          };
        });
      }

      let mergedEdges: FlowEdge[];
      if (state.edges === prevBridgeEdges && nextSelectedEdgeId === selectedEdgeId) {
        mergedEdges = prevEdges;
      } else {
        mergedEdges = state.edges.map((e) => {
          const prevEdge = prevEdgeById.get(e.id);
          const isSelected = e.id === nextSelectedEdgeId;
          if (
            prevEdge &&
            prevRawEdgeById.get(e.id) === e &&
            Boolean(prevEdge.selected) === isSelected
          ) {
            return prevEdge;
          }
          return {
            ...e,
            selected: isSelected,
          };
        });
      }

      prevBridgeNodes = state.nodes;
      prevBridgeEdges = state.edges;
      prevRawNodeById.clear();
      for (const n of state.nodes) prevRawNodeById.set(n.id, n);
      prevRawEdgeById.clear();
      for (const e of state.edges) prevRawEdgeById.set(e.id, e);

      set({
        nodes: mergedNodes,
        edges: mergedEdges,
        selectedNodeIds: nextSelectedNodeIds,
        selectedEdgeId: nextSelectedEdgeId,
        editingEdgeLabelId: nextEditingEdgeLabelId,
        selectedEdgeLabelId: nextSelectedEdgeLabelId,
        ...(state.title !== diagramTitle ? { diagramTitle: state.title } : {}),
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

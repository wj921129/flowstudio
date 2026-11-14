/**
 * @fileoverview 主画布容器组件 (FlowCanvas)
 * @description 组装 React Flow 视口，集成自由拖拽与智能对齐参考线、橡皮筋框选、全局快捷键、正交连线与就地浮动工具条
 */

import React, { useEffect, useCallback, useState, useRef, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  SelectionMode,
  ConnectionMode,
  MarkerType,
  ConnectionLineType,
  ViewportPortal,
  useReactFlow,
} from '@xyflow/react';
import {
  DEFAULT_SNAP_GRID,
  isFlowNodeType,
  getDefaultNodeSize,
  type FlowNode,
  type FlowEdge,
  diffMermaidToOps,
  parseDrawioXml,
  parseBpmnXml,
} from '@flowstudio/shared';
import { generateUniqueId, createNodeFromType } from '../../lib/node-utils';
import { useFlowStore } from '../../stores/flow-store';
import { nodeTypes } from './custom-nodes';
import { edgeTypes, EdgeRoutingManager } from './custom-edges';
import { AlignmentGuides } from './alignment-guides';
import { ContextualActionBar } from './floating-toolbar/contextual-action-bar';
import { CanvasControls } from './canvas-controls';
import { FloatingToolbar } from '../toolbar/floating-toolbar';
import { CommentsLayer, ReviewDrawer } from '../comments';
import { CollaborativeCursors } from '../collaboration/collaborative-cursors';
import { AiBatchBanner } from '../collaboration/ai-batch-banner';
import { AiBatchDiffOverlay } from '../collaboration/ai-batch-diff-overlay';
import { useCollaboration } from '../collaboration/collaboration-provider';
import { handleNodeDragNesting } from './utils/lane-nesting-manager';
import { findEdgeAtPosition, splitEdgeAndInsertNode, healOnDelete, getNodeWorldPosition } from './utils/split-insert-manager';
import { computePathSpotlight, computeGlobalPathSpotlight, getDecisionBranches } from './utils/path-spotlight';
import { isNodeLocked } from './utils/node-lock-manager';
import { TEMPLATES_REGISTRY, instantiateTemplate } from '../sidebar/templates';
import { useSidebarStore } from '../sidebar/sidebar-store';
import { getThemePreset } from '../sidebar/styles/theme-presets';
import { WatermarkLayer, PresentationControls, usePresentationStore } from '../presentation';
import { SnapshotDiffOverlay, SnapshotDiffSidebar } from '../snapshot';


/** 协同光标广播最小间隔 (ms)：原生 mousemove 频率远超展示与带宽需要，逐帧直发会引发全树重渲染 */
const CURSOR_BROADCAST_INTERVAL_MS = 40;

export const FlowCanvas: React.FC = () => {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const activeTool = useFlowStore((s) => s.activeTool);
  const onNodesChange = useFlowStore((s) => s.onNodesChange);
  const onEdgesChange = useFlowStore((s) => s.onEdgesChange);
  const onConnect = useFlowStore((s) => s.onConnect);
  const addNode = useFlowStore((s) => s.addNode);
  const addNodes = useFlowStore((s) => s.addNodes);
  const appendSubgraph = useFlowStore((s) => s.appendSubgraph);
  const setSelectedNodes = useFlowStore((s) => s.setSelectedNodes);
  const setSelectedEdge = useFlowStore((s) => s.setSelectedEdge);
  const selectedNodeIds = useFlowStore((s) => s.selectedNodeIds);
  const selectedEdgeId = useFlowStore((s) => s.selectedEdgeId);
  const groupSelectedNodes = useFlowStore((s) => s.groupSelectedNodes);
  const ungroupNodes = useFlowStore((s) => s.ungroupNodes);
  const deleteSelected = useFlowStore((s) => s.deleteSelected);
  const undo = useFlowStore((s) => s.undo);
  const redo = useFlowStore((s) => s.redo);
  const setActiveTool = useFlowStore((s) => s.setActiveTool);
  const edgeConnectMode = useFlowStore((s) => s.edgeConnectMode);
  const isShiftPressed = useFlowStore((s) => s.isShiftPressed);
  const setShiftPressed = useFlowStore((s) => s.setShiftPressed);
  const isSpacePanning = useFlowStore((s) => s.isSpacePanning);
  const setSpacePanning = useFlowStore((s) => s.setSpacePanning);
  const setDiagram = useFlowStore((s) => s.setDiagram);
  const spotlightActive = useFlowStore((s) => s.spotlightActive);
  const spotlightTargetId = useFlowStore((s) => s.spotlightTargetId);
  const spotlightBranchFilter = useFlowStore((s) => s.spotlightBranchFilter);
  const toggleSpotlightMode = useFlowStore((s) => s.toggleSpotlightMode);
  const setSpotlightTarget = useFlowStore((s) => s.setSpotlightTarget);
  const followingUserId = useFlowStore((s) => s.followingUserId);
  const setFollowingUser = useFlowStore((s) => s.setFollowingUser);
  const toastMessage = useFlowStore((s) => s.toastMessage);
  const showToast = useFlowStore((s) => s.showToast);
  const isReadOnly = usePresentationStore((s) => s.isReadOnly);
  const isPresenting = usePresentationStore((s) => s.isPresenting);

  const { screenToFlowPosition, setViewport } = useReactFlow();
  const collab = useCollaboration();
  const setAlignmentSnapEnabled = useFlowStore((s) => s.setAlignmentSnapEnabled);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    EdgeRoutingManager.getInstance().updateNodes(nodes);
  }, [nodes]);

  // 拖拽悬停至连线附近的断键预览态状态
  const [hoveredEdgeForInsert, setHoveredEdgeForInsert] = useState<{
    edgeId: string;
    point: { x: number; y: number };
  } | null>(null);

  // 监听并执行主讲人视角与聚光灯带看跟随 (M1)
  useEffect(() => {
    if (!followingUserId || !collab?.remoteUsers) return;
    const targetUser = collab.remoteUsers.find((u) => u.clientId === followingUserId);
    if (!targetUser) return;

    if (targetUser.viewport) {
      setViewport(
        { x: targetUser.viewport.x, y: targetUser.viewport.y, zoom: targetUser.viewport.zoom },
        { duration: 150 }
      );
    }

    // 同步聚光灯带看高亮链路
    if (targetUser.spotlightTargetId) {
      if (!spotlightActive || spotlightTargetId !== targetUser.spotlightTargetId) {
        toggleSpotlightMode(true);
        setSpotlightTarget(targetUser.spotlightTargetId, 'all');
      }
    } else if (spotlightActive) {
      toggleSpotlightMode(false);
      setSpotlightTarget(null);
    }
  }, [
    followingUserId,
    collab?.remoteUsers,
    setViewport,
    spotlightActive,
    spotlightTargetId,
    toggleSpotlightMode,
    setSpotlightTarget,
  ]);

  // 单选元素自动触发链路走查；若存在外部指定目标（如演讲/主讲人跟随）则优先使用
  const autoSpotlightTargetId = useMemo(() => {
    if (selectedNodeIds.length === 1 && !selectedEdgeId) return selectedNodeIds[0];
    if (selectedEdgeId && selectedNodeIds.length === 0) return selectedEdgeId;
    return null;
  }, [selectedNodeIds, selectedEdgeId]);

  const effectiveSpotlightTargetId = spotlightTargetId || autoSpotlightTargetId;

  // 计算因果链路聚光灯走查范围（单选元素局部走查 或 全局链路走查）
  const spotlightResult = useMemo(() => {
    if (effectiveSpotlightTargetId) {
      return computePathSpotlight(nodes, edges, effectiveSpotlightTargetId, {
        decisionBranchFilter: spotlightBranchFilter,
      });
    }
    if (spotlightActive) {
      return computeGlobalPathSpotlight(nodes, edges);
    }
    return null;
  }, [spotlightActive, effectiveSpotlightTargetId, spotlightBranchFilter, nodes, edges]);

  // 计算当前聚焦链路中的决策分支列表供浮动单选胶囊切换
  const decisionBranches = useMemo(() => {
    if (!effectiveSpotlightTargetId) return [];
    return getDecisionBranches(effectiveSpotlightTargetId, edges);
  }, [effectiveSpotlightTargetId, edges]);

  // 映射聚光灯走查与锚定锁限制下的节点集合（position/full 锁定及包含锁定子节点的容器禁止拖拽，聚光灯降噪15%透明度）
  const displayNodes = useMemo(() => {
    const hasSpotlightDim = Boolean(spotlightActive && spotlightResult);
    // 检查是否有 position/full 锁定的节点 (B8 性能优化)
    const lockedNodeIds = new Set(nodes.filter((n) => isNodeLocked(n, 'position')).map((n) => n.id));
    // 检查是否有包含锁定子节点的祖先容器（lane / pool / group）(B3 容器拖拽穿透防护)
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

    const hasAnyLocked = lockedNodeIds.size > 0 || lockedContainers.size > 0;
    // B8: 无聚光灯降噪且无任何锁定节点/容器时，直接返回原数组引用，防止每帧生成新对象导致 React Flow 重渲
    if (!hasSpotlightDim && !hasAnyLocked && !isReadOnly) {
      return nodes;
    }

    return nodes.map((node) => {
      const isLockedFromDrag = isReadOnly || lockedNodeIds.has(node.id) || lockedContainers.has(node.id);
      const isHighlighted = hasSpotlightDim && spotlightResult
        ? spotlightResult.nodeIds.has(node.id) || spotlightResult.laneIds.has(node.id)
        : true;

      return {
        ...node,
        draggable: isLockedFromDrag ? false : undefined,
        style: {
          ...node.style,
          ...(hasSpotlightDim
            ? {
                opacity: isHighlighted ? 1 : 0.15,
                filter: isHighlighted ? undefined : 'grayscale(80%)',
                transition: 'opacity 0.2s ease, filter 0.2s ease',
              }
            : {}),
        },
      };
    });
  }, [nodes, spotlightActive, spotlightTargetId, spotlightResult, isReadOnly]);

  // 映射聚光灯走查及断键悬停下的连线样式
  const displayEdges = useMemo(() => {
    if (!spotlightResult && !hoveredEdgeForInsert) return edges;
    const edgeIds = spotlightResult?.edgeIds;

    return edges.map((edge) => {
      const isHovered = hoveredEdgeForInsert?.edgeId === edge.id;
      if (isHovered) {
        return {
          ...edge,
          animated: true,
          style: {
            ...edge.style,
            stroke: '#6366f1',
            strokeWidth: 3,
            strokeDasharray: '6,6',
          },
        };
      }

      if (spotlightResult) {
        const isHighlighted = edgeIds ? edgeIds.has(edge.id) : true;
        const dimOthers = spotlightActive;
        return {
          ...edge,
          animated: isHighlighted,
          interactionWidth: dimOthers && !isHighlighted ? 0 : undefined,
          style: {
            ...edge.style,
            opacity: dimOthers ? (isHighlighted ? 1 : 0.15) : 1,
            pointerEvents: dimOthers && !isHighlighted ? 'none' : undefined,
            stroke: isHighlighted ? 'var(--fs-selection-ring, #2563eb)' : edge.style?.stroke,
            strokeWidth: isHighlighted ? 2.5 : edge.style?.strokeWidth ?? 1.5,
            transition: 'opacity 0.2s ease',
          },
        };
      }

      return edge;
    });
  }, [edges, spotlightResult, spotlightActive, hoveredEdgeForInsert]);

  const lastCursorBroadcastRef = useRef(0);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!collab) return;

      const now = performance.now();
      if (now - lastCursorBroadcastRef.current < CURSOR_BROADCAST_INTERVAL_MS) return;
      lastCursorBroadcastRef.current = now;

      collab.broadcastCursor(screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    },
    [collab, screenToFlowPosition]
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredEdgeForInsert(null);
    if (!collab) return;
    lastCursorBroadcastRef.current = 0;
    collab.broadcastCursor(null);
  }, [collab]);

  /** 视口缩放随 pan/zoom 变化，对齐感应半径需要据此换算，并向协同者广播视口 */
  const handleViewportMove = useCallback(
    (_event: unknown, viewport: { x: number; y: number; zoom: number }) => {
      useFlowStore.getState().setViewportZoom(viewport.zoom);
      collab?.broadcastViewport?.(viewport);
    },
    [collab]
  );

  /** 用户主动平移/拖动画布时自动退出主讲人视角跟随 */
  const handleMoveStart = useCallback(
    (event: unknown) => {
      if (event && followingUserId) {
        setFollowingUser(null);
      }
    },
    [followingUserId, setFollowingUser]
  );

  // 按住 Alt 期间临时关闭智能对齐吸附，回到逐像素自由落点
  useEffect(() => {
    const handleAltKey = (e: KeyboardEvent) => {
      if (e.key !== 'Alt') return;
      setAlignmentSnapEnabled(e.type !== 'keydown');
    };
    const restoreSnap = () => setAlignmentSnapEnabled(true);

    window.addEventListener('keydown', handleAltKey);
    window.addEventListener('keyup', handleAltKey);
    window.addEventListener('blur', restoreSnap);

    return () => {
      window.removeEventListener('keydown', handleAltKey);
      window.removeEventListener('keyup', handleAltKey);
      window.removeEventListener('blur', restoreSnap);
    };
  }, [setAlignmentSnapEnabled]);


  // 内存剪贴板（用于 Ctrl+C / Ctrl+V 节点快捷复制粘贴）
  const clipboardRef = useRef<FlowNode[]>([]);

  // 连线模式下的暂存起始源节点 ID
  const [connectSourceNodeId, setConnectSourceNodeId] = useState<string | null>(null);

  // 当工具模式切出连线模式时，清理暂存状态
  useEffect(() => {
    if (activeTool !== 'connect') {
      setConnectSourceNodeId(null);
    }
  }, [activeTool]);

  /**
   * 画布拖拽经过处理器：允许放置操作，并实时检测光标是否在连线感应区内以呈现断键插入浮标
   */
  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (isReadOnly) return;
      e.preventDefault();
      const types = Array.from(e.dataTransfer.types);
      if (types.includes('application/flowstudio-template-id')) {
        e.dataTransfer.dropEffect = 'copy';
      } else {
        e.dataTransfer.dropEffect = 'move';
      }

      const flowPosition = screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });

      const currentEdges = useFlowStore.getState().edges;
      const currentNodes = useFlowStore.getState().nodes;
      const hitResult = findEdgeAtPosition(currentEdges, currentNodes, flowPosition, 20);

      if (hitResult) {
        setHoveredEdgeForInsert({ edgeId: hitResult.edge.id, point: flowPosition });
      } else {
        setHoveredEdgeForInsert(null);
      }
    },
    [screenToFlowPosition]
  );

  /**
   * 画布拖拽放置处理器：将图元落点转换为画布坐标并按光标居中生成节点；
   * 若落点在连线上则自动触发断键串接与下游智能顺推
   */
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (isReadOnly) return;
      e.preventDefault();
      e.stopPropagation();

      // 1. 优先识别业务模板拖拽放置 (Drag Template)
      const templateId = e.dataTransfer.getData('application/flowstudio-template-id');
      if (templateId) {
        const template = TEMPLATES_REGISTRY.find((t) => t.id === templateId);
        if (template) {
          const flowPosition = screenToFlowPosition({
            x: e.clientX,
            y: e.clientY,
          });
          const activeThemeId = useSidebarStore.getState().activeThemeId;
          const currentTheme = getThemePreset(activeThemeId);
          const instance = instantiateTemplate(template, currentTheme, flowPosition);

          appendSubgraph(instance.nodes, instance.edges);
          setSelectedNodes(instance.nodes.map((n) => n.id));
          setSelectedEdge(null);
          setHoveredEdgeForInsert(null);
          return;
        }
      }

      const rawType = e.dataTransfer.getData('application/flowstudio-node-type');
      if (!isFlowNodeType(rawType)) {
        setHoveredEdgeForInsert(null);
        return;
      }

      // 将光标所在屏幕物理视口坐标换算为 React Flow 画布世界绝对坐标
      const flowPosition = screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });

      // 根据节点预设尺寸进行中心对称偏移，落点不做栅格约束
      const defaultSize = getDefaultNodeSize(rawType);
      const centeredPosition = {
        x: flowPosition.x - defaultSize.width / 2,
        y: flowPosition.y - defaultSize.height / 2,
      };

      // 2. 检查落点是否落在连线上：非 pool 容器节点触发断键插入与顺推
      const currentEdges = useFlowStore.getState().edges;
      const currentNodes = useFlowStore.getState().nodes;
      const hitResult =
        rawType !== 'pool' ? findEdgeAtPosition(currentEdges, currentNodes, flowPosition, 24) : null;

      if (hitResult) {
        const newNode = createNodeFromType(rawType, centeredPosition);
        const { nextNodes, nextEdges } = splitEdgeAndInsertNode({
          nodes: currentNodes,
          edges: currentEdges,
          targetEdge: hitResult.edge,
          newNode,
          safetyGap: 60,
        });
        setDiagram(nextNodes, nextEdges);
        setSelectedNodes([newNode.id]);
        setSelectedEdge(null);
        setHoveredEdgeForInsert(null);
        return;
      }

      setHoveredEdgeForInsert(null);

      if (rawType === 'pool') {
        // 拖入泳道池时自动附带生成两条初始子泳道
        const poolId = generateUniqueId('pool');
        const lane1Id = `lane-${Date.now().toString(36)}-1`;
        const lane2Id = `lane-${Date.now().toString(36)}-2`;

        const poolNode: FlowNode = {
          id: poolId,
          type: 'pool',
          position: centeredPosition,
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

        addNodes([poolNode, lane1Node, lane2Node]);
        setSelectedNodes([poolId]);
        setSelectedEdge(null);
        return;
      }

      // 添加常规节点至全局 Store 并自动设为唯一激活选中节点
      const newNode = addNode(rawType, centeredPosition);
      if (newNode?.id) {
        setSelectedNodes([newNode.id]);
        setSelectedEdge(null);
      }
    },
    [
      screenToFlowPosition,
      addNode,
      addNodes,
      appendSubgraph,
      setDiagram,
      setSelectedNodes,
      setSelectedEdge,
    ]
  );

  /**
   * 连线点击事件处理器：激活连线属性模式，并清空所有节点选中状态；
   * 选中后自动触发链路走查
   */
  const handleEdgeClick = useCallback(
    (event: React.MouseEvent, edge: { id: string }) => {
      setSelectedNodes([]);
      setSelectedEdge(edge.id);
      setConnectSourceNodeId(null);

      if (event.altKey) {
        toggleSpotlightMode(true);
        setSpotlightTarget(edge.id, 'all');
      }
    },
    [setSelectedNodes, setSelectedEdge, toggleSpotlightMode, setSpotlightTarget]
  );

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: { nodes: FlowNode[]; edges: FlowEdge[] }) => {
      const nodeIds = selectedNodes.map((n) => n.id);
      setSelectedNodes(nodeIds);
      if (selectedEdges.length > 0) {
        setSelectedEdge(selectedEdges[0].id);
      } else if (nodeIds.length > 0) {
        setSelectedEdge(null);
      }
    },
    [setSelectedNodes, setSelectedEdge]
  );

  const handleConnect = useCallback(
    (connection: any) => {
      setConnectSourceNodeId(null);
      onConnect(connection);
    },
    [onConnect]
  );

  const handleConnectStart = useCallback(() => {
    setConnectSourceNodeId(null);
  }, []);

  /**
   * 节点点击事件处理器：
   * - 支持 Alt + Click 开启因果链路聚光灯走查
   * - 聚光灯模式下点击直接聚焦该节点因果链路
   * - 选择/常规模式：清空连线选中状态，确保属性面板专注呈现节点属性
   * - 连线模式：两两点击节点直接建立正交连线，并高亮反馈
   */
  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: { id: string }) => {
      setSelectedEdge(null);

      if (event.altKey) {
        toggleSpotlightMode(true);
        setSpotlightTarget(node.id, 'all');
        setSelectedNodes([node.id]);
        return;
      }

      if (activeTool === 'connect') {
        if (!connectSourceNodeId) {
          setConnectSourceNodeId(node.id);
          setSelectedNodes([node.id]);
        } else if (connectSourceNodeId !== node.id) {
          onConnect({
            source: connectSourceNodeId,
            target: node.id,
            sourceHandle: null,
            targetHandle: null,
          });
          setConnectSourceNodeId(null);
          setSelectedNodes([node.id]);
        } else {
          // 再次点击相同节点取消源标记
          setConnectSourceNodeId(null);
          setSelectedNodes([]);
        }
      } else {
        setSelectedNodes([node.id]);
      }
    },
    [
      activeTool,
      connectSourceNodeId,
      onConnect,
      setSelectedNodes,
      setSelectedEdge,
      toggleSpotlightMode,
      setSpotlightTarget,
    ]
  );

  /**
   * 节点拖拽松手事件处理器：
   * 1. 若移动孤立节点（无连线节点）至连线上，自动触发断键串接
   * 2. 执行泳道吸附、坐标转换与容器尺寸自动扩充
   */
  const handleNodeDragStop = useCallback(
    (_event: any, node: any) => {
      const store = useFlowStore.getState();
      const isConnected = store.edges.some((e) => e.source === node.id || e.target === node.id);
      const isContainer = ['pool', 'lane', 'group'].includes(node.type ?? '');

      if (!isConnected && !isContainer) {
        const targetNode = store.nodes.find((n) => n.id === node.id);
        if (targetNode) {
          const byId = new Map(store.nodes.map((n) => [n.id, n]));
          const worldPos = getNodeWorldPosition(targetNode, byId);
          const centerPos = {
            x: worldPos.x + (targetNode.width ?? 120) / 2,
            y: worldPos.y + (targetNode.height ?? 60) / 2,
          };
          const hitResult = findEdgeAtPosition(store.edges, store.nodes, centerPos, 24);
          if (hitResult) {
            const { nextNodes, nextEdges } = splitEdgeAndInsertNode({
              nodes: store.nodes,
              edges: store.edges,
              targetEdge: hitResult.edge,
              newNode: targetNode,
              safetyGap: 60,
            });
            store.setDiagram(nextNodes, nextEdges);
            return;
          }
        }
      }

      const { updated, nextNodes } = handleNodeDragNesting(node.id, store.nodes);
      if (updated) {
        store.setDiagram(nextNodes, store.edges);
      }
    },
    []
  );

  /**
   * 画布空白区域点击事件处理器：清空所有节点与连线选中态及连线源状态
   */
  const handlePaneClick = useCallback(() => {
    setSelectedNodes([]);
    setSelectedEdge(null);
    setConnectSourceNodeId(null);
    setHoveredEdgeForInsert(null);
    if (spotlightTargetId) {
      toggleSpotlightMode(false);
      setSpotlightTarget(null);
    }
  }, [setSelectedNodes, setSelectedEdge, spotlightTargetId, toggleSpotlightMode, setSpotlightTarget]);

  const handleCanvasPointerDownCapture = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }
    canvasContainerRef.current?.focus({ preventScroll: true });
  }, []);

  // 画布聚焦中按住空格临时切换为平移交互，按住 Shift 临时切换连线类型，松开恢复原状态
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setShiftPressed(true);
      }
      if (e.code !== 'Space' || isPresenting) return;
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (isInput) return;

      e.preventDefault();
      if (!e.repeat) {
        setSpacePanning(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setShiftPressed(false);
      }
      if (e.code === 'Space') {
        setSpacePanning(false);
      }
    };

    const handleWindowBlur = () => {
      setSpacePanning(false);
      setShiftPressed(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
      setSpacePanning(false);
      setShiftPressed(false);
    };
  }, [isPresenting, setSpacePanning, setShiftPressed]);

  // 绑定全局高频快捷键 (Ctrl+G, Ctrl+Shift+G, Delete, Ctrl+Z, Ctrl+Shift+Z)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 避免干扰内联输入框等表单交互
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (isInput) {
        return;
      }

      const isMac =
        typeof navigator !== 'undefined' &&
        /Mac|iPod|iPhone|iPad/.test(navigator.platform);
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      if (isReadOnly) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          return;
        }
        if (modKey && (e.key === 'v' || e.key === 'V' || e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y' || e.key === 'g' || e.key === 'G')) {
          e.preventDefault();
          return;
        }
      }

      // 成组 (Ctrl+G) 与解散组合 (Ctrl+Shift+G)
      if (modKey && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        if (e.shiftKey) {
          ungroupNodes();
        } else {
          const { nodes: currentNodes, selectedNodeIds: currentSelectedIds } = useFlowStore.getState();
          const selected = currentNodes.filter((n) => currentSelectedIds.includes(n.id) || n.selected);
          if (selected.length < 2) {
            useFlowStore.getState().showToast('成组至少需选择 2 个图元');
            return;
          }
          groupSelectedNodes({ asFrame: false });
        }
        return;
      }

      // 全选所有节点 (Ctrl+A / Cmd+A)
      if (modKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        const currentNodes = useFlowStore.getState().nodes;
        setSelectedNodes(currentNodes.map((n) => n.id));
        setSelectedEdge(null);
        return;
      }

      // 复制选中节点至内存剪贴板 (Ctrl+C / Cmd+C)
      if (modKey && (e.key === 'c' || e.key === 'C')) {
        const { nodes: currentNodes, selectedNodeIds: currentSelectedIds } =
          useFlowStore.getState();
        const selected = currentNodes.filter(
          (n) => currentSelectedIds.includes(n.id) || n.selected
        );
        if (selected.length > 0) {
          e.preventDefault();
          clipboardRef.current = JSON.parse(JSON.stringify(selected));
        }
        return;
      }

      // 粘贴剪贴板中的节点 (Ctrl+V / Cmd+V)
      if (modKey && (e.key === 'v' || e.key === 'V')) {
        if (clipboardRef.current && clipboardRef.current.length > 0) {
          e.preventDefault();
          // 为克隆图元生成全新唯一 ID，并保留/重映射内部成组父子层级关系
          const idMap = new Map<string, string>();
          clipboardRef.current.forEach((n) => {
            idMap.set(n.id, generateUniqueId(n.type));
          });

          const clonedNodes: FlowNode[] = clipboardRef.current.map((n) => {
            const newId = idMap.get(n.id)!;
            const newParentId =
              n.parentId && idMap.has(n.parentId)
                ? idMap.get(n.parentId)
                : n.parentId;

            return {
              ...JSON.parse(JSON.stringify(n)),
              id: newId,
              parentId: newParentId,
              position: {
                x: n.position.x + 20,
                y: n.position.y + 20,
              },
              selected: true,
            };
          });

          // 更新剪贴板引用坐标以便连续多次粘贴依次偏移
          clipboardRef.current = clonedNodes;
          addNodes(clonedNodes);
          return;
        }
      }

      // 循环切换节点锚定锁模式 (Ctrl+L / Cmd+L)
      if (modKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        useFlowStore.getState().toggleSelectedLockMode();
        return;
      }

      // 撤销 (Ctrl+Z) 与重做 (Ctrl+Shift+Z / Ctrl+Y)
      if (modKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      if (modKey && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redo();
        return;
      }

      // 批量删除与 Shift 愈合式删除
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const { nodes: curNodes, edges: curEdges, selectedNodeIds: curSel } =
          useFlowStore.getState();

        const hasFullLocked = curNodes.some(
          (n) => curSel.includes(n.id) && isNodeLocked(n, 'delete')
        );
        const hasProtectedContainer = curNodes.some((n) => {
          if (!curSel.includes(n.id) || !['pool', 'lane', 'group'].includes(n.type ?? '')) return false;
          const findLockedDescendant = (parentId: string): boolean => {
            return curNodes.some((child) => child.parentId === parentId && (isNodeLocked(child, 'delete') || findLockedDescendant(child.id)));
          };
          return findLockedDescendant(n.id);
        });

        if (hasFullLocked) {
          useFlowStore.getState().showToast('选中的节点已完全锁定，禁止删除');
        } else if (hasProtectedContainer) {
          useFlowStore.getState().showToast('该泳道内包含锁定的节点，禁止删除');
        }

        if (e.shiftKey) {
          if (curSel.length === 1) {
            const healRes = healOnDelete(curSel[0], curNodes, curEdges);
            if (healRes.canHeal) {
              useFlowStore.getState().setDiagram(healRes.nextNodes, healRes.nextEdges);
              setSelectedNodes([]);
              setSelectedEdge(null);
              return;
            }
          }
        }
        deleteSelected();
        return;
      }

      // 取消连线模式、退出聚光灯或清空选中 (Escape)
      if (e.key === 'Escape') {
        e.preventDefault();
        if (spotlightActive) {
          toggleSpotlightMode(false);
          setSpotlightTarget(null);
        }
        if (connectSourceNodeId) {
          setConnectSourceNodeId(null);
          setActiveTool('select');
          setSelectedNodes([]);
          setSelectedEdge(null);
        } else if (activeTool === 'connect') {
          setActiveTool('select');
          setSelectedNodes([]);
          setSelectedEdge(null);
        } else {
          setSelectedNodes([]);
          setSelectedEdge(null);
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    groupSelectedNodes,
    ungroupNodes,
    deleteSelected,
    undo,
    redo,
    addNodes,
    connectSourceNodeId,
    activeTool,
    setActiveTool,
    setSelectedNodes,
    setSelectedEdge,
    spotlightActive,
    toggleSpotlightMode,
    setSpotlightTarget,
    isReadOnly,
  ]);

  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      if (isReadOnly) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable || target.closest('input, textarea, [contenteditable="true"]'))) return;
      const text = e.clipboardData?.getData('text/plain')?.trim();
      if (!text) return;
      if (/^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram)\b/i.test(text) || (text.includes('-->') && (text.includes('subgraph') || text.includes('[')))) {
        try {
          const curNodes = useFlowStore.getState().nodes;
          const curEdges = useFlowStore.getState().edges;
          const diffResult = diffMermaidToOps(text, curNodes, curEdges);
          if (diffResult.ops.length > 0) {
            e.preventDefault();
            const { addedNodes, addedEdges } = useFlowStore.getState().applyMermaidOps(diffResult.ops);
            useFlowStore.getState().showToast(`剪贴板已智能识别 Mermaid：新增 ${addedNodes} 节点、${addedEdges} 连线`);
            return;
          }
        } catch {}
      }
      if (/<mxfile|<mxGraphModel/i.test(text)) {
        try {
          e.preventDefault();
          const res = await parseDrawioXml(text);
          if (res.nodes.length > 0) {
            useFlowStore.getState().appendSubgraph(res.nodes, res.edges);
            useFlowStore.getState().showToast(`剪贴板已智能识别 Draw.io：导入 ${res.nodes.length} 个节点`);
            return;
          }
        } catch {}
      }
      if (/<(?:bpmn:)?definitions/i.test(text) && /<process/i.test(text)) {
        try {
          e.preventDefault();
          const res = parseBpmnXml(text);
          if (res.nodes.length > 0) {
            useFlowStore.getState().appendSubgraph(res.nodes, res.edges);
            useFlowStore.getState().showToast(`剪贴板已智能识别 BPMN：导入 ${res.nodes.length} 个节点`);
            return;
          }
        } catch {}
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isReadOnly]);

  // 获取当前正在跟随的主讲人信息
  const followingUser = useMemo(() => {
    if (!followingUserId || !collab?.remoteUsers) return null;
    return collab.remoteUsers.find((u) => u.clientId === followingUserId) ?? null;
  }, [followingUserId, collab?.remoteUsers]);

  const effectivePanMode = isSpacePanning || isReadOnly || activeTool === 'pan';
  const effectiveConnectMode = isShiftPressed
    ? edgeConnectMode === 'orthogonal'
      ? 'straight'
      : 'orthogonal'
    : edgeConnectMode;

  // 根据当前激活的工具模式配置画布专属光标
  const cursorClass =
    isSpacePanning || activeTool === 'pan'
      ? 'fs-cursor-pan'
      : activeTool === 'connect'
      ? 'fs-cursor-connect'
      : '';

  return (
    <div
      ref={canvasContainerRef}
      tabIndex={-1}
      onPointerDownCapture={handleCanvasPointerDownCapture}
      className={`w-full h-full relative overflow-hidden outline-none bg-[var(--fs-canvas-bg)] ${cursorClass}`}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <CollaborativeCursors />
      <AiBatchBanner diagramId={collab?.diagramId} onToast={showToast} />

      {/* 全局轻提示 Toast */}
      {toastMessage && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-slate-900/95 text-white text-xs font-medium rounded-xl shadow-2xl border border-slate-700/80 backdrop-blur-md animate-in fade-in slide-in-from-top-2">
          {toastMessage}
        </div>
      )}

      {/* 主讲人视角跟随浮层指示条 */}
      {followingUser && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-4 py-1.5 bg-blue-600/90 text-white text-xs font-medium rounded-full shadow-lg backdrop-blur-md border border-blue-400/30">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
          </span>
          <span>
            正在跟随 <b>{followingUser.nickname}</b> 的视角
          </span>
          <button
            onClick={() => setFollowingUser(null)}
            className="ml-1 text-[11px] bg-white/20 hover:bg-white/30 px-2 py-0.5 rounded-full transition-colors cursor-pointer"
          >
            退出跟随
          </button>
        </div>
      )}

      {/* 聚光灯决策节点分支单选筛选胶囊 */}
      {spotlightActive && effectiveSpotlightTargetId && decisionBranches.length > 0 && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1.5 p-1 bg-slate-900/85 text-white rounded-full shadow-xl border border-slate-700/60 backdrop-blur-md">
          <span className="text-[11px] font-medium text-slate-300 pl-2.5 pr-1">因果分支:</span>
          <button
            key="all"
            onClick={() => setSpotlightTarget(effectiveSpotlightTargetId, 'all')}
            className={`px-2.5 py-1 text-xs rounded-full transition-all cursor-pointer ${
              spotlightBranchFilter === 'all' || !spotlightBranchFilter
                ? 'bg-blue-600 text-white font-semibold shadow-sm'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            全部分支
          </button>
          {decisionBranches.map((label) => {
            const isSelected = spotlightBranchFilter === label;
            return (
              <button
                key={label}
                onClick={() => setSpotlightTarget(effectiveSpotlightTargetId, label)}
                className={`px-2.5 py-1 text-xs rounded-full transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-blue-600 text-white font-semibold shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                仅看[{label}]
              </button>
            );
          })}
          <button
            onClick={() => {
              setSelectedNodes([]);
              setSelectedEdge(null);
              toggleSpotlightMode(false);
              setSpotlightTarget(null);
            }}
            className="ml-1 text-slate-400 hover:text-white p-1 rounded-full hover:bg-slate-800 cursor-pointer"
            title="退出链路走查 (Esc)"
          >
            ✕
          </button>
        </div>
      )}

      <ReactFlow
        nodes={displayNodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        deleteKeyCode={null}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onSelectionChange={handleSelectionChange}
        onConnect={handleConnect}
        onConnectStart={handleConnectStart}
        onEdgeClick={handleEdgeClick}
        onEdgeDoubleClick={(_e, edge) => {
          if (isReadOnly) return;
          setSelectedNodes([]);
          setSelectedEdge(edge.id);
          useFlowStore.getState().setEditingEdgeLabelId(edge.id);
        }}
        onNodeClick={handleNodeClick}
        onNodeDragStop={handleNodeDragStop}
        onMove={handleViewportMove}
        onMoveStart={handleMoveStart}
        onPaneClick={handlePaneClick}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        panOnDrag={effectivePanMode ? [0, 1, 2] : [1, 2]}
        panOnScroll={effectivePanMode}
        nodesDraggable={!isSpacePanning && !isReadOnly && activeTool === 'select'}
        elementsSelectable={!isSpacePanning && activeTool === 'select'}
        nodesConnectable={!isSpacePanning && !isReadOnly && activeTool !== 'pan'}
        connectionRadius={35}
        selectionMode={SelectionMode.Partial}
        selectionOnDrag={!isSpacePanning && !isReadOnly && activeTool === 'select'}
        connectionMode={ConnectionMode.Loose}
        connectionLineType={
          effectiveConnectMode === 'straight'
            ? ConnectionLineType.Straight
            : ConnectionLineType.SmoothStep
        }
        connectionLineStyle={{
          stroke: 'var(--fs-selection-ring, #2563eb)',
          strokeWidth: 2,
          strokeDasharray: '4,4',
        }}
        isValidConnection={(connection) =>
          Boolean(connection.source && connection.target && connection.source !== connection.target)
        }
        defaultEdgeOptions={{
          type: 'orthogonal',
          markerEnd: { type: MarkerType.ArrowClosed },
        }}
        elevateEdgesOnSelect={false}
        fitView
        minZoom={0.1}
        maxZoom={2.5}
        className={`w-full h-full ${cursorClass}`}
      >
        {/* 点阵网格背景 */}
        <Background
          gap={DEFAULT_SNAP_GRID[0]}
          size={1}
          color="var(--fs-canvas-dot)"
        />

        {/* 悬停断键插入浮标 */}
        <ViewportPortal>
          {hoveredEdgeForInsert && (
            <div
              style={{
                position: 'absolute',
                transform: `translate(${hoveredEdgeForInsert.point.x}px, ${hoveredEdgeForInsert.point.y}px) translate(-50%, -50%)`,
                pointerEvents: 'none',
              }}
              className="z-50 flex items-center gap-1.5 px-3 py-1 bg-indigo-600 text-white text-xs font-semibold rounded-full shadow-lg ring-2 ring-white/40 animate-pulse"
            >
              <span className="text-base font-bold leading-none">+</span>
              <span>插入步骤</span>
            </div>
          )}
        </ViewportPortal>

        {/* AI 批次画布级 Visual Diff 染色与单点 Cherry-Pick 审阅台 */}
        {!isPresenting && <AiBatchDiffOverlay />}

        {/* 历史版本快照 Visual Diff 染色覆盖层 */}
        {!isPresenting && <SnapshotDiffOverlay />}

        {/* 拖拽智能对齐参考线 */}
        {!isPresenting && !isReadOnly && <AlignmentGuides />}

        {/* 多选与组合悬浮操作条 */}
        {!isPresenting && !isReadOnly && <ContextualActionBar />}

        {/* 左下角视口辅助缩放与小地图控件 */}
        {!isPresenting && <CanvasControls />}

        {/* 底部居中悬浮主工具栏 */}
        {!isPresenting && !isReadOnly && <FloatingToolbar />}

        {/* 画布协同批注图钉层与评论讨论串 */}
        {!isPresenting && <CommentsLayer />}

        {/* 评审模式右侧顺序跳转抽屉 */}
        {!isPresenting && <ReviewDrawer />}
      </ReactFlow>

      {/* 历史版本 Visual Diff 差异清单侧边栏 */}
      {!isPresenting && <SnapshotDiffSidebar />}

      {/* 动态安全防泄密水印图层 */}
      <WatermarkLayer />

      {/* 全屏故事板演讲演示控制台 */}
      <PresentationControls />
    </div>
  );
};

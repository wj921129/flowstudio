/**
 * @fileoverview 主画布容器组件 (FlowCanvas)
 * @description 组装 React Flow 视口，集成 15px 网格吸附、橡皮筋框选、全局快捷键、正交连线与就地浮动工具条
 */

import React, { useEffect, useCallback, useState, useRef } from 'react';
import {
  ReactFlow,
  Background,
  SelectionMode,
  ConnectionMode,
  MarkerType,
  useReactFlow,
} from '@xyflow/react';
import {
  DEFAULT_SNAP_GRID,
  isFlowNodeType,
  getDefaultNodeSize,
  type FlowNode,
} from '@flowstudio/shared';
import { snapPositionToGrid, generateUniqueId } from '../../lib/node-utils';
import { useFlowStore } from '../../stores/flow-store';
import { nodeTypes } from './custom-nodes';
import { edgeTypes } from './custom-edges';
import { ContextualActionBar } from './floating-toolbar/contextual-action-bar';
import { CanvasControls } from './canvas-controls';
import { FloatingToolbar } from '../toolbar/floating-toolbar';

export const FlowCanvas: React.FC = () => {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const activeTool = useFlowStore((s) => s.activeTool);
  const onNodesChange = useFlowStore((s) => s.onNodesChange);
  const onEdgesChange = useFlowStore((s) => s.onEdgesChange);
  const onConnect = useFlowStore((s) => s.onConnect);
  const addNode = useFlowStore((s) => s.addNode);
  const addNodes = useFlowStore((s) => s.addNodes);
  const setSelectedNodes = useFlowStore((s) => s.setSelectedNodes);
  const setSelectedEdge = useFlowStore((s) => s.setSelectedEdge);
  const groupSelectedNodes = useFlowStore((s) => s.groupSelectedNodes);
  const ungroupNodes = useFlowStore((s) => s.ungroupNodes);
  const deleteSelected = useFlowStore((s) => s.deleteSelected);
  const undo = useFlowStore((s) => s.undo);
  const redo = useFlowStore((s) => s.redo);
  const setActiveTool = useFlowStore((s) => s.setActiveTool);

  const { screenToFlowPosition } = useReactFlow();

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
   * 画布拖拽经过处理器：允许放置操作并指明 move 移动意图
   */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  /**
   * 画布拖拽放置处理器：将图元落点转换为画布坐标，居中并网格吸附后生成节点并自动选中
   */
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const rawType = e.dataTransfer.getData('application/flowstudio-node-type');
      if (!isFlowNodeType(rawType)) {
        return;
      }

      // 将光标所在屏幕物理视口坐标换算为 React Flow 画布世界绝对坐标
      const flowPosition = screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });

      // 根据节点预设尺寸进行中心对称偏移
      const defaultSize = getDefaultNodeSize(rawType);
      const centeredPosition = {
        x: flowPosition.x - defaultSize.width / 2,
        y: flowPosition.y - defaultSize.height / 2,
      };

      // 吸附至 15px 栅格网格步长
      const snappedPosition = snapPositionToGrid(centeredPosition, DEFAULT_SNAP_GRID);

      // 添加节点至全局 Store 并自动设为唯一激活选中节点
      const newNode = addNode(rawType, snappedPosition);
      if (newNode?.id) {
        setSelectedNodes([newNode.id]);
        setSelectedEdge(null);
      }
    },
    [screenToFlowPosition, addNode, setSelectedNodes, setSelectedEdge]
  );

  /**
   * 连线点击事件处理器：激活连线属性模式，并清空所有节点选中状态
   */
  const handleEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: { id: string }) => {
      setSelectedNodes([]);
      setSelectedEdge(edge.id);
      setConnectSourceNodeId(null);
    },
    [setSelectedNodes, setSelectedEdge]
  );

  /**
   * 节点点击事件处理器：
   * - 选择/常规模式：清空连线选中状态，确保属性面板专注呈现节点属性
   * - 连线模式：两两点击节点直接建立正交连线，并高亮反馈
   */
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: { id: string }) => {
      setSelectedEdge(null);

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
      }
    },
    [activeTool, connectSourceNodeId, onConnect, setSelectedNodes, setSelectedEdge]
  );

  /**
   * 画布空白区域点击事件处理器：清空所有节点与连线选中态及连线源状态
   */
  const handlePaneClick = useCallback(() => {
    setSelectedNodes([]);
    setSelectedEdge(null);
    setConnectSourceNodeId(null);
  }, [setSelectedNodes, setSelectedEdge]);

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

      // 成组 (Ctrl+G) 与解散组合 (Ctrl+Shift+G)
      if (modKey && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        if (e.shiftKey) {
          ungroupNodes();
        } else {
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

      // 批量删除
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected();
        return;
      }

      // 取消连线模式或清空选中 (Escape)
      if (e.key === 'Escape') {
        e.preventDefault();
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
  ]);

  // 根据当前激活的工具模式配置画布专属光标
  const cursorClass =
    activeTool === 'pan'
      ? 'cursor-grab active:cursor-grabbing [&_.react-flow__pane]:cursor-grab [&_.react-flow__pane:active]:cursor-grabbing'
      : activeTool === 'connect'
      ? 'cursor-crosshair [&_.react-flow__pane]:cursor-crosshair [&_.react-flow__node]:cursor-crosshair'
      : '';

  return (
    <div
      className={`w-full h-full relative overflow-hidden bg-[var(--fs-canvas-bg)] ${cursorClass}`}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        deleteKeyCode={null}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgeClick={handleEdgeClick}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        panOnDrag={activeTool === 'pan' ? [0, 1, 2] : [1, 2]}
        panOnScroll={activeTool === 'pan'}
        nodesDraggable={activeTool === 'select'}
        elementsSelectable={activeTool === 'select'}
        snapToGrid={true}
        snapGrid={DEFAULT_SNAP_GRID}
        selectionMode={SelectionMode.Partial}
        connectionMode={ConnectionMode.Loose}
        defaultEdgeOptions={{
          type: 'orthogonal',
          markerEnd: { type: MarkerType.ArrowClosed },
        }}
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

        {/* 多选与组合悬浮操作条 */}
        <ContextualActionBar />

        {/* 左下角视口辅助缩放与小地图控件 */}
        <CanvasControls />

        {/* 底部居中悬浮主工具栏 */}
        <FloatingToolbar />
      </ReactFlow>
    </div>
  );
};

/**
 * @fileoverview 主画布容器组件 (FlowCanvas)
 * @description 组装 React Flow 视口，集成 15px 网格吸附、橡皮筋框选、全局快捷键、正交连线与就地浮动工具条
 */

import React, { useEffect, useCallback } from 'react';
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
} from '@flowstudio/shared';
import { snapPositionToGrid } from '../../lib/node-utils';
import { useFlowStore } from '../../stores/flow-store';
import { nodeTypes } from './custom-nodes';
import { edgeTypes } from './custom-edges';
import { ContextualActionBar } from './floating-toolbar/contextual-action-bar';
import { CanvasControls } from './canvas-controls';

export const FlowCanvas: React.FC = () => {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const onNodesChange = useFlowStore((s) => s.onNodesChange);
  const onEdgesChange = useFlowStore((s) => s.onEdgesChange);
  const onConnect = useFlowStore((s) => s.onConnect);
  const addNode = useFlowStore((s) => s.addNode);
  const setSelectedNodes = useFlowStore((s) => s.setSelectedNodes);
  const groupSelectedNodes = useFlowStore((s) => s.groupSelectedNodes);
  const ungroupNodes = useFlowStore((s) => s.ungroupNodes);
  const deleteSelected = useFlowStore((s) => s.deleteSelected);
  const undo = useFlowStore((s) => s.undo);
  const redo = useFlowStore((s) => s.redo);

  const { screenToFlowPosition } = useReactFlow();

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
      }
    },
    [screenToFlowPosition, addNode, setSelectedNodes]
  );

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
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [groupSelectedNodes, ungroupNodes, deleteSelected, undo, redo]);

  return (
    <div
      className="w-full h-full relative overflow-hidden bg-[var(--fs-canvas-bg)]"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
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
        className="w-full h-full"
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
      </ReactFlow>
    </div>
  );
};

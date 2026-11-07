/**
 * @fileoverview 主画布容器组件 (FlowCanvas)
 * @description 组装 React Flow 视口，集成 15px 网格吸附、橡皮筋框选、全局快捷键、正交连线与就地浮动工具条
 */

import React, { useEffect } from 'react';
import {
  ReactFlow,
  Background,
  SelectionMode,
} from '@xyflow/react';
import { DEFAULT_SNAP_GRID } from '@flowstudio/shared';
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
  const groupSelectedNodes = useFlowStore((s) => s.groupSelectedNodes);
  const ungroupNodes = useFlowStore((s) => s.ungroupNodes);
  const deleteSelected = useFlowStore((s) => s.deleteSelected);
  const undo = useFlowStore((s) => s.undo);
  const redo = useFlowStore((s) => s.redo);

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
    <div className="w-full h-full relative overflow-hidden bg-[var(--fs-canvas-bg)]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        snapToGrid={true}
        snapGrid={DEFAULT_SNAP_GRID}
        selectionMode={SelectionMode.Partial}
        defaultEdgeOptions={{
          type: 'orthogonal',
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

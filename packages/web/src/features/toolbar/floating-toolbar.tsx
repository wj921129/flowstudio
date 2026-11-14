/**
 * @fileoverview 画布主悬浮工具栏组件 (FloatingToolbar)
 * @description 采用毛玻璃质感置于画布底部居中，支持选择、平移、连线与便签模式切换、撤销重做历史控制与删除操作
 */

import React, { useEffect, useCallback } from 'react';
import { Panel, useReactFlow } from '@xyflow/react';
import {
  MousePointer2,
  Hand,
  ArrowUpRight,
  CornerDownRight,
  StickyNote,
  Undo2,
  Redo2,
  Trash2,
} from 'lucide-react';
import { getDefaultNodeSize } from '@flowstudio/shared';
import { useFlowStore } from '../../stores/flow-store';
import { ToolbarButton } from './toolbar-button';

export interface FloatingToolbarProps {
  /** 外部传入的附加样式类名 */
  className?: string;
}

export const FloatingToolbar: React.FC<FloatingToolbarProps> = ({ className = '' }) => {
  const activeTool = useFlowStore((s) => s.activeTool);
  const edgeConnectMode = useFlowStore((s) => s.edgeConnectMode);
  const isShiftPressed = useFlowStore((s) => s.isShiftPressed);
  const setActiveTool = useFlowStore((s) => s.setActiveTool);
  const setEdgeConnectMode = useFlowStore((s) => s.setEdgeConnectMode);
  const toggleEdgeConnectMode = useFlowStore((s) => s.toggleEdgeConnectMode);
  const displayEdgeMode = isShiftPressed
    ? edgeConnectMode === 'orthogonal'
      ? 'straight'
      : 'orthogonal'
    : edgeConnectMode;
  const canUndo = useFlowStore((s) => s.canUndo);
  const canRedo = useFlowStore((s) => s.canRedo);
  const undo = useFlowStore((s) => s.undo);
  const redo = useFlowStore((s) => s.redo);
  const deleteSelected = useFlowStore((s) => s.deleteSelected);
  const selectedNodeIds = useFlowStore((s) => s.selectedNodeIds);
  const selectedEdgeId = useFlowStore((s) => s.selectedEdgeId);
  const addNode = useFlowStore((s) => s.addNode);
  const setSelectedNodes = useFlowStore((s) => s.setSelectedNodes);
  const setSelectedEdge = useFlowStore((s) => s.setSelectedEdge);

  const { screenToFlowPosition } = useReactFlow();

  // 是否有图元被选中（用于判断删除按钮状态）
  const hasSelection = selectedNodeIds.length > 0 || Boolean(selectedEdgeId);

  /**
   * 快速在当前视口中心添加便签节点 (comment)
   */
  const handleAddNote = useCallback(() => {
    // 优先以 React Flow 主画布容器中心为锚点，降级采用窗口物理中心
    const canvasEl = document.querySelector('.react-flow');
    let screenCenter = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    if (canvasEl) {
      const rect = canvasEl.getBoundingClientRect();
      screenCenter = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    }

    const flowPos = screenToFlowPosition(screenCenter);
    const defaultSize = getDefaultNodeSize('comment');
    const centeredPos = {
      x: flowPos.x - defaultSize.width / 2,
      y: flowPos.y - defaultSize.height / 2,
    };

    const newNode = addNode('comment', centeredPos);
    if (newNode?.id) {
      setSelectedNodes([newNode.id]);
      setSelectedEdge(null);
    }
  }, [screenToFlowPosition, addNode, setSelectedNodes, setSelectedEdge]);

  const handleConnectToolToggle = useCallback(() => {
    if (activeTool !== 'connect') {
      setActiveTool('connect');
      setEdgeConnectMode('orthogonal');
    } else {
      toggleEdgeConnectMode();
    }
  }, [activeTool, setActiveTool, setEdgeConnectMode, toggleEdgeConnectMode]);

  // 绑定全局工具模式快捷键 (V: 选择, H: 漫游平移, C: 连线, T: 便签)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 避免输入框、文本域与富文本编辑被拦截
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (isInput) {
        return;
      }

      // 避免带修饰键（如 Ctrl/Cmd/Alt）时冲突
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        setActiveTool('select');
      } else if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        setActiveTool('pan');
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        handleConnectToolToggle();
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        handleAddNote();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setActiveTool, handleConnectToolToggle, handleAddNote]);

  return (
    <Panel
      position="bottom-center"
      className={`!mb-6 !mx-0 z-30 pointer-events-auto ${className}`}
    >
      <div
        className="nodrag nopan flex items-center gap-1 px-2.5 py-1.5 rounded-2xl backdrop-blur-md bg-fs-surface/85 border border-fs-border shadow-xl select-none text-fs-text transition-colors"
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* 工具模式组 */}
        <ToolbarButton
          icon={MousePointer2}
          label="选择与移动"
          shortcut="V"
          active={activeTool === 'select'}
          onClick={() => setActiveTool('select')}
        />
        <ToolbarButton
          icon={Hand}
          label="画布平移"
          shortcut="H"
          active={activeTool === 'pan'}
          onClick={() => setActiveTool('pan')}
        />
        <ToolbarButton
          icon={displayEdgeMode === 'straight' ? ArrowUpRight : CornerDownRight}
          label={
            displayEdgeMode === 'straight'
              ? '直线连线 (点击切折线 / Shift 临时切换)'
              : '折线连线 (点击切直线 / Shift 临时切换)'
          }
          shortcut="C"
          active={activeTool === 'connect'}
          onClick={handleConnectToolToggle}
        />
        <ToolbarButton
          icon={StickyNote}
          label="快速便签"
          shortcut="T"
          onClick={handleAddNote}
        />

        {/* 分隔线 */}
        <div className="w-px h-5 bg-fs-border mx-1 shrink-0" />

        {/* 历史记录组 */}
        <ToolbarButton
          icon={Undo2}
          label="撤销"
          shortcut="Ctrl+Z"
          disabled={!canUndo}
          onClick={undo}
        />
        <ToolbarButton
          icon={Redo2}
          label="重做"
          shortcut="Ctrl+Shift+Z"
          disabled={!canRedo}
          onClick={redo}
        />

        {/* 分隔线 */}
        <div className="w-px h-5 bg-fs-border mx-1 shrink-0" />

        {/* 快捷动作组 */}
        <ToolbarButton
          icon={Trash2}
          label="删除选中"
          shortcut="Delete"
          disabled={!hasSelection}
          danger
          onClick={deleteSelected}
        />
      </div>
    </Panel>
  );
};

/**
 * @fileoverview 基础图元通用外壳容器 (BaseNodeWrapper)
 * @description 统一封装 Handles 锚点生成、选中焦点环、双击内联文本编辑与设计令牌样式映射
 */

import React, { useState, useEffect, useRef } from 'react';
import { Handle, Position, NodeResizer, useConnection } from '@xyflow/react';
import type { FlowNodeData, FlowNodeType, HandlePosition } from '@flowstudio/shared';
import { getNodeRegistryEntry } from '@flowstudio/shared';
import { useFlowStore } from '../../../stores/flow-store';
import { useCollaboration } from '../../collaboration/collaboration-provider';


/**
 * 容器类图元：子节点坐标相对容器，缩放必须锚定对角，因此沿用各自组件内的 NodeResizer
 */
const CONTAINER_NODE_TYPES: FlowNodeType[] = ['pool', 'lane', 'group'];

/**
 * 锚点方向与 React Flow Position 枚举映射字典
 */
const POSITION_MAP: Record<HandlePosition, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

export interface BaseNodeWrapperProps {
  id: string;
  data: FlowNodeData;
  selected?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  /** 是否由子组件完全接管内部内容排版与文本展示 */
  customContent?: boolean;
  /** 自定义锚点方位，覆盖默认注册表配置 */
  customHandles?: HandlePosition[];
}

export const BaseNodeWrapper: React.FC<BaseNodeWrapperProps> = ({
  id,
  data,
  selected = false,
  className = '',
  style = {},
  children,
  customContent = false,
  customHandles,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [labelValue, setLabelValue] = useState(data.label || '');
  const inputRef = useRef<HTMLInputElement>(null);
  const collab = useCollaboration();

  const remoteSelector = collab?.remoteUsers.find((u) => (u.selectedNodeIds ?? []).includes(id));

  let isConnecting = false;
  try {
    const connection = useConnection();
    isConnecting = Boolean(connection?.inProgress);
  } catch {
    // 兼容可能无 ReactFlowProvider 包装的单测上下文
  }
  const activeTool = useFlowStore((s) => s.activeTool);
  const showHandles = isConnecting || activeTool === 'connect' || selected;
  const showResize = selected && activeTool === 'select' && !CONTAINER_NODE_TYPES.includes(data.type);

  const incomingHandleKeys = useFlowStore((s) => {
    const set = new Set<string>();
    const thisNode = s.nodes.find((n) => n.id === id);
    for (const edge of s.edges) {
      if (edge.target === id) {
        if (edge.targetHandle) {
          set.add(edge.targetHandle);
        } else {
          const srcNode = s.nodes.find((n) => n.id === edge.source);
          if (thisNode && srcNode) {
            const dx = thisNode.position.x - srcNode.position.x;
            const dy = thisNode.position.y - srcNode.position.y;
            if (Math.abs(dx) >= Math.abs(dy)) {
              set.add(dx >= 0 ? 'left' : 'right');
            } else {
              set.add(dy >= 0 ? 'top' : 'bottom');
            }
          } else {
            set.add('left');
            set.add('top');
          }
        }
      }
    }
    return Array.from(set).sort().join(',');
  });
  const incomingHandles = React.useMemo(
    () => new Set(incomingHandleKeys ? incomingHandleKeys.split(',') : []),
    [incomingHandleKeys]
  );

  // 当外部 data.label 变更且非编辑态时同步
  useEffect(() => {
    if (!isEditing) {
      setLabelValue(data.label || '');
    }
  }, [data.label, isEditing]);

  // 自动聚焦与选中文本
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const isLocked = Boolean(data.lockMode && data.lockMode !== 'none');
  const isFullLocked = data.lockMode === 'full';

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // 完全锁定 (full) 节点禁止双击进入内联文本编辑
    if (isFullLocked) {
      useFlowStore.getState().showToast('该节点已处于完全锁定状态 🔒，禁止修改文案');
      return;
    }
    setIsEditing(true);
  };

  const handleSave = () => {
    if (!isEditing) return;
    setIsEditing(false);
    const trimmed = labelValue.trim();
    if (trimmed !== data.label) {
      useFlowStore.getState().updateNodeData(id, { label: trimmed });
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setLabelValue(data.label || '');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  // 获取该节点类型预定义的 handles
  const registryEntry = getNodeRegistryEntry(data.type);
  const definedHandles = registryEntry?.handles ?? [];

  // 合并节点样式
  const nodeStyle = data.style || {};
  const isComment = data.type === 'comment';
  const defaultBg = isComment ? 'var(--fs-note-bg)' : 'var(--fs-node-bg)';
  const defaultBorder = isComment ? 'var(--fs-note-border)' : 'var(--fs-node-border)';
  const mergedStyle: React.CSSProperties = {
    backgroundColor: nodeStyle.fillColor ? String(nodeStyle.fillColor) : defaultBg,
    borderColor: nodeStyle.borderColor ? String(nodeStyle.borderColor) : defaultBorder,
    borderWidth: typeof nodeStyle.borderWidth === 'number' ? `${nodeStyle.borderWidth}px` : '1.5px',
    borderStyle: nodeStyle.borderStyle || undefined,
    color: nodeStyle.fontColor ? String(nodeStyle.fontColor) : 'var(--fs-node-text)',
    fontSize: typeof nodeStyle.fontSize === 'number' ? `${nodeStyle.fontSize}px` : '14px',
    boxShadow: selected
      ? '0 0 0 2px var(--fs-selection-ring)'
      : remoteSelector
      ? `0 0 0 2px ${remoteSelector.color}`
      : undefined,
    ...style,
  };

  return (
    <div
      className={`group relative flex items-center justify-center select-none w-full h-full transition-shadow duration-150 ${className}`}
      style={mergedStyle}
      onDoubleClick={handleDoubleClick}
    >
      {/* 他人选中高亮标识 */}
      {remoteSelector && (
        <div
          className="absolute -top-5 left-0 px-1.5 py-0.5 rounded-sm text-[10px] font-bold text-white shadow-xs pointer-events-none whitespace-nowrap z-30"
          style={{ backgroundColor: remoteSelector.color }}
        >
          {remoteSelector.nickname}
        </div>
      )}

      {/* 节点锚定锁精致微型徽章 */}
      {isLocked && (
        <div
          className={`absolute -top-2.5 -right-2.5 z-40 flex items-center justify-center w-5 h-5 rounded-full shadow-md text-[11px] select-none pointer-events-none border ${
            isFullLocked
              ? 'bg-rose-500 border-white text-white dark:bg-rose-600 shadow-rose-500/30'
              : 'bg-amber-500 border-white text-white dark:bg-amber-600 shadow-amber-500/30'
          }`}
          title={isFullLocked ? '完全锁定 (禁止移动/修改文案/删除)' : '坐标锁定 (禁止拖拽移动，排版保留原坐标)'}
        >
          {isFullLocked ? '🔒' : '📌'}
        </div>
      )}

      {/* 中心锚定缩放手柄：拖任意一边/一角，对侧等量同步扩展 (锁定节点禁用尺寸缩放) */}
      {showResize && !isLocked && (
        <NodeResizer
          minWidth={40}
          minHeight={30}
          onResizeStart={() => useFlowStore.getState().startCenteredResize(id)}
          onResizeEnd={() => useFlowStore.getState().finishCenteredResize(id)}
          lineClassName="border-[var(--fs-selection-ring)]/80"
          handleClassName="h-2 w-2 bg-white border border-[var(--fs-selection-ring)] rounded-sm"
        />
      )}

      {/*
        渲染连接桩 (Handles)：桩体保持 6px 默认尺寸，因为 React Flow 以桩矩形外沿作为连线端点，
        放大桩体会把端点推出形状边界；24px 感应热区改由 before 伪元素扩出，不影响端点计算
      */}
      {(customHandles
        ? customHandles.map((pos) => ({ id: pos, position: pos }))
        : definedHandles
      ).map((handle) => {
        const pos = POSITION_MAP[handle.position];
        const hasIncomingEdge = incomingHandles.has(handle.id);
        const showVisualIndicator = !hasIncomingEdge && (showHandles || isConnecting);

        return (
          <React.Fragment key={handle.id}>
            <Handle
              type="target"
              position={pos}
              id={handle.id}
              isConnectable={true}
              className={`nodrag !w-1.5 !h-1.5 !bg-transparent !border-0 before:absolute before:-inset-[9px] before:content-[''] pointer-events-auto z-0 ${
                showHandles ? '!opacity-100' : 'opacity-0'
              }`}
            />
            <Handle
              type="source"
              position={pos}
              id={handle.id}
              isConnectable={true}
              className={`nodrag !w-1.5 !h-1.5 !bg-transparent !border-0 before:absolute before:-inset-[9px] before:content-[''] flex items-center justify-center cursor-crosshair group/handle !pointer-events-auto ${
                hasIncomingEdge ? 'z-0' : 'z-10'
              } transition-all duration-150 ${
                showHandles ? '!opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
            >
              {showVisualIndicator && (
                <span
                  className={`rounded-full transition-all duration-150 pointer-events-none ${
                    showHandles
                      ? 'w-3 h-3 bg-blue-500 border-2 border-white shadow-[0_0_0_2px_rgba(59,130,246,0.5)]'
                      : 'w-2.5 h-2.5 bg-[var(--fs-surface,#ffffff)] border-2 border-[var(--fs-selection-ring,#2563eb)] group-hover/handle:w-3.5 group-hover/handle:h-3.5 group-hover/handle:bg-[var(--fs-selection-ring,#2563eb)] group-hover/handle:border-white shadow-xs group-hover/handle:shadow-[0_0_0_3px_rgba(37,99,235,0.35)]'
                  }`}
                />
              )}
            </Handle>
          </React.Fragment>
        );
      })}

      {/* 自定义几何轮廓或子元素插槽 */}
      {children}

      {/* 默认文本与双击内联编辑 */}
      {!customContent && (
        <div className="relative z-10 w-full px-2 text-center pointer-events-none">
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={labelValue}
              onChange={(e) => setLabelValue(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              className="nodrag nopan pointer-events-auto w-full px-1 py-0.5 text-center text-xs bg-[var(--fs-surface)] text-[var(--fs-text)] border border-[var(--fs-selection-ring)] rounded outline-none shadow-sm"
            />
          ) : (
            <span className="break-words line-clamp-3 text-sm font-medium leading-snug">
              {data.label || ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

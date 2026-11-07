/**
 * @fileoverview 基础图元通用外壳容器 (BaseNodeWrapper)
 * @description 统一封装 Handles 锚点生成、选中焦点环、双击内联文本编辑与设计令牌样式映射
 */

import React, { useState, useEffect, useRef } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { FlowNodeData, HandlePosition } from '@flowstudio/shared';
import { NODE_REGISTRY_RECORD } from '@flowstudio/shared';
import { useFlowStore } from '../../../stores/flow-store';

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

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
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
  const registryEntry = NODE_REGISTRY_RECORD[data.type];
  const definedHandles = registryEntry?.handles ?? [];

  // 合并节点样式
  const nodeStyle = data.style || {};
  const mergedStyle: React.CSSProperties = {
    backgroundColor: nodeStyle.fillColor ? String(nodeStyle.fillColor) : 'var(--fs-node-bg)',
    borderColor: nodeStyle.borderColor ? String(nodeStyle.borderColor) : 'var(--fs-node-border)',
    borderWidth: typeof nodeStyle.borderWidth === 'number' ? `${nodeStyle.borderWidth}px` : '1.5px',
    borderStyle: nodeStyle.borderStyle || undefined,
    color: nodeStyle.fontColor ? String(nodeStyle.fontColor) : 'var(--fs-node-text)',
    fontSize: typeof nodeStyle.fontSize === 'number' ? `${nodeStyle.fontSize}px` : '14px',
    boxShadow: selected ? '0 0 0 2px var(--fs-selection-ring)' : undefined,
    ...style,
  };

  return (
    <div
      className={`group relative flex items-center justify-center select-none w-full h-full transition-shadow duration-150 ${className}`}
      style={mergedStyle}
      onDoubleClick={handleDoubleClick}
    >
      {/* 渲染连接桩 (Handles) */}
      {customHandles
        ? customHandles.map((pos) => (
            <React.Fragment key={pos}>
              <Handle
                type="target"
                position={POSITION_MAP[pos]}
                id={`${pos}-target`}
                className="!w-2 !h-2 !bg-[var(--fs-surface)] !border-2 !border-[var(--fs-selection-ring)] opacity-0 group-hover:opacity-100 transition-opacity !pointer-events-auto"
              />
              <Handle
                type="source"
                position={POSITION_MAP[pos]}
                id={`${pos}-source`}
                className="!w-2 !h-2 !bg-[var(--fs-surface)] !border-2 !border-[var(--fs-selection-ring)] opacity-0 group-hover:opacity-100 transition-opacity !pointer-events-auto"
              />
            </React.Fragment>
          ))
        : definedHandles.map((handle) => {
            const pos = POSITION_MAP[handle.position];
            return (
              <React.Fragment key={handle.id}>
                {(handle.type === 'target' || handle.type === 'both') && (
                  <Handle
                    type="target"
                    position={pos}
                    id={handle.type === 'both' ? `${handle.id}-target` : handle.id}
                    className="!w-2 !h-2 !bg-[var(--fs-surface)] !border-2 !border-[var(--fs-selection-ring)] opacity-0 group-hover:opacity-100 transition-opacity !pointer-events-auto"
                  />
                )}
                {(handle.type === 'source' || handle.type === 'both') && (
                  <Handle
                    type="source"
                    position={pos}
                    id={handle.type === 'both' ? `${handle.id}-source` : handle.id}
                    className="!w-2 !h-2 !bg-[var(--fs-surface)] !border-2 !border-[var(--fs-selection-ring)] opacity-0 group-hover:opacity-100 transition-opacity !pointer-events-auto"
                  />
                )}
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

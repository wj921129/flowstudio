/**
 * @fileoverview 双模组合节点组件 (GroupNode)
 * @description 支持逻辑组合框 (Logical Group) 与显式容器框 (Container Frame) 双模态呈现
 */

import React, { useState, useRef, useEffect } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import type { FlowNodeData } from '@flowstudio/shared';
import { BaseNodeWrapper } from './base-node-wrapper';
import { useFlowStore } from '../../../stores/flow-store';

export const GroupNode: React.FC<NodeProps<Node<FlowNodeData>>> = (props) => {
  const isFrame = Boolean(props.data.isFrame);
  const [isEditing, setIsEditing] = useState(false);
  const [labelValue, setLabelValue] = useState(props.data.label || '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) {
      setLabelValue(props.data.label || '');
    }
  }, [props.data.label, isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleHeaderDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  const handleSave = () => {
    if (!isEditing) return;
    setIsEditing(false);
    const trimmed = labelValue.trim();
    if (trimmed !== props.data.label) {
      useFlowStore.getState().updateNodeData(props.id, { label: trimmed });
    }
  };

  if (isFrame) {
    return (
      <BaseNodeWrapper
        {...props}
        customContent
        className={`rounded-xl border border-[var(--fs-border)] !bg-[var(--fs-surface)]/25 flex flex-col justify-start items-stretch backdrop-blur-xs ${props.selected ? 'ring-2 ring-[var(--fs-selection-ring)]' : ''}`}
      >
        <div
          onDoubleClick={handleHeaderDoubleClick}
          className="h-8 px-3 flex items-center justify-between border-b border-[var(--fs-border)] bg-[var(--fs-surface)]/80 rounded-t-xl text-xs font-semibold text-[var(--fs-text-muted)] cursor-grab active:cursor-grabbing"
        >
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={labelValue}
              onChange={(e) => setLabelValue(e.target.value)}
              onBlur={handleSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') {
                  setIsEditing(false);
                  setLabelValue(props.data.label || '');
                }
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag nopan w-32 px-1 py-0.5 text-xs bg-[var(--fs-surface)] text-[var(--fs-text)] border border-[var(--fs-selection-ring)] rounded outline-none"
            />
          ) : (
            <span className="truncate">{props.data.label || '容器框'}</span>
          )}
        </div>
        <div className="flex-1 w-full pointer-events-none" />
      </BaseNodeWrapper>
    );
  }

  return (
    <BaseNodeWrapper
      {...props}
      customContent
      className={`rounded-lg border-2 border-dashed ${props.selected ? 'border-[var(--fs-selection-ring)] !bg-[var(--fs-selection-ring)]/5' : 'border-[var(--fs-border)]/50 !bg-transparent'} transition-colors`}
    >
      {props.selected && (
        <div className="absolute -top-5 left-0 text-[10px] text-[var(--fs-selection-ring)] font-medium select-none pointer-events-none">
          {props.data.label || '组合'}
        </div>
      )}
    </BaseNodeWrapper>
  );
};

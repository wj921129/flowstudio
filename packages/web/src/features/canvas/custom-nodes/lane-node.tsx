/**
 * @fileoverview 泳道分栏节点组件 (LaneNode)
 * @description 挂载于 Pool 内部的单条泳道容器，承载并限制归属该泳道的业务流程节点
 */

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { NodeProps, Node } from '@xyflow/react';
import { NodeResizer } from '@xyflow/react';
import type { FlowNodeData } from '@flowstudio/shared';
import { Trash2, AlertTriangle } from 'lucide-react';
import { BaseNodeWrapper } from './base-node-wrapper';
import { useFlowStore } from '../../../stores/flow-store';
import { isNodeLocked } from '../utils/node-lock-manager';

export const LaneNode: React.FC<NodeProps<Node<FlowNodeData>>> = (props) => {
  const { id, data, selected, parentId } = props;
  const store = useFlowStore();
  const parentPool = parentId ? store.nodes.find((n) => n.id === parentId) : null;
  const isHorizontal = (parentPool?.data?.orientation ?? 'horizontal') === 'horizontal';

  const [isEditing, setIsEditing] = useState(false);
  const [titleValue, setTitleValue] = useState(data.laneTitle || data.label || '泳道');
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
  const [confirmChildCount, setConfirmChildCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isConfirmDeleteOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsConfirmDeleteOpen(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        executeDeleteLane();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isConfirmDeleteOpen]);

  useEffect(() => {
    if (!isEditing) {
      setTitleValue(data.laneTitle || data.label || '泳道');
    }
  }, [data.laneTitle, data.label, isEditing]);

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
    const trimmed = titleValue.trim();
    if (trimmed && (trimmed !== data.laneTitle || trimmed !== data.label)) {
      useFlowStore.getState().updateNodeData(id, {
        label: trimmed,
        laneTitle: trimmed,
      });
    }
  };

  const executeDeleteLane = () => {
    setIsConfirmDeleteOpen(false);
    const st = useFlowStore.getState();
    st.setSelectedNodes([id]);
    st.deleteSelected();

    const afterNodes = useFlowStore.getState().nodes;
    if (!afterNodes.some((n) => n.id === id)) {
      const pool = parentId ? afterNodes.find((n) => n.id === parentId) : null;
      if (pool) {
        const remainingOrder = ((pool.data?.laneOrder as string[]) || []).filter((lid) => lid !== id);
        st.updateNodeData(pool.id, { laneOrder: remainingOrder });
      }
    }
  };

  // 删除当前泳道
  const handleDeleteLane = (e: React.MouseEvent) => {
    e.stopPropagation();
    const st = useFlowStore.getState();

    const currentLane = st.nodes.find((n) => n.id === id);
    if (isNodeLocked(currentLane, 'delete')) {
      st.showToast('该泳道已被完全锁定，禁止删除');
      return;
    }

    const children = st.nodes.filter((n) => n.parentId === id);
    const hasLockedChild = children.some((n) => isNodeLocked(n, 'delete'));
    if (hasLockedChild) {
      st.showToast('该泳道内包含锁定的节点，禁止删除');
      return;
    }

    if (children.length > 0) {
      setConfirmChildCount(children.length);
      setIsConfirmDeleteOpen(true);
      return;
    }

    executeDeleteLane();
  };

  return (
    <BaseNodeWrapper
      {...props}
      customContent
      className={`relative w-full h-full border border-dashed border-[var(--fs-border)]/60 bg-[var(--fs-surface)]/20 hover:bg-[var(--fs-surface)]/30 transition-colors flex ${
        isHorizontal ? 'flex-row border-b-2' : 'flex-col border-r-2'
      } ${selected ? 'ring-2 ring-[var(--fs-selection-ring)]/50 !border-[var(--fs-selection-ring)]/60' : ''}`}
    >
      {selected && !isNodeLocked(props as any, 'position') && (
        <NodeResizer
          minWidth={isHorizontal ? 400 : 160}
          minHeight={isHorizontal ? 120 : 300}
          isVisible={selected}
          lineClassName="border-[var(--fs-selection-ring)]/80"
          handleClassName="h-2 w-2 bg-white border border-[var(--fs-selection-ring)] rounded-sm"
        />
      )}

      {/* 泳道表头 */}
      <div
        onDoubleClick={handleHeaderDoubleClick}
        className={`group select-none cursor-grab active:cursor-grabbing bg-[var(--fs-surface)]/80 dark:bg-[var(--fs-surface)]/50 backdrop-blur-xs flex items-center justify-between ${
          isHorizontal
            ? 'w-10 min-w-10 h-full border-r border-[var(--fs-border)]/70 flex-col py-3 px-1'
            : 'w-full h-9 min-h-9 border-b border-[var(--fs-border)]/70 flex-row px-3'
        }`}
      >
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={handleSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') {
                setIsEditing(false);
                setTitleValue(data.laneTitle || data.label || '泳道');
              }
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className={`nodrag nopan text-xs font-semibold bg-[var(--fs-surface)] text-[var(--fs-text)] border border-[var(--fs-selection-ring)] rounded outline-none ${
              isHorizontal ? 'w-24 -rotate-90 origin-center my-6' : 'w-32 px-1 py-0.5'
            }`}
          />
        ) : (
          <span
            className={`text-xs font-semibold text-[var(--fs-text-muted)] group-hover:text-[var(--fs-text)] transition-colors truncate ${
              isHorizontal
                ? '[writing-mode:vertical-lr] tracking-widest'
                : 'tracking-wide max-w-[80%]'
            }`}
          >
            {titleValue}
          </span>
        )}

        {/* 悬浮微交互：快捷删除泳道 */}
        <button
          onClick={handleDeleteLane}
          title="删除此泳道及其内容"
          className="nodrag opacity-0 group-hover:opacity-100 p-1 text-[var(--fs-text-muted)] hover:text-red-500 hover:bg-red-500/10 rounded transition-all"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 泳道内部落子活动区 */}
      <div className="relative flex-1 w-full h-full pointer-events-none" />

      {/* 品牌化危险删除确认模态 */}
      {isConfirmDeleteOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-xs p-4 animate-in fade-in duration-150"
            onClick={(e) => {
              e.stopPropagation();
              setIsConfirmDeleteOpen(false);
            }}
          >
            <div
              className="w-full max-w-md rounded-2xl p-6 shadow-2xl border bg-[var(--fs-surface)] border-[var(--fs-border)] text-[var(--fs-text)] animate-in zoom-in-95 duration-150 select-none"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-rose-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold leading-6 mb-1.5">删除泳道</h3>
                  <p className="text-xs leading-5 text-[var(--fs-text-muted)]">
                    确定要删除泳道「
                    <span className="font-semibold text-[var(--fs-text)]">{titleValue}</span>
                    」吗？该泳道内包含{' '}
                    <span className="font-semibold text-rose-500">{confirmChildCount}</span>{' '}
                    个步骤节点，删除泳道将同时清除所有内部节点与连线，此操作无法撤销。
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-6">
                <button
                  type="button"
                  onClick={() => setIsConfirmDeleteOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-medium border border-[var(--fs-border)] text-[var(--fs-text-muted)] hover:bg-[var(--fs-bg)] transition-colors cursor-pointer"
                >
                  取消 (Esc)
                </button>
                <button
                  type="button"
                  onClick={executeDeleteLane}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-white shadow-xs bg-rose-600 hover:bg-rose-700 transition-colors cursor-pointer"
                >
                  确认删除 (Enter)
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </BaseNodeWrapper>
  );
};

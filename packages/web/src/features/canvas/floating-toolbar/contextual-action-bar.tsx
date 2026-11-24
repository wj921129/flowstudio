/**
 * @fileoverview 就地悬浮操作工具条 (ContextualActionBar)
 * @description 在框选多选或选中组合时浮现于选区上方，提供一键成组、解散、对齐、调色与删除操作
 */

import React from 'react';
import {
  Group as GroupIcon,
  Ungroup as UngroupIcon,
  AlignLeft,
  AlignCenterHorizontal,
  AlignRight,
  Trash2,
  Layers,
  Lock,
  Pin,
  Unlock,
} from 'lucide-react';
import { useFlowStore } from '../../../stores/flow-store';
import { isNodeLocked } from '../utils/node-lock-manager';

const PALETTE_COLORS = [
  'var(--fs-palette-1)',
  'var(--fs-palette-2)',
  'var(--fs-palette-3)',
  'var(--fs-palette-4)',
  'var(--fs-palette-5)',
  'var(--fs-palette-6)',
];

export const ContextualActionBar: React.FC = () => {
  const nodes = useFlowStore((s) => s.nodes);
  const selectedNodeIds = useFlowStore((s) => s.selectedNodeIds);
  const groupSelectedNodes = useFlowStore((s) => s.groupSelectedNodes);
  const ungroupNodes = useFlowStore((s) => s.ungroupNodes);
  const alignSelectedNodes = useFlowStore((s) => s.alignSelectedNodes);
  const deleteSelected = useFlowStore((s) => s.deleteSelected);
  const batchUpdateNodeData = useFlowStore((s) => s.batchUpdateNodeData);
  const toggleSelectedLockMode = useFlowStore((s) => s.toggleSelectedLockMode);
  const aiBatchBannerVisible = useFlowStore((s) => s.aiBatchBannerVisible);

  const selectedSet = new Set(selectedNodeIds);
  const targetNodes = nodes.filter((n) => selectedSet.has(n.id) || n.selected);

  // 触发条件：单选或多选节点/泳道容器
  if (targetNodes.length === 0) {
    return null;
  }

  const hasGroupSelected = targetNodes.some((n) => n.type === 'group');
  const isMultiSelection = targetNodes.length >= 2;

  // 获取锁定状态用于徽章展示 (none -> position 📌 -> full 🔒)
  const currentLockMode = targetNodes[0]?.data?.lockMode ?? 'none';

  const handleApplyColor = (colorVar: string) => {
    const unlockedTargets = targetNodes.filter((n) => !isNodeLocked(n, 'content'));
    if (unlockedTargets.length === 0 && targetNodes.length > 0) {
      useFlowStore.getState().showToast('选中的节点已完全锁定，禁止修改样式');
      return;
    }
    const updates = unlockedTargets.map((node) => ({
      id: node.id,
      data: {
        style: {
          ...node.data?.style,
          borderColor: colorVar,
        },
      },
    }));
    batchUpdateNodeData(updates);
  };

  return (
    <div
      data-testid="contextual-action-bar"
      className={`nodrag nopan absolute ${
        aiBatchBannerVisible ? 'top-16 left-1/2 -translate-x-1/2' : 'top-4 left-1/2 -translate-x-1/2'
      } z-40 flex items-center gap-1 px-2 py-1.5 rounded-xl bg-[var(--fs-surface)]/95 backdrop-blur-md border border-[var(--fs-border)] shadow-lg select-none text-[var(--fs-text)]`}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* 节点/泳道锚定锁切换按钮 (Ctrl+L) */}
      <button
        type="button"
        title={
          currentLockMode === 'full'
            ? '完全锁定 🔒 (禁止移动/修改文案/删除) - 点击切换 (Ctrl+L)'
            : currentLockMode === 'position'
            ? '坐标锁定 📌 (禁止拖拽，排版固定原位) - 点击切换 (Ctrl+L)'
            : '未锁定 🔓 - 点击切换锁定模式 (Ctrl+L)'
        }
        onClick={() => toggleSelectedLockMode()}
        className="p-1.5 rounded hover:bg-[var(--fs-bg)] transition-colors flex items-center justify-center cursor-pointer"
      >
        {currentLockMode === 'full' ? (
          <Lock className="w-4 h-4 text-rose-500" />
        ) : currentLockMode === 'position' ? (
          <Pin className="w-4 h-4 text-amber-500" />
        ) : (
          <Unlock className="w-4 h-4 text-[var(--fs-text-muted)]" />
        )}
      </button>

      <div className="w-px h-4 bg-[var(--fs-border)] mx-0.5" />

      {/* 组合 / 解散组合操作 */}
      {isMultiSelection && (
        <>
          <button
            type="button"
            title="组合成组 (Ctrl+G)"
            onClick={() => groupSelectedNodes({ asFrame: false })}
            className="p-1.5 rounded hover:bg-[var(--fs-bg)] text-[var(--fs-text-muted)] hover:text-[var(--fs-text)] transition-colors"
          >
            <GroupIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="创建为容器框 (Frame)"
            onClick={() => groupSelectedNodes({ asFrame: true })}
            className="p-1.5 rounded hover:bg-[var(--fs-bg)] text-[var(--fs-text-muted)] hover:text-[var(--fs-text)] transition-colors"
          >
            <Layers className="w-4 h-4" />
          </button>
        </>
      )}

      {hasGroupSelected && (
        <button
          type="button"
          title="解散组合 (Ctrl+Shift+G)"
          onClick={() => ungroupNodes()}
          className="p-1.5 rounded hover:bg-[var(--fs-bg)] text-[var(--fs-text-muted)] hover:text-[var(--fs-text)] transition-colors"
        >
          <UngroupIcon className="w-4 h-4" />
        </button>
      )}

      {/* 对齐排版操作（仅在多选状态下可用） */}
      {isMultiSelection && (
        <>
          <div className="w-px h-4 bg-[var(--fs-border)] mx-0.5" />
          <button
            type="button"
            title="左对齐"
            onClick={() => alignSelectedNodes('left')}
            className="p-1.5 rounded hover:bg-[var(--fs-bg)] text-[var(--fs-text-muted)] hover:text-[var(--fs-text)] transition-colors"
          >
            <AlignLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="水平居中"
            onClick={() => alignSelectedNodes('center')}
            className="p-1.5 rounded hover:bg-[var(--fs-bg)] text-[var(--fs-text-muted)] hover:text-[var(--fs-text)] transition-colors"
          >
            <AlignCenterHorizontal className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="右对齐"
            onClick={() => alignSelectedNodes('right')}
            className="p-1.5 rounded hover:bg-[var(--fs-bg)] text-[var(--fs-text-muted)] hover:text-[var(--fs-text)] transition-colors"
          >
            <AlignRight className="w-4 h-4" />
          </button>
        </>
      )}

      {/* 快捷色盘赋色 */}
      <div className="w-px h-4 bg-[var(--fs-border)] mx-0.5" />
      <div className="flex items-center gap-1 px-1">
        {PALETTE_COLORS.map((color, index) => (
          <button
            key={index}
            type="button"
            style={{ backgroundColor: color }}
            title="应用强调色"
            onClick={() => handleApplyColor(color)}
            className="w-3.5 h-3.5 rounded-full hover:scale-110 transition-transform ring-1 ring-[var(--fs-border)]"
          />
        ))}
      </div>

      {/* 批量删除 */}
      <div className="w-px h-4 bg-[var(--fs-border)] mx-0.5" />
      <button
        type="button"
        title="删除选中 (Delete)"
        onClick={() => deleteSelected()}
        className="p-1.5 rounded hover:bg-[var(--fs-bg)] text-[var(--fs-palette-4)] transition-colors"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
};

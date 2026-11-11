/**
 * @fileoverview 就地悬浮操作工具条 (ContextualActionBar)
 * @description 在框选多选或选中组合时浮现于选区上方，提供一键成组、解散、对齐、调色与删除操作
 */

import React from 'react';
import { useViewport } from '@xyflow/react';
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
import { computeBoundingBox, toWorldPosition } from '../utils/group-calculator';
import type { FlowNode } from '@flowstudio/shared';

const PALETTE_COLORS = [
  'var(--fs-palette-1)',
  'var(--fs-palette-2)',
  'var(--fs-palette-3)',
  'var(--fs-palette-4)',
  'var(--fs-palette-5)',
  'var(--fs-palette-6)',
];

export const ContextualActionBar: React.FC = () => {
  const { x: vpX, y: vpY, zoom } = useViewport();
  const nodes = useFlowStore((s) => s.nodes);
  const selectedNodeIds = useFlowStore((s) => s.selectedNodeIds);
  const groupSelectedNodes = useFlowStore((s) => s.groupSelectedNodes);
  const ungroupNodes = useFlowStore((s) => s.ungroupNodes);
  const alignSelectedNodes = useFlowStore((s) => s.alignSelectedNodes);
  const deleteSelected = useFlowStore((s) => s.deleteSelected);
  const batchUpdateNodeData = useFlowStore((s) => s.batchUpdateNodeData);
  const toggleSelectedLockMode = useFlowStore((s) => s.toggleSelectedLockMode);

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

  // 换算所有选中节点的世界坐标以确定综合包围盒
  const nodeMap = new Map<string, FlowNode>(nodes.map((n) => [n.id, n]));
  const getAbsolutePos = (node: FlowNode): { x: number; y: number } => {
    if (node.parentId && nodeMap.has(node.parentId)) {
      const parent = nodeMap.get(node.parentId)!;
      const parentPos = getAbsolutePos(parent);
      return toWorldPosition(node.position, parentPos);
    }
    return { ...node.position };
  };

  const worldNodes: FlowNode[] = targetNodes.map((n) => ({
    ...n,
    position: getAbsolutePos(n),
  }));

  const bbox = computeBoundingBox(worldNodes, 0);
  const screenX = (bbox.x + bbox.width / 2) * zoom + vpX;
  const screenY = bbox.y * zoom + vpY - 12;

  const handleApplyColor = (colorVar: string) => {
    const updates = targetNodes.map((node) => ({
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
      style={{
        position: 'absolute',
        left: `${Math.round(screenX)}px`,
        top: `${Math.round(screenY)}px`,
        transform: 'translate(-50%, -100%)',
        zIndex: 40,
      }}
      className="nodrag nopan flex items-center gap-1 p-1 rounded-lg bg-[var(--fs-surface)] border border-[var(--fs-border)] shadow-md select-none text-[var(--fs-text)]"
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

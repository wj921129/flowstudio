/**
 * @fileoverview 泳道池容器节点组件 (PoolNode)
 * @description 代表多泳道编组的顶级容器，支持横向 (Horizontal) 与纵向 (Vertical) 两种布局模式
 */

import React, { useState, useEffect } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import { NodeResizer } from '@xyflow/react';
import type { FlowNodeData } from '@flowstudio/shared';
import { Columns3, Rows3, Plus, ArrowLeftRight } from 'lucide-react';
import { BaseNodeWrapper } from './base-node-wrapper';
import { InlineTextEditor } from './inline-text-editor';
import { useFlowStore } from '../../../stores/flow-store';
import { usePresentationStore } from '../../presentation';
import { isNodeLocked } from '../utils/node-lock-manager';
import { refreshPoolOrientationEdges, reorderPoolOrientation } from '../utils/lane-nesting-manager';

export const PoolNode: React.FC<NodeProps<Node<FlowNodeData>>> = (props) => {
  const { id, data, selected } = props;
  const orientation = data.orientation ?? 'horizontal';
  const isHorizontal = orientation === 'horizontal';
  const activeTool = useFlowStore((s) => s.activeTool);
  const isSpacePanning = useFlowStore((s) => s.isSpacePanning);
  const isReadOnly = usePresentationStore((s) => s.isReadOnly);
  const isPanOrLocked = isSpacePanning || isReadOnly || activeTool === 'pan';

  const [isEditing, setIsEditing] = useState(false);
  const [labelValue, setLabelValue] = useState(data.label || '泳道池');

  useEffect(() => {
    if (!isEditing) {
      setLabelValue(data.label || '泳道池');
    }
  }, [data.label, isEditing]);

  const handleHeaderDoubleClick = (e: React.MouseEvent) => {
    if (isPanOrLocked) return;
    e.stopPropagation();
    setIsEditing(true);
  };

  const handleSave = () => {
    if (!isEditing) return;
    setIsEditing(false);
    const trimmed = labelValue.trim();
    if (trimmed && trimmed !== data.label) {
      useFlowStore.getState().updateNodeData(id, { label: trimmed });
    }
  };

  // 添加新泳道
  const handleAddLane = (e: React.MouseEvent) => {
    if (isPanOrLocked) return;
    e.stopPropagation();
    const store = useFlowStore.getState();
    const existingLanes = store.nodes.filter((n) => n.type === 'lane' && n.parentId === id);
    const laneIndex = existingLanes.length + 1;
    const laneId = `lane-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    // 计算新泳道位置与尺寸
    const poolWidth = props.width ?? 800;
    const poolHeight = props.height ?? 400;
    const headerSize = data.headerSize ?? 40;

    let nextPoolWidth = poolWidth;
    let nextPoolHeight = poolHeight;

    let laneX = 0;
    let laneY = 0;
    let laneW = poolWidth;
    let laneH = 200;

    if (isHorizontal) {
      // 横向：新泳道追加在下方
      const currentBottom = existingLanes.reduce(
        (max, l) => Math.max(max, l.position.y + (l.height ?? (l.style?.height as number) ?? 200)),
        headerSize
      );
      laneY = currentBottom;
      laneH = 200;
      laneW = poolWidth;
      nextPoolHeight = Math.max(poolHeight, laneY + laneH);
    } else {
      const currentRight = existingLanes.reduce(
        (max, l) => Math.max(max, l.position.x + (l.width ?? (l.style?.width as number) ?? 240)),
        0
      );
      laneX = currentRight;
      laneW = 240;
      laneH = Math.max(480, poolHeight - headerSize);
      laneY = headerSize;
      nextPoolWidth = Math.max(poolWidth, laneX + laneW);
      nextPoolHeight = Math.max(poolHeight, headerSize + laneH);
    }

    const newLaneNode = {
      id: laneId,
      type: 'lane' as const,
      parentId: id,
      extent: 'parent' as const,
      position: { x: laneX, y: laneY },
      width: laneW,
      height: laneH,
      data: {
        label: `泳道 ${laneIndex}`,
        type: 'lane' as const,
        laneTitle: `泳道 ${laneIndex}`,
      },
    };

    // 更新 pool 节点及其 laneOrder
    const currentOrder = (data.laneOrder as string[]) || existingLanes.map((l) => l.id);
    const nextOrder = [...currentOrder, laneId];

    store.addNodes([newLaneNode]);
    store.updateNodeData(id, { laneOrder: nextOrder });
    store.updateNodeDimensions(id, nextPoolWidth, nextPoolHeight);
  };

  const handleToggleOrientation = (e: React.MouseEvent) => {
    if (isPanOrLocked) return;
    e.stopPropagation();
    const store = useFlowStore.getState();
    const poolLaneIds = new Set(store.nodes.filter((n) => n.parentId === id).map((n) => n.id));
    const hasLockedMember = store.nodes.some(
      (n) =>
        (n.id === id || poolLaneIds.has(n.id) || (n.parentId ? poolLaneIds.has(n.parentId) : false))
        && (n.data?.lockMode === 'position' || n.data?.lockMode === 'full')
    );
    if (hasLockedMember) {
      store.showToast('泳道池内包含已锁定节点，请先解锁后再切换方向');
      return;
    }
    const nextOrientation = isHorizontal ? 'vertical' : 'horizontal';
    const prevNodeById = new Map(store.nodes.map((n) => [n.id, n]));
    const prevEdgeById = new Map(store.edges.map((edge) => [edge.id, edge]));
    const nextNodes = reorderPoolOrientation(id, nextOrientation, store.nodes);
    const nextEdges = refreshPoolOrientationEdges(id, nextNodes, store.edges);
    const changedNodes = nextNodes.filter((n) => prevNodeById.get(n.id) !== n);
    const changedEdges = nextEdges.filter((edge) => prevEdgeById.get(edge.id) !== edge);
    if (changedNodes.length > 0 || changedEdges.length > 0) {
      store.applyIncrementalUpdate({ putNodes: changedNodes, putEdges: changedEdges });
    }
  };

  return (
    <BaseNodeWrapper
      {...props}
      customContent
      className={`relative w-full h-full rounded-2xl border border-[var(--fs-border)]/80 bg-[var(--fs-surface)]/35 dark:bg-[var(--fs-surface)]/20 backdrop-blur-xs flex flex-col items-stretch overflow-hidden shadow-xs transition-shadow duration-200 ${
        selected ? 'ring-2 ring-[var(--fs-selection-ring)] shadow-md' : 'hover:border-[var(--fs-border)]'
      }`}
    >
      {selected && !isPanOrLocked && activeTool === 'select' && !isNodeLocked(props as any, 'position') && (
        <NodeResizer
          minWidth={500}
          minHeight={300}
          isVisible={selected}
          lineClassName="border-[var(--fs-selection-ring)]"
          handleClassName="h-2.5 w-2.5 bg-white border-2 border-[var(--fs-selection-ring)] rounded-sm"
        />
      )}

      {/* 顶部池表头 */}
      <div
        onDoubleClick={handleHeaderDoubleClick}
        className="h-10 px-4 bg-[var(--fs-surface)]/85 dark:bg-[var(--fs-surface)]/60 border-b border-[var(--fs-border)]/70 flex items-center justify-between select-none z-10"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex items-center justify-center w-5 h-5 rounded-md bg-[var(--fs-selection-ring)]/15 text-[var(--fs-selection-ring)]">
            {isHorizontal ? <Rows3 className="w-3.5 h-3.5" /> : <Columns3 className="w-3.5 h-3.5" />}
          </div>

          {isEditing ? (
            <InlineTextEditor
              value={labelValue}
              onChange={setLabelValue}
              onCommit={handleSave}
              onCancel={() => {
                setIsEditing(false);
                setLabelValue(data.label || '泳道池');
              }}
              wrapperClassName="min-w-16 rounded ring-1 ring-[var(--fs-selection-ring)]/60"
              className="text-xs font-semibold text-[var(--fs-text)] tracking-wide"
            />
          ) : (
            <span className="text-xs font-semibold text-[var(--fs-text)] tracking-wide truncate">
              {data.label || '泳道池'}
            </span>
          )}

          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--fs-border)]/50 text-[var(--fs-text-muted)] font-medium">
            {isHorizontal ? '横向池' : '纵向池'}
          </span>
        </div>

        {/* 快捷操作区 */}
        {!isPanOrLocked && (
          <div className="flex items-center gap-1 opacity-80 hover:opacity-100 transition-opacity">
            <button
              onClick={handleAddLane}
              title="追加一条新泳道"
              className="nodrag flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-[var(--fs-selection-ring)] bg-[var(--fs-selection-ring)]/10 hover:bg-[var(--fs-selection-ring)]/20 rounded-md transition-colors"
            >
              <Plus className="w-3 h-3" />
              <span>加泳道</span>
            </button>

            <button
              onClick={handleToggleOrientation}
              title="切换横向 / 纵向方向"
              className="nodrag p-1 text-[var(--fs-text-muted)] hover:text-[var(--fs-text)] hover:bg-[var(--fs-border)]/40 rounded-md transition-colors"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* 内部泳道承载区 */}
      <div className="relative flex-1 w-full pointer-events-none" />
    </BaseNodeWrapper>
  );
};

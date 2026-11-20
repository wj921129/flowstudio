/**
 * @fileoverview 基础图元通用外壳容器 (BaseNodeWrapper)
 * @description 统一封装 Handles 锚点生成、选中焦点环、双击内联文本编辑与设计令牌样式映射
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Handle, Position, NodeResizer, useConnection, useUpdateNodeInternals } from '@xyflow/react';
import type { FlowNodeData, FlowNodeType, HandlePosition, BorderSide } from '@flowstudio/shared';
import {
  getNodeRegistryEntry,
  getDefaultNodeSize,
  parseBorderAnchorHandle,
  formatBorderAnchorHandle,
  projectPointToNodeBorder,
  getShapeBorderNormalizedPoint,
} from '@flowstudio/shared';
import {
  useFlowStore,
  selectIncomingHandleKeys,
  selectCustomAttachedHandleKeys,
  selectNodeSemanticRole,
} from '../../../stores/flow-store';
import { useRemoteNodeSelector } from '../../collaboration/remote-users-store';
import { InlineTextEditor } from './inline-text-editor';


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

function buildHandleAnchorStyle(
  side: BorderSide,
  offset: number,
  nodeType: FlowNodeType,
  width?: number,
  height?: number
): React.CSSProperties {
  const { u, v } = getShapeBorderNormalizedPoint(side, offset, nodeType, {
    width: width || 120,
    height: height || 60,
  });
  switch (side) {
    case 'top':
      return { left: `${u * 100}%`, top: `${v * 100}%`, right: 'auto', bottom: 'auto' };
    case 'bottom':
      return { left: `${u * 100}%`, bottom: `${(1 - v) * 100}%`, right: 'auto', top: 'auto' };
    case 'left':
      return { left: `${u * 100}%`, top: `${v * 100}%`, right: 'auto', bottom: 'auto' };
    case 'right':
      return { right: `${(1 - u) * 100}%`, top: `${v * 100}%`, left: 'auto', bottom: 'auto' };
  }
}

import {
  resolveNodeSemanticRole,
  type NodeSemanticRole,
} from '../../sidebar/styles/style-resolver';

export { resolveNodeSemanticRole, type NodeSemanticRole };

const ROLE_TOKENS: Record<Exclude<NodeSemanticRole, 'neutral'>, { bg: string; border: string; text: string }> = {
  start: {
    bg: 'var(--fs-node-start-bg)',
    border: 'var(--fs-node-start-border)',
    text: 'var(--fs-node-start-text)',
  },
  process: {
    bg: 'var(--fs-node-process-bg)',
    border: 'var(--fs-node-process-border)',
    text: 'var(--fs-node-process-text)',
  },
  end: {
    bg: 'var(--fs-node-end-bg)',
    border: 'var(--fs-node-end-border)',
    text: 'var(--fs-node-end-text)',
  },
};

export interface BaseNodeWrapperProps {
  id: string;
  data: FlowNodeData;
  selected?: boolean;
  width?: number;
  height?: number;
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
  width,
  height,
  className = '',
  style = {},
  children,
  customContent = false,
  customHandles,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [labelValue, setLabelValue] = useState(data.label || '');
  const remoteSelector = useRemoteNodeSelector(id);
  const defaultSize = getDefaultNodeSize(data.type);
  const resolvedWidth = width ?? defaultSize.width;
  const resolvedHeight = height ?? defaultSize.height;

  let isConnecting = false;
  try {
    const connection = useConnection();
    isConnecting = Boolean(connection?.inProgress);
  } catch {
    // 兼容可能无 ReactFlowProvider 包装的单测上下文
  }
  let updateNodeInternals: ((nodeId: string) => void) | null = null;
  try {
    updateNodeInternals = useUpdateNodeInternals();
  } catch {
    // 兼容可能无 ReactFlowProvider 包装的单测上下文
  }
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [hoverAnchor, setHoverAnchor] = useState<{
    id: string;
    side: BorderSide;
    offset: number;
  } | null>(null);
  const activeTool = useFlowStore((s) => s.activeTool);
  const isSpacePanning = useFlowStore((s) => s.isSpacePanning);
  const semanticRole = useFlowStore((s) => selectNodeSemanticRole(s.edges, id, data.type, data.label));
  const showHandles = isConnecting || activeTool === 'connect' || selected;
  const showResize = selected && activeTool === 'select' && !CONTAINER_NODE_TYPES.includes(data.type);

  const incomingHandleKeys = useFlowStore((s) => selectIncomingHandleKeys(s.nodes, s.edges, id));
  const incomingHandles = React.useMemo(
    () => new Set(incomingHandleKeys ? incomingHandleKeys.split(',') : []),
    [incomingHandleKeys]
  );

  useEffect(() => {
    if (!isEditing) {
      setLabelValue(data.label || '');
    }
  }, [data.label, isEditing]);

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

  // 获取该节点类型预定义的 handles
  const registryEntry = getNodeRegistryEntry(data.type);
  const definedHandles = registryEntry?.handles ?? [];
  const baseHandles = React.useMemo(
    () => (customHandles ? customHandles.map((pos) => ({ id: pos, position: pos })) : definedHandles),
    [customHandles, definedHandles]
  );
  const baseHandleIdSet = React.useMemo(() => new Set(baseHandles.map((h) => h.id)), [baseHandles]);

  const customAttachedHandleKeys = useFlowStore((s) =>
    selectCustomAttachedHandleKeys(s.edges, id, baseHandleIdSet)
  );

  const customAttachedHandles = React.useMemo(() => {
    if (!customAttachedHandleKeys) return [];
    return customAttachedHandleKeys
      .split(',')
      .map((hid) => {
        const parsed = parseBorderAnchorHandle(hid);
        return parsed ? { id: hid, side: parsed.side, offset: parsed.offset } : null;
      })
      .filter((x): x is { id: string; side: BorderSide; offset: number } => x !== null);
  }, [customAttachedHandleKeys]);

  const computeHoverAnchor = useCallback(
    (clientX: number, clientY: number, disableSnap: boolean) => {
      const el = wrapperRef.current;
      if (!el || baseHandles.length === 0 || isSpacePanning) {
        setHoverAnchor(null);
        return;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const margin = 16;
      if (
        clientX < rect.left - margin ||
        clientX > rect.right + margin ||
        clientY < rect.top - margin ||
        clientY > rect.bottom + margin
      ) {
        setHoverAnchor(null);
        return;
      }

      const nodeWidth = el.offsetWidth || rect.width;
      const nodeHeight = el.offsetHeight || rect.height;
      const localX = ((clientX - rect.left) / rect.width) * nodeWidth;
      const localY = ((clientY - rect.top) / rect.height) * nodeHeight;
      const proj = projectPointToNodeBorder(localX, localY, nodeWidth, nodeHeight, {
        snapThresholdPx: 5,
        disableSnap,
        nodeType: data.type,
      });
      const distScreen = Math.hypot(
        ((localX - proj.x) / nodeWidth) * rect.width,
        ((localY - proj.y) / nodeHeight) * rect.height
      );
      if (distScreen > margin) {
        setHoverAnchor(null);
        return;
      }

      const hid = formatBorderAnchorHandle(proj.side, proj.offset);
      setHoverAnchor((prev) =>
        prev && prev.id === hid ? prev : { id: hid, side: proj.side, offset: proj.offset }
      );
    },
    [baseHandles.length, isSpacePanning, data.type]
  );

  useEffect(() => {
    if (!isConnecting) return;
    const onMove = (e: PointerEvent) => computeHoverAnchor(e.clientX, e.clientY, e.altKey);
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
      setHoverAnchor(null);
    };
  }, [isConnecting, computeHoverAnchor]);

  useEffect(() => {
    if (updateNodeInternals) {
      updateNodeInternals(id);
    }
  }, [
    id,
    data.type,
    resolvedWidth,
    resolvedHeight,
    customAttachedHandleKeys,
    hoverAnchor?.id,
    updateNodeInternals,
  ]);

  // 合并节点样式
  const nodeStyle = data.style || {};
  const isComment = data.type === 'comment';
  const isLane = data.type === 'lane';
  const isPool = data.type === 'pool';
  const isContainer = isLane || isPool;

  const roleToken = semanticRole === 'neutral' ? null : ROLE_TOKENS[semanticRole];
  const defaultBg = isComment ? 'var(--fs-note-bg)' : isContainer ? undefined : (roleToken?.bg ?? 'var(--fs-node-bg)');
  const defaultBorder = isComment ? 'var(--fs-note-border)' : isContainer ? undefined : (roleToken?.border ?? 'var(--fs-node-border)');
  const defaultText = roleToken?.text ?? 'var(--fs-node-text)';
  const defaultBorderWidth = isContainer ? undefined : '1.5px';

  const mergedStyle: React.CSSProperties = {
    backgroundColor: nodeStyle.fillColor ? String(nodeStyle.fillColor) : defaultBg,
    borderColor: nodeStyle.borderColor ? String(nodeStyle.borderColor) : defaultBorder,
    borderWidth: typeof nodeStyle.borderWidth === 'number' ? `${nodeStyle.borderWidth}px` : defaultBorderWidth,
    borderStyle: nodeStyle.borderStyle || undefined,
    color: nodeStyle.fontColor ? String(nodeStyle.fontColor) : defaultText,
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
      ref={wrapperRef}
      className={`group relative flex items-center justify-center select-none w-full h-full transition-shadow duration-150 ${className}`}
      style={mergedStyle}
      onDoubleClick={handleDoubleClick}
      onPointerMove={(e) => {
        if (!isConnecting) computeHoverAnchor(e.clientX, e.clientY, e.altKey);
      }}
      onPointerLeave={() => {
        if (!isConnecting) setHoverAnchor(null);
      }}
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
      {baseHandles.map((handle) => {
        const pos = POSITION_MAP[handle.position];
        const hasIncomingEdge = incomingHandles.has(handle.id);
        const isForceShowHandles = isConnecting || activeTool === 'connect';
        const showVisualIndicator = isForceShowHandles ? true : (!hasIncomingEdge && showHandles);
        const anchorStyle = buildHandleAnchorStyle(
          handle.position as BorderSide,
          0.5,
          data.type,
          resolvedWidth,
          resolvedHeight
        );

        return (
          <React.Fragment key={handle.id}>
            <Handle
              type="target"
              position={pos}
              id={handle.id}
              isConnectable={true}
              style={anchorStyle}
              className={`nodrag !w-1.5 !h-1.5 !bg-transparent !border-0 before:absolute before:-inset-[9px] before:content-[''] pointer-events-auto z-0 ${
                showHandles ? '!opacity-100' : 'opacity-0'
              }`}
            />
            <Handle
              type="source"
              position={pos}
              id={handle.id}
              isConnectable={true}
              style={anchorStyle}
              className={`nodrag !w-1.5 !h-1.5 !bg-transparent !border-0 before:absolute before:-inset-[9px] before:content-[''] cursor-crosshair group/handle !pointer-events-auto ${
                hasIncomingEdge ? 'z-0' : 'z-10'
              } transition-opacity duration-150 ${
                showHandles ? '!opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
            >
              {showVisualIndicator && (
                <span
                  className={`fs-handle-dot transition-all duration-150 pointer-events-none ${
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

      {customAttachedHandles.map((ch) => {
        const pos = POSITION_MAP[ch.side];
        const anchorStyle = buildHandleAnchorStyle(
          ch.side,
          ch.offset,
          data.type,
          resolvedWidth,
          resolvedHeight
        );
        return (
          <React.Fragment key={`custom-${ch.id}`}>
            <Handle
              type="target"
              position={pos}
              id={ch.id}
              isConnectable={true}
              style={anchorStyle}
              className="nodrag !w-1.5 !h-1.5 !bg-transparent !border-0 before:absolute before:-inset-[9px] before:content-[''] pointer-events-auto z-0"
            />
            <Handle
              type="source"
              position={pos}
              id={ch.id}
              isConnectable={true}
              style={anchorStyle}
              className="nodrag !w-1.5 !h-1.5 !bg-transparent !border-0 before:absolute before:-inset-[9px] before:content-[''] cursor-crosshair group/handle !pointer-events-auto z-10"
            >
              {showHandles && (
                <span className="fs-handle-dot w-2.5 h-2.5 bg-blue-500 border-2 border-white shadow-[0_0_0_2px_rgba(59,130,246,0.45)] pointer-events-none" />
              )}
            </Handle>
          </React.Fragment>
        );
      })}

      {hoverAnchor && (
        (() => {
          const isNewHandle =
            !baseHandleIdSet.has(hoverAnchor.id) &&
            !customAttachedHandles.some((c) => c.id === hoverAnchor.id);
          if (!isNewHandle) return null;
          const pos = POSITION_MAP[hoverAnchor.side];
          const anchorStyle = buildHandleAnchorStyle(
            hoverAnchor.side,
            hoverAnchor.offset,
            data.type,
            resolvedWidth,
            resolvedHeight
          );
          return (
            <>
              <Handle
                type="target"
                position={pos}
                id={hoverAnchor.id}
                isConnectable={true}
                style={anchorStyle}
                className="nodrag !w-1.5 !h-1.5 !bg-transparent !border-0 before:absolute before:-inset-[10px] before:content-[''] pointer-events-auto z-20"
              />
              <Handle
                type="source"
                position={pos}
                id={hoverAnchor.id}
                isConnectable={true}
                style={anchorStyle}
                className="nodrag !w-1.5 !h-1.5 !bg-transparent !border-0 before:absolute before:-inset-[10px] before:content-[''] cursor-crosshair !pointer-events-auto z-30"
              >
                <span className="fs-handle-dot w-3 h-3 bg-blue-600 border-2 border-white shadow-[0_0_0_3px_rgba(37,99,235,0.35)] pointer-events-none" />
              </Handle>
            </>
          );
        })()
      )}

      {/* 自定义几何轮廓或子元素插槽 */}
      {children}

      {!customContent && (
        <div className={`relative z-10 w-full px-2 text-center ${isEditing ? 'pointer-events-auto' : 'pointer-events-none'}`}>
          {isEditing ? (
            <InlineTextEditor
              value={labelValue}
              onChange={setLabelValue}
              onCommit={handleSave}
              onCancel={handleCancel}
              wrapperClassName="w-full rounded ring-1 ring-[var(--fs-selection-ring)]/60"
              className="text-sm font-medium leading-snug text-center text-inherit"
            />
          ) : (
            <span className="block whitespace-pre-wrap break-words line-clamp-3 text-sm font-medium leading-snug">
              {data.label || ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

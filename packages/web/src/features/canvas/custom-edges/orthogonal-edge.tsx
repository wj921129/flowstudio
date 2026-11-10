/**
 * @fileoverview 90° 正交直角连线组件 (OrthogonalEdge)
 * @description 支持自动直角走线与用户手动调节折点 (Waypoints)，选中时呈现交互折点手柄
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  Position,
  MarkerType,
  type EdgeProps,
  type Edge,
} from '@xyflow/react';
import type { FlowEdgeData, XYPosition } from '@flowstudio/shared';
import { buildWaypointPath, deriveDefaultOrthogonalWaypoints } from './waypoint-path-utils';
import { useFlowStore } from '../../../stores/flow-store';

/** 折点手柄命中区边长 (px)：明显大于可视圆点，保证缩放后仍可稳定点中 */
const WAYPOINT_HIT_SIZE = 22;

/**
 * 连线终端箭头停靠间距 (px)：
 * 略微缩进 2.5px，使箭头尖端刚好停留在图元边框外沿与焦点环外圈之间，
 * 既杜绝了尖端被图元实色填充、边框或高亮选择环遮挡，又避免了悬空过远的不自然感
 */
export const TERMINAL_ARROW_DOCKING_GAP = 2.5;

/**
 * 计算终点停靠端点坐标，根据目标锚点方位沿法线方向反向偏移
 */
export function getDockingEndpoint(
  x: number,
  y: number,
  position: Position | string | undefined,
  offset: number = TERMINAL_ARROW_DOCKING_GAP
): XYPosition {
  switch (position) {
    case Position.Top:
    case 'top':
      return { x, y: y - offset };
    case Position.Bottom:
    case 'bottom':
      return { x, y: y + offset };
    case Position.Left:
    case 'left':
      return { x: x - offset, y };
    case Position.Right:
    case 'right':
      return { x: x + offset, y };
    default:
      return { x, y };
  }
}

/**
 * 动态计算 SmoothStep 折角步进偏移，防止近距离（< 40px）两图元间走线回折与过度前突
 */
export function calcStepOffset(
  sX: number,
  sY: number,
  sPos: Position | string | undefined,
  tX: number,
  tY: number,
  tPos: Position | string | undefined
): number {
  const isVertical =
    (sPos === Position.Top || sPos === Position.Bottom || sPos === 'top' || sPos === 'bottom') &&
    (tPos === Position.Top || tPos === Position.Bottom || tPos === 'top' || tPos === 'bottom');
  const isHorizontal =
    (sPos === Position.Left || sPos === Position.Right || sPos === 'left' || sPos === 'right') &&
    (tPos === Position.Left || tPos === Position.Right || tPos === 'left' || tPos === 'right');

  const dist = isVertical
    ? Math.abs(tY - sY)
    : isHorizontal
    ? Math.abs(tX - sX)
    : Math.min(Math.abs(tX - sX), Math.abs(tY - sY));

  if (dist > 0 && dist < 40) {
    return Math.max(4, Math.floor(dist / 2));
  }
  return 20;
}

/** 拖拽中的折点暂存态：仅存于本地，避免每帧写历史与 Yjs 造成手柄闪烁 */
interface WaypointDragState {
  index: number;
  points: XYPosition[];
  grabOffset: XYPosition;
}

export const OrthogonalEdge: React.FC<EdgeProps<Edge<FlowEdgeData>>> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  markerStart,
  data,
  selected,
}) => {
  const { screenToFlowPosition } = useReactFlow();
  const storedWaypoints = data?.waypoints;
  const dragRef = useRef<WaypointDragState | null>(null);
  const dragEndRef = useRef<() => void>(() => {});
  const [dragWaypoints, setDragWaypoints] = useState<XYPosition[] | null>(null);

  const waypoints = dragWaypoints ?? storedWaypoints;
  const hasWaypoints = Array.isArray(waypoints) && waypoints.length > 0;
  const isDragging = dragWaypoints !== null;

  const edgeStyleData = data?.style;
  const strokeColor = selected
    ? 'var(--fs-selection-ring)'
    : (edgeStyleData?.strokeColor ? String(edgeStyleData.strokeColor) : 'var(--fs-edge-stroke)');
  const strokeWidth = typeof edgeStyleData?.strokeWidth === 'number' ? edgeStyleData.strokeWidth : 1.5;
  const strokeDasharray = edgeStyleData?.strokeStyle === 'dashed' ? '5 5' : undefined;

  const mergedStyle: React.CSSProperties = {
    stroke: strokeColor,
    strokeWidth,
    strokeDasharray,
    ...style,
  };

  // 确保 markerEnd 颜色与连线完全一致（含选中高亮色及自定义描边色）
  const resolvedMarkerEnd = markerEnd
    ? typeof markerEnd === 'object' && markerEnd !== null
      ? {
          ...(markerEnd as Record<string, unknown>),
          color: (markerEnd as any).color || strokeColor,
        }
      : markerEnd
    : {
        type: MarkerType.ArrowClosed,
        color: strokeColor,
      };

  const resolvedMarkerStart = markerStart
    ? typeof markerStart === 'object' && markerStart !== null
      ? {
          ...(markerStart as Record<string, unknown>),
          color: (markerStart as any).color || strokeColor,
        }
      : markerStart
    : undefined;

  // 停靠端点修正：有箭头时沿目标方向回缩微小间距，露出完整箭头尖端且间距平滑
  const hasMarkerEnd = Boolean(resolvedMarkerEnd);
  const dockTarget = hasMarkerEnd
    ? getDockingEndpoint(targetX, targetY, targetPosition, TERMINAL_ARROW_DOCKING_GAP)
    : { x: targetX, y: targetY };

  const hasMarkerStart = Boolean(resolvedMarkerStart);
  const dockSource = hasMarkerStart
    ? getDockingEndpoint(sourceX, sourceY, sourcePosition, TERMINAL_ARROW_DOCKING_GAP)
    : { x: sourceX, y: sourceY };

  let edgePath: string;
  let labelX: number;
  let labelY: number;

  if (hasWaypoints) {
    const res = buildWaypointPath(
      dockSource,
      dockTarget,
      waypoints
    );
    edgePath = res.path;
    labelX = res.labelPosition.x;
    labelY = res.labelPosition.y;
  } else {
    const stepOffset = calcStepOffset(
      dockSource.x,
      dockSource.y,
      sourcePosition,
      dockTarget.x,
      dockTarget.y,
      targetPosition
    );
    const [path, lx, ly] = getSmoothStepPath({
      sourceX: dockSource.x,
      sourceY: dockSource.y,
      sourcePosition,
      targetX: dockTarget.x,
      targetY: dockTarget.y,
      targetPosition,
      borderRadius: 0,
      offset: stepOffset,
    });
    edgePath = path;
    labelX = lx;
    labelY = ly;
  }

  // 添加初始折点
  const handleAddDefaultWaypoint = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const initial = deriveDefaultOrthogonalWaypoints(
        { x: sourceX, y: sourceY },
        { x: targetX, y: targetY },
        sourcePosition,
        targetPosition
      );
      useFlowStore.getState().updateEdgeData(id, { waypoints: initial });
    },
    [id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition]
  );

  // 清除自定义折点（恢复自动直角走线）
  const handleResetWaypoints = useCallback(
    (e: React.MouseEvent | React.PointerEvent) => {
      e.stopPropagation();
      dragEndRef.current();
      useFlowStore.getState().updateEdgeData(id, { waypoints: undefined });
    },
    [id]
  );

  /**
   * 折点拖拽起始：位移全程由 screenToFlowPosition 反算画布坐标，缩放 ≠ 1 时手柄才会
   * 与光标 1:1 同步；监听挂在 window 上，指针滑出手柄小圆点也不会丢事件
   */
  const handleWaypointPointerDown = useCallback(
    (index: number, e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      if (!storedWaypoints) return;

      const points = storedWaypoints.map((p) => ({ ...p }));
      const cursor = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const grabOffset = { x: cursor.x - points[index].x, y: cursor.y - points[index].y };

      dragRef.current = { index, points, grabOffset };
      setDragWaypoints(points);

      const onPointerMove = (moveEvent: PointerEvent) => {
        const state = dragRef.current;
        if (!state) return;

        const moved = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
        const nextPoints = [...state.points];
        nextPoints[state.index] = {
          x: moved.x - state.grabOffset.x,
          y: moved.y - state.grabOffset.y,
        };

        state.points = nextPoints;
        setDragWaypoints(nextPoints);
      };

      let detach = () => {};

      // 松手（或指针被系统打断）时才一次性落库：一次拖拽只产生一条历史与一次协同提交
      const finish = () => {
        detach();

        const state = dragRef.current;
        dragRef.current = null;
        setDragWaypoints(null);
        if (!state) return;

        useFlowStore.getState().updateEdgeData(
          id,
          { waypoints: state.points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) }
        );
      };

      detach = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
      };

      dragEndRef.current = () => {
        detach();
        dragRef.current = null;
        setDragWaypoints(null);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
    },
    [storedWaypoints, screenToFlowPosition, id]
  );

  // 组件卸载（连线被删、图切换）时兜底摘除 window 监听
  useEffect(() => () => dragEndRef.current(), []);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={mergedStyle}
        markerEnd={markerEnd}
        markerStart={markerStart}
      />

      <EdgeLabelRenderer>
        {/* 连线文字标签 */}
        {data?.label && (
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan px-1.5 py-0.5 rounded text-xs bg-[var(--fs-surface)] border border-[var(--fs-border)] text-[var(--fs-text)] shadow-xs select-none"
          >
            {data.label}
          </div>
        )}

        {/* 选中时的折点交互手柄 */}
        {selected && (
          <>
            {hasWaypoints ? (
              <>
                {waypoints.map((wp: XYPosition, idx: number) => (
                  <div
                    key={`wp-${idx}`}
                    onPointerDown={(e) => handleWaypointPointerDown(idx, e)}
                    onDoubleClick={handleResetWaypoints}
                    title="按住拖拽调整折点，双击恢复自动走线"
                    style={{
                      position: 'absolute',
                      width: WAYPOINT_HIT_SIZE,
                      height: WAYPOINT_HIT_SIZE,
                      transform: `translate(-50%, -50%) translate(${wp.x}px,${wp.y}px)`,
                      pointerEvents: 'all',
                    }}
                    className="nodrag nopan touch-none flex items-center justify-center cursor-move select-none z-20"
                  >
                    <span
                      className={`rounded-full bg-white dark:bg-zinc-900 border-2 border-[var(--fs-selection-ring)] shadow-sm ${
                        isDragging
                          ? 'w-3.5 h-3.5'
                          : 'w-2.5 h-2.5 hover:w-3.5 hover:h-3.5 transition-[width,height] duration-100'
                      }`}
                    />
                  </div>
                ))}
              </>
            ) : (
              <button
                onClick={handleAddDefaultWaypoint}
                title="点击为当前连线启用折点调整"
                style={{
                  position: 'absolute',
                  transform: `translate(-50%, -50%) translate(${labelX}px,${labelY + (data?.label ? 18 : 0)}px)`,
                  pointerEvents: 'all',
                }}
                className="nodrag nopan px-1.5 py-0.5 rounded-full text-[10px] bg-[var(--fs-surface)] border border-[var(--fs-selection-ring)] text-[var(--fs-selection-ring)] shadow-xs hover:bg-[var(--fs-selection-ring)]/10 cursor-pointer select-none transition-colors z-20"
              >
                调折点
              </button>
            )}
          </>
        )}
      </EdgeLabelRenderer>
    </>
  );
};

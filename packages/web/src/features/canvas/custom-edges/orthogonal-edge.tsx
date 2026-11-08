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
  type EdgeProps,
  type Edge,
} from '@xyflow/react';
import type { FlowEdgeData, XYPosition } from '@flowstudio/shared';
import { buildWaypointPath, deriveDefaultOrthogonalWaypoints } from './waypoint-path-utils';
import { useFlowStore } from '../../../stores/flow-store';

/** 折点手柄命中区边长 (px)：明显大于可视圆点，保证缩放后仍可稳定点中 */
const WAYPOINT_HIT_SIZE = 22;

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

  let edgePath: string;
  let labelX: number;
  let labelY: number;

  if (hasWaypoints) {
    const res = buildWaypointPath(
      { x: sourceX, y: sourceY },
      { x: targetX, y: targetY },
      waypoints
    );
    edgePath = res.path;
    labelX = res.labelPosition.x;
    labelY = res.labelPosition.y;
  } else {
    const [path, lx, ly] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      borderRadius: 0,
    });
    edgePath = path;
    labelX = lx;
    labelY = ly;
  }

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

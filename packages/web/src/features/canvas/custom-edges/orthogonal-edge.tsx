/**
 * @fileoverview 90° 正交直角连线组件 (OrthogonalEdge)
 * @description 支持自动直角走线与用户手动调节折点 (Waypoints)，选中时呈现交互折点手柄
 */

import React, { useCallback } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
  type Edge,
} from '@xyflow/react';
import type { FlowEdgeData, XYPosition } from '@flowstudio/shared';
import { buildWaypointPath, deriveDefaultOrthogonalWaypoints } from './waypoint-path-utils';
import { useFlowStore } from '../../../stores/flow-store';

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
  const customWaypoints = data?.waypoints;
  const hasCustomWaypoints = Array.isArray(customWaypoints) && customWaypoints.length > 0;

  let edgePath: string;
  let labelX: number;
  let labelY: number;

  if (hasCustomWaypoints) {
    const res = buildWaypointPath(
      { x: sourceX, y: sourceY },
      { x: targetX, y: targetY },
      customWaypoints
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
        { x: targetX, y: targetY }
      );
      useFlowStore.getState().updateEdgeData(id, { waypoints: initial });
    },
    [id, sourceX, sourceY, targetX, targetY]
  );

  // 清除自定义折点（恢复自动直角路由）
  const handleResetWaypoints = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      useFlowStore.getState().updateEdgeData(id, { waypoints: undefined });
    },
    [id]
  );

  // 拖拽调整特定折点位置
  const handleWaypointDrag = useCallback(
    (index: number, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!customWaypoints) return;

      const startMouseX = e.clientX;
      const startMouseY = e.clientY;
      const origPoint = customWaypoints[index];

      const onMouseMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.clientX - startMouseX;
        const dy = moveEvent.clientY - startMouseY;
        const nextPoints = [...customWaypoints];
        nextPoints[index] = {
          x: Math.round(origPoint.x + dx),
          y: Math.round(origPoint.y + dy),
        };
        useFlowStore.getState().updateEdgeData(id, { waypoints: nextPoints });
      };

      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [id, customWaypoints]
  );

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
            {hasCustomWaypoints ? (
              <>
                {customWaypoints.map((wp: XYPosition, idx: number) => (
                  <div
                    key={`wp-${idx}`}
                    onMouseDown={(e) => handleWaypointDrag(idx, e)}
                    onDoubleClick={handleResetWaypoints}
                    title="按住拖拽调整折点，双击恢复自动走线"
                    style={{
                      position: 'absolute',
                      transform: `translate(-50%, -50%) translate(${wp.x}px,${wp.y}px)`,
                      pointerEvents: 'all',
                    }}
                    className="nodrag nopan w-3.5 h-3.5 rounded-full bg-white dark:bg-zinc-900 border-2 border-[var(--fs-selection-ring)] shadow-sm cursor-move hover:scale-125 transition-transform select-none z-20"
                  />
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

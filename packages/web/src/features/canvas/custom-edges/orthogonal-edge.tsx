/**
 * @fileoverview 90° 正交直角连线组件 (OrthogonalEdge)
 * @description 使用 getSmoothStepPath({ borderRadius: 0 }) 实现标准流程图正交直角路由，支持端点箭头、文本标签与动态样式映射
 */

import React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
  type Edge,
} from '@xyflow/react';
import type { FlowEdgeData } from '@flowstudio/shared';

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
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 0,
  });

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

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={mergedStyle}
        markerEnd={markerEnd}
        markerStart={markerStart}
      />
      {data?.label && (
        <EdgeLabelRenderer>
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
        </EdgeLabelRenderer>
      )}
    </>
  );
};

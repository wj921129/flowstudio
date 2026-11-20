import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  useReactFlow,
  Position,
  MarkerType,
  type EdgeProps,
  type Edge,
} from '@xyflow/react';
import type { FlowEdgeData, XYPosition } from '@flowstudio/shared';
import { getEdgeDashArray } from '@flowstudio/shared';
import {
  getPointAtPolylineRatio,
  getSegmentAxis,
  moveOrthogonalSegment,
  projectPointOntoPolyline,
  simplifyOrthogonalWaypoints,
  type EdgeAnchorDirection,
} from './waypoint-path-utils';
import { useFlowStore } from '../../../stores/flow-store';
import { EdgeRoutingManager } from './edge-routing-manager';
import { InlineTextEditor } from '../custom-nodes/inline-text-editor';

const WAYPOINT_HIT_SIZE = 22;
export const TERMINAL_ARROW_DOCKING_GAP = 2.5;

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

interface WaypointDragState {
  index: number;
  points: XYPosition[];
  grabOffset: XYPosition;
}

export const OrthogonalEdge: React.FC<EdgeProps<Edge<FlowEdgeData>>> = ({
  id,
  type,
  source,
  target,
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
  interactionWidth,
}) => {
  const { screenToFlowPosition } = useReactFlow();
  const storedWaypoints = data?.waypoints;
  const dragRef = useRef<WaypointDragState | null>(null);
  const dragEndRef = useRef<() => void>(() => {});
  const [dragWaypoints, setDragWaypoints] = useState<XYPosition[] | null>(null);
  const [dragLabelRatio, setDragLabelRatio] = useState<number | null>(null);
  const labelDragEndRef = useRef<() => void>(() => {});
  const editingEdgeLabelId = useFlowStore((s) => s.editingEdgeLabelId);
  const setEditingEdgeLabelId = useFlowStore((s) => s.setEditingEdgeLabelId);
  const selectedEdgeLabelId = useFlowStore((s) => s.selectedEdgeLabelId);
  const setSelectedEdgeLabelId = useFlowStore((s) => s.setSelectedEdgeLabelId);
  const isEditingLabel = editingEdgeLabelId === id;
  const isLabelSelected = selectedEdgeLabelId === id;
  const [labelDraft, setLabelDraft] = useState(data?.label || '');

  useEffect(() => {
    if (isEditingLabel) {
      setLabelDraft(data?.label || '');
    }
  }, [isEditingLabel, data?.label]);

  const waypoints = dragWaypoints ?? storedWaypoints;
  const hasWaypoints = Array.isArray(waypoints) && waypoints.length > 0;
  const isDragging = dragWaypoints !== null;

  const edgeStyleData = data?.style;
  const strokeColor = selected
    ? 'var(--fs-selection-ring)'
    : (edgeStyleData?.strokeColor ? String(edgeStyleData.strokeColor) : 'var(--fs-edge-stroke)');
  const strokeWidth = typeof edgeStyleData?.strokeWidth === 'number' ? edgeStyleData.strokeWidth : 1.5;
  const strokeDasharray = getEdgeDashArray(edgeStyleData?.strokeStyle);

  const mergedStyle: React.CSSProperties = {
    stroke: strokeColor,
    strokeWidth,
    strokeDasharray,
    ...(edgeStyleData?.strokeStyle === 'dotted' ? { strokeLinecap: 'round' as const } : {}),
    ...style,
  };

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

  const hasMarkerEnd = Boolean(resolvedMarkerEnd);
  const dockTarget = hasMarkerEnd
    ? getDockingEndpoint(targetX, targetY, targetPosition, TERMINAL_ARROW_DOCKING_GAP)
    : { x: targetX, y: targetY };

  const hasMarkerStart = Boolean(resolvedMarkerStart);
  const dockSource = hasMarkerStart
    ? getDockingEndpoint(sourceX, sourceY, sourcePosition, TERMINAL_ARROW_DOCKING_GAP)
    : { x: sourceX, y: sourceY };

  const manager = EdgeRoutingManager.getInstance();
  if (manager.getObstacles().length === 0) {
    const currentNodes = useFlowStore.getState().nodes;
    if (currentNodes.length > 0) manager.updateNodes(currentNodes);
  }

  const isStraight = type === 'straight' || data?.routingType === 'straight';

  const computedRoute = useMemo(() => {
    if (isStraight) {
      return {
        path: `M ${dockSource.x} ${dockSource.y} L ${dockTarget.x} ${dockTarget.y}`,
        waypoints: [],
        labelPosition: {
          x: (dockSource.x + dockTarget.x) / 2,
          y: (dockSource.y + dockTarget.y) / 2,
        },
      };
    }
    return manager.routeEdge({
      id,
      source: dockSource,
      target: dockTarget,
      sourcePosition: sourcePosition as EdgeAnchorDirection,
      targetPosition: targetPosition as EdgeAnchorDirection,
      sourceNodeId: source,
      targetNodeId: target,
      manualWaypoints: waypoints,
      label: data?.label,
    });
  }, [
    isStraight,
    id,
    dockSource.x,
    dockSource.y,
    dockTarget.x,
    dockTarget.y,
    sourcePosition,
    targetPosition,
    source,
    target,
    waypoints,
    data?.label,
  ]);

  const edgePath = computedRoute.path;
  const polylinePoints = useMemo(
    () => [dockSource, ...(computedRoute.waypoints || []), dockTarget],
    [dockSource.x, dockSource.y, dockTarget.x, dockTarget.y, computedRoute.waypoints]
  );
  const activeRatio = dragLabelRatio ?? (typeof data?.labelRatio === 'number' ? data.labelRatio : null);
  const resolvedLabelPos = useMemo(
    () =>
      activeRatio !== null
        ? getPointAtPolylineRatio(polylinePoints, activeRatio)
        : computedRoute.labelPosition,
    [activeRatio, polylinePoints, computedRoute.labelPosition]
  );
  const labelX = resolvedLabelPos.x;
  const labelY = resolvedLabelPos.y;

  const commitLabel = useCallback(() => {
    if (!isEditingLabel) return;
    setEditingEdgeLabelId(null);
    const trimmed = labelDraft.trim();
    const prev = (data?.label || '').trim();
    if (trimmed !== prev) {
      useFlowStore.getState().updateEdgeData(id, { label: trimmed || undefined });
    }
  }, [isEditingLabel, setEditingEdgeLabelId, labelDraft, data?.label, id]);

  const handleLabelPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || isEditingLabel) return;
      e.stopPropagation();
      const startClient = { x: e.clientX, y: e.clientY };
      let moved = false;
      let latestRatio: number | null = null;

      const onMove = (moveEvent: PointerEvent) => {
        if (!moved && Math.hypot(moveEvent.clientX - startClient.x, moveEvent.clientY - startClient.y) < 3) {
          return;
        }
        moved = true;
        const cursor = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
        const { ratio } = projectPointOntoPolyline(polylinePoints, cursor);
        latestRatio = ratio;
        setDragLabelRatio(ratio);
      };

      let detach = () => {};
      const finish = () => {
        detach();
        setDragLabelRatio(null);
        if (moved && latestRatio !== null) {
          useFlowStore.getState().updateEdgeData(id, { labelRatio: latestRatio });
        } else if (!moved) {
          setSelectedEdgeLabelId(id);
        }
      };

      detach = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
      };
      labelDragEndRef.current = () => {
        detach();
        setDragLabelRatio(null);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
    },
    [isEditingLabel, screenToFlowPosition, polylinePoints, id, setSelectedEdgeLabelId]
  );

  const segmentHandles = useMemo(() => {
    if (isStraight) return [];
    return polylinePoints.slice(0, -1).flatMap((a, i) => {
      const b = polylinePoints[i + 1];
      const axis = getSegmentAxis(a, b);
      if (!axis || Math.hypot(b.x - a.x, b.y - a.y) < 16) return [];
      return [{ index: i, axis, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, qx: (3 * a.x + b.x) / 4, qy: (3 * a.y + b.y) / 4 }];
    });
  }, [isStraight, polylinePoints]);

  const handleSegmentPointerDown = useCallback(
    (index: number, axis: 'h' | 'v', e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const src = { ...dockSource };
      const tgt = { ...dockTarget };
      const base = (computedRoute.waypoints || []).map((p) => ({ ...p }));
      const start = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      let latest = base;

      const onPointerMove = (moveEvent: PointerEvent) => {
        const cur = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
        const offset = axis === 'h' ? cur.y - start.y : cur.x - start.x;
        latest = moveOrthogonalSegment(src, tgt, base, index, offset);
        setDragWaypoints(latest);
      };

      let detach = () => {};
      const finish = () => {
        detach();
        setDragWaypoints(null);
        if (latest === base) return;
        const next = simplifyOrthogonalWaypoints(src, tgt, latest);
        useFlowStore.getState().updateEdgeData(id, { waypoints: next.length ? next : undefined });
      };

      detach = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
      };
      dragEndRef.current = () => {
        detach();
        setDragWaypoints(null);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
    },
    [dockSource.x, dockSource.y, dockTarget.x, dockTarget.y, computedRoute.waypoints, screenToFlowPosition, id]
  );

  const handleResetWaypoints = useCallback(
    (e: React.MouseEvent | React.PointerEvent) => {
      e.stopPropagation();
      dragEndRef.current();
      useFlowStore.getState().updateEdgeData(id, { waypoints: undefined });
    },
    [id]
  );

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

  useEffect(() => () => {
    dragEndRef.current();
    labelDragEndRef.current();
    manager.unregisterEdge(id);
  }, [id]);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={mergedStyle}
        markerEnd={markerEnd}
        markerStart={markerStart}
        interactionWidth={mergedStyle?.pointerEvents === 'none' ? 0 : interactionWidth}
      />

      <EdgeLabelRenderer>
        {isEditingLabel ? (
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan z-30"
          >
            <InlineTextEditor
              value={labelDraft}
              onChange={setLabelDraft}
              onCommit={commitLabel}
              onCancel={() => setEditingEdgeLabelId(null)}
              placeholder="输入连线标签…"
              wrapperClassName="min-w-16 px-1.5 py-0.5 rounded bg-[var(--fs-surface)] border border-[var(--fs-selection-ring)] shadow-md"
              className="text-center text-xs text-[var(--fs-text)]"
            />
          </div>
        ) : data?.label ? (
          <div
            onPointerDown={handleLabelPointerDown}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditingEdgeLabelId(id);
            }}
            title="按住沿连线拖动位置，双击编辑标签"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className={`nodrag nopan whitespace-pre-wrap text-center px-1.5 py-0.5 rounded text-xs bg-[var(--fs-surface)] border text-[var(--fs-text)] shadow-xs select-none touch-none ${
              dragLabelRatio !== null
                ? 'cursor-grabbing border-[var(--fs-selection-ring)] ring-2 ring-[var(--fs-selection-ring)]'
                : isLabelSelected
                  ? 'cursor-grab border-[var(--fs-selection-ring)] ring-2 ring-[var(--fs-selection-ring)] shadow-md'
                  : 'cursor-grab border-[var(--fs-border)] hover:border-[var(--fs-selection-ring)]'
            }`}
          >
            {data.label}
          </div>
        ) : null}

        {selected && !isEditingLabel && (
          <>
            {segmentHandles.map((seg) => {
              const nearLabel = Math.hypot(seg.x - labelX, seg.y - labelY) < 28;
              const hx = nearLabel ? seg.qx : seg.x;
              const hy = nearLabel ? seg.qy : seg.y;
              return (
                <div
                  key={`seg-${seg.index}`}
                  onPointerDown={(e) => handleSegmentPointerDown(seg.index, seg.axis, e)}
                  onDoubleClick={handleResetWaypoints}
                  title={seg.axis === 'h' ? '按住上下拖动线段，双击恢复自动走线' : '按住左右拖动线段，双击恢复自动走线'}
                  style={{
                    position: 'absolute',
                    width: seg.axis === 'h' ? 26 : 14,
                    height: seg.axis === 'h' ? 14 : 26,
                    transform: `translate(-50%, -50%) translate(${hx}px,${hy}px)`,
                    pointerEvents: 'all',
                  }}
                  className={`nodrag nopan touch-none flex items-center justify-center select-none z-20 ${
                    seg.axis === 'h' ? 'cursor-ns-resize' : 'cursor-ew-resize'
                  }`}
                >
                  <span
                    className={`rounded-full bg-[var(--fs-selection-ring)] opacity-80 hover:opacity-100 shadow-sm ${
                      seg.axis === 'h' ? 'w-4 h-1.5' : 'w-1.5 h-4'
                    }`}
                  />
                </div>
              );
            })}
            {hasWaypoints &&
              waypoints.map((wp: XYPosition, idx: number) => (
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
            {!data?.label && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingEdgeLabelId(id);
                }}
                title="点击为连线添加中间标签"
                style={{
                  position: 'absolute',
                  transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
                  pointerEvents: 'all',
                }}
                className="nodrag nopan px-1.5 py-0.5 rounded-full text-[10px] bg-[var(--fs-surface)] border border-[var(--fs-selection-ring)] text-[var(--fs-selection-ring)] shadow-xs hover:bg-[var(--fs-selection-ring)]/10 cursor-pointer select-none transition-colors z-20"
              >
                + 标签
              </button>
            )}
          </>
        )}
      </EdgeLabelRenderer>
    </>
  );
};

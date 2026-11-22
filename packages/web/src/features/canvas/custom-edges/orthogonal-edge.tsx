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
  SEGMENT_MERGE_SNAP_THRESHOLD,
  findNearestNodeBorderAnchor,
  getPointAtPolylineRatio,
  getSegmentAxis,
  inferAnchorDirection,
  moveOrthogonalSegment,
  projectPointOntoPolyline,
  simplifyOrthogonalWaypoints,
  type EdgeAnchorDirection,
  type ReconnectAnchorHit,
} from './waypoint-path-utils';
import { useFlowStore } from '../../../stores/flow-store';
import { usePresentationStore } from '../../presentation';
import { EdgeRoutingManager } from './edge-routing-manager';
import { InlineTextEditor } from '../custom-nodes/inline-text-editor';

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
  const dragEndRef = useRef<() => void>(() => {});
  const [dragWaypoints, setDragWaypoints] = useState<XYPosition[] | null>(null);
  const [endpointDrag, setEndpointDrag] = useState<{
    end: 'source' | 'target';
    cursor: XYPosition;
    snapped: ReconnectAnchorHit | null;
  } | null>(null);
  const endpointDragEndRef = useRef<() => void>(() => {});
  const [dragLabelRatio, setDragLabelRatio] = useState<number | null>(null);
  const labelDragEndRef = useRef<() => void>(() => {});
  const editingEdgeLabelId = useFlowStore((s) => s.editingEdgeLabelId);
  const setEditingEdgeLabelId = useFlowStore((s) => s.setEditingEdgeLabelId);
  const selectedEdgeLabelId = useFlowStore((s) => s.selectedEdgeLabelId);
  const setSelectedEdgeLabelId = useFlowStore((s) => s.setSelectedEdgeLabelId);
  const activeTool = useFlowStore((s) => s.activeTool);
  const isSpacePanning = useFlowStore((s) => s.isSpacePanning);
  const isReadOnly = usePresentationStore((s) => s.isReadOnly);
  const isPanOrLocked = isSpacePanning || isReadOnly || activeTool === 'pan';
  const isEditingLabel = editingEdgeLabelId === id;
  const isLabelSelected = selectedEdgeLabelId === id;
  const [labelDraft, setLabelDraft] = useState(data?.label || '');

  useEffect(() => {
    if (isEditingLabel) {
      setLabelDraft(data?.label || '');
    }
  }, [isEditingLabel, data?.label]);

  const waypoints = dragWaypoints ?? data?.waypoints;

  const edgeStyleData = data?.style;
  const incomingStroke = typeof style?.stroke === 'string' ? style.stroke : undefined;
  const isTransientHighlightStroke =
    incomingStroke === '#6366f1' || Boolean(incomingStroke?.includes('--fs-selection-ring'));
  const baseStrokeWidth = typeof edgeStyleData?.strokeWidth === 'number' ? edgeStyleData.strokeWidth : 1.5;
  const strokeColor =
    selected && incomingStroke !== '#6366f1'
      ? 'var(--fs-selection-ring)'
      : isTransientHighlightStroke
      ? incomingStroke!
      : edgeStyleData?.strokeColor
      ? String(edgeStyleData.strokeColor)
      : incomingStroke || 'var(--fs-edge-stroke)';
  const strokeWidth = selected ? Math.max(baseStrokeWidth, 2) : baseStrokeWidth;
  const strokeDasharray = getEdgeDashArray(edgeStyleData?.strokeStyle);

  const mergedStyle: React.CSSProperties = {
    ...style,
    stroke: strokeColor,
    strokeWidth,
    strokeDasharray,
    ...(edgeStyleData?.strokeStyle === 'dotted' ? { strokeLinecap: 'round' as const } : {}),
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

  const isDraggingSourceEnd = endpointDrag?.end === 'source';
  const isDraggingTargetEnd = endpointDrag?.end === 'target';

  const activeSourcePos: XYPosition = isDraggingSourceEnd
    ? endpointDrag.snapped?.position ?? endpointDrag.cursor
    : { x: sourceX, y: sourceY };
  const activeTargetPos: XYPosition = isDraggingTargetEnd
    ? endpointDrag.snapped?.position ?? endpointDrag.cursor
    : { x: targetX, y: targetY };

  const activeSourceDirection = isDraggingSourceEnd
    ? (endpointDrag.snapped?.side ?? inferAnchorDirection(activeSourcePos, activeTargetPos))
    : (sourcePosition as EdgeAnchorDirection);
  const activeTargetDirection = isDraggingTargetEnd
    ? (endpointDrag.snapped?.side ?? inferAnchorDirection(activeTargetPos, activeSourcePos))
    : (targetPosition as EdgeAnchorDirection);

  const hasMarkerEnd = Boolean(resolvedMarkerEnd);
  const dockTarget = hasMarkerEnd
    ? getDockingEndpoint(activeTargetPos.x, activeTargetPos.y, activeTargetDirection, TERMINAL_ARROW_DOCKING_GAP)
    : activeTargetPos;

  const hasMarkerStart = Boolean(resolvedMarkerStart);
  const dockSource = hasMarkerStart
    ? getDockingEndpoint(activeSourcePos.x, activeSourcePos.y, activeSourceDirection, TERMINAL_ARROW_DOCKING_GAP)
    : activeSourcePos;

  const manager = EdgeRoutingManager.getInstance();
  if (manager.getObstacles().length === 0) {
    const currentNodes = useFlowStore.getState().nodes;
    if (currentNodes.length > 0) manager.updateNodes(currentNodes);
  }

  const isStraight = type === 'straight' || data?.routingType === 'straight';
  const effectiveSourceNodeId = isDraggingSourceEnd ? endpointDrag.snapped?.nodeId : source;
  const effectiveTargetNodeId = isDraggingTargetEnd ? endpointDrag.snapped?.nodeId : target;
  const routeManualWaypoints = endpointDrag ? undefined : waypoints;

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
      sourcePosition: activeSourceDirection,
      targetPosition: activeTargetDirection,
      sourceNodeId: effectiveSourceNodeId,
      targetNodeId: effectiveTargetNodeId,
      manualWaypoints: routeManualWaypoints,
      label: data?.label,
    });
  }, [
    isStraight,
    id,
    dockSource.x,
    dockSource.y,
    dockTarget.x,
    dockTarget.y,
    activeSourceDirection,
    activeTargetDirection,
    effectiveSourceNodeId,
    effectiveTargetNodeId,
    routeManualWaypoints,
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
      if (e.button !== 0 || isEditingLabel || isPanOrLocked) return;
      e.stopPropagation();
      setSelectedEdgeLabelId(id);
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
        }
        setSelectedEdgeLabelId(id);
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
    [isEditingLabel, isPanOrLocked, screenToFlowPosition, polylinePoints, id, setSelectedEdgeLabelId]
  );

  const segmentHandles = useMemo(() => {
    if (isStraight || polylinePoints.length <= 2) return [];
    const lastSeg = polylinePoints.length - 2;
    return polylinePoints.slice(0, -1).flatMap((a, i) => {
      if (i === 0 || i === lastSeg) return [];
      const b = polylinePoints[i + 1];
      const axis = getSegmentAxis(a, b);
      if (!axis || Math.hypot(b.x - a.x, b.y - a.y) < 16) return [];
      return [{ index: i, axis, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, qx: (3 * a.x + b.x) / 4, qy: (3 * a.y + b.y) / 4 }];
    });
  }, [isStraight, polylinePoints]);

  const handleSegmentPointerDown = useCallback(
    (index: number, axis: 'h' | 'v', e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || isPanOrLocked) return;
      e.stopPropagation();
      const src = { ...dockSource };
      const tgt = { ...dockTarget };
      const base = (computedRoute.waypoints || []).map((p) => ({ ...p }));
      const start = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      let latest = base;

      const onPointerMove = (moveEvent: PointerEvent) => {
        const cur = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
        const offset = axis === 'h' ? cur.y - start.y : cur.x - start.x;
        const zoom = useFlowStore.getState().viewportZoom || 1;
        const snapThreshold = moveEvent.altKey
          ? 0
          : Math.min(12, Math.max(5, SEGMENT_MERGE_SNAP_THRESHOLD / Math.max(0.25, zoom)));
        latest = moveOrthogonalSegment(src, tgt, base, index, offset, snapThreshold);
        const preview =
          latest.length === 0 && (Math.abs(src.x - tgt.x) < 1 || Math.abs(src.y - tgt.y) < 1)
            ? [{ x: (src.x + tgt.x) / 2, y: (src.y + tgt.y) / 2 }]
            : latest;
        setDragWaypoints(preview);
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
    [isPanOrLocked, dockSource.x, dockSource.y, dockTarget.x, dockTarget.y, computedRoute.waypoints, screenToFlowPosition, id]
  );

  const handleEndpointPointerDown = useCallback(
    (end: 'source' | 'target', e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || isPanOrLocked) return;
      e.preventDefault();
      e.stopPropagation();

      const oppositeNodeId = end === 'source' ? target : source;
      const startFlow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      let latestHit: ReconnectAnchorHit | null = findNearestNodeBorderAnchor(
        startFlow,
        useFlowStore.getState().nodes,
        oppositeNodeId,
        { disableBorderSnap: e.altKey }
      );

      useFlowStore.getState().setReconnectingEdge(true);
      setEndpointDrag({ end, cursor: startFlow, snapped: latestHit });

      const onPointerMove = (moveEvent: PointerEvent) => {
        const cur = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
        latestHit = findNearestNodeBorderAnchor(cur, useFlowStore.getState().nodes, oppositeNodeId, {
          disableBorderSnap: moveEvent.altKey,
        });
        setEndpointDrag({ end, cursor: cur, snapped: latestHit });
      };

      let detach = () => {};
      const cleanup = () => {
        detach();
        setEndpointDrag(null);
        useFlowStore.getState().setReconnectingEdge(false);
      };

      const finish = () => {
        const hit = latestHit;
        cleanup();
        if (!hit) return;
        const store = useFlowStore.getState();
        const currentEdge = store.edges.find((item) => item.id === id);
        if (!currentEdge) return;
        store.reconnectEdge(currentEdge, {
          source: end === 'source' ? hit.nodeId : currentEdge.source,
          target: end === 'target' ? hit.nodeId : currentEdge.target,
          sourceHandle: end === 'source' ? hit.handleId : (currentEdge.sourceHandle ?? null),
          targetHandle: end === 'target' ? hit.handleId : (currentEdge.targetHandle ?? null),
        });
      };

      detach = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', cleanup);
      };
      endpointDragEndRef.current = cleanup;

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', cleanup);
    },
    [isPanOrLocked, source, target, screenToFlowPosition, id]
  );

  const handleResetWaypoints = useCallback(
    (e: React.MouseEvent | React.PointerEvent) => {
      if (isPanOrLocked) return;
      e.stopPropagation();
      dragEndRef.current();
      useFlowStore.getState().updateEdgeData(id, { waypoints: undefined });
    },
    [id, isPanOrLocked]
  );

  useEffect(() => {
    if (isPanOrLocked) {
      dragEndRef.current();
      labelDragEndRef.current();
      endpointDragEndRef.current();
    }
  }, [isPanOrLocked]);

  useEffect(() => () => {
    dragEndRef.current();
    labelDragEndRef.current();
    endpointDragEndRef.current();
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
            onClick={(e) => {
              if (!isPanOrLocked) e.stopPropagation();
            }}
            onDoubleClick={(e) => {
              if (isPanOrLocked) return;
              e.stopPropagation();
              setEditingEdgeLabelId(id);
            }}
            title={isPanOrLocked ? undefined : '按住沿连线拖动位置，双击编辑标签'}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className={`fs-edge-label ${isPanOrLocked ? '' : 'nodrag nopan '}relative whitespace-pre-wrap text-center px-1.5 py-0.5 rounded text-xs bg-[var(--fs-surface)] border text-[var(--fs-text)] shadow-xs select-none touch-none ${
              dragLabelRatio !== null || (isLabelSelected && !isPanOrLocked)
                ? 'border-[var(--fs-selection-ring)] ring-2 ring-[var(--fs-selection-ring)] shadow-md'
                : isPanOrLocked
                  ? 'border-[var(--fs-border)]'
                  : 'border-[var(--fs-border)] hover:border-[var(--fs-selection-ring)]'
            }`}
          >
            {data.label}
            {isLabelSelected && !isEditingLabel && !isPanOrLocked && (
              <button
                type="button"
                aria-label="删除连线标签"
                title="删除连线标签 (Delete)"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  useFlowStore.getState().deleteEdgeLabel(id);
                }}
                className="nodrag nopan absolute -top-2 -right-2 w-4 h-4 rounded-full bg-rose-500 hover:bg-rose-600 text-white text-[10px] leading-none flex items-center justify-center shadow-sm cursor-pointer z-30"
              >
                ×
              </button>
            )}
          </div>
        ) : null}

        {selected && !isEditingLabel && !isPanOrLocked && (
          <>
            <div
              role="button"
              aria-label="拖动连线起点"
              title="按住拖动连线起点到任意元素边框"
              onPointerDown={(e) => handleEndpointPointerDown('source', e)}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                width: 22,
                height: 22,
                transform: `translate(-50%, -50%) translate(${activeSourcePos.x}px,${activeSourcePos.y}px)`,
                pointerEvents: 'all',
              }}
              className="nodrag nopan touch-none flex items-center justify-center cursor-crosshair select-none z-40 group/end"
            >
              <span
                className={`rounded-full border-2 border-[var(--fs-selection-ring)] shadow-sm transition-transform ${
                  isDraggingSourceEnd
                    ? 'w-3.5 h-3.5 bg-[var(--fs-selection-ring)] scale-110'
                    : 'w-2.5 h-2.5 bg-[var(--fs-surface,#ffffff)] group-hover/end:scale-125 group-hover/end:bg-[var(--fs-selection-ring)]'
                }`}
              />
            </div>
            <div
              role="button"
              aria-label="拖动连线终点"
              title="按住拖动连线终点到任意元素边框"
              onPointerDown={(e) => handleEndpointPointerDown('target', e)}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                width: 22,
                height: 22,
                transform: `translate(-50%, -50%) translate(${activeTargetPos.x}px,${activeTargetPos.y}px)`,
                pointerEvents: 'all',
              }}
              className="nodrag nopan touch-none flex items-center justify-center cursor-crosshair select-none z-40 group/end"
            >
              <span
                className={`rounded-full border-2 border-[var(--fs-selection-ring)] shadow-sm transition-transform ${
                  isDraggingTargetEnd
                    ? 'w-3.5 h-3.5 bg-[var(--fs-selection-ring)] scale-110'
                    : 'w-2.5 h-2.5 bg-[var(--fs-surface,#ffffff)] group-hover/end:scale-125 group-hover/end:bg-[var(--fs-selection-ring)]'
                }`}
              />
            </div>
            {!endpointDrag &&
              segmentHandles.map((seg) => {
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
          </>
        )}
      </EdgeLabelRenderer>
    </>
  );
};

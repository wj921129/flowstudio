/**
 * @fileoverview 画布辅助控制组件 (CanvasControls)
 * @description 位于画布左下角与右上角，提供缩放、自适应视口以及小地图 MiniMap 导航定位控制
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Panel, useReactFlow, MiniMap, type MiniMapNodeProps } from '@xyflow/react';
import { ZoomIn, ZoomOut, Maximize2, Map as MapIcon, MessageSquare, MessagesSquare, X } from 'lucide-react';
import { useCommentsStore } from '../comments';
import { usePresentationStore } from '../presentation';
import { useFlowStore } from '../../stores/flow-store';
import {
  computeCanvasTranslateExtent,
  resolveMiniMapFlowPosition,
  type MiniMapRectLike,
  type MiniMapViewBoxLike,
} from './utils/canvas-bounds';
import type { FlowNodeData } from '@flowstudio/shared';

function readMiniMapSvgMetrics(
  container: HTMLElement
): { rect: MiniMapRectLike; viewBox: MiniMapViewBoxLike } | null {
  const svg = container.querySelector('.react-flow__minimap-svg') as SVGSVGElement | null;
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  const baseVal = svg.viewBox?.baseVal;
  if (baseVal && baseVal.width > 0 && baseVal.height > 0) {
    return {
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      viewBox: { x: baseVal.x, y: baseVal.y, width: baseVal.width, height: baseVal.height },
    };
  }
  const rawViewBox = svg.getAttribute('viewBox');
  if (!rawViewBox) return null;
  const parts = rawViewBox.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return {
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    viewBox: { x: parts[0], y: parts[1], width: parts[2], height: parts[3] },
  };
}

const MiniMapFocusNode = React.memo<MiniMapNodeProps>(
  ({
    id,
    x,
    y,
    width,
    height,
    style,
    color,
    strokeColor,
    strokeWidth,
    className,
    borderRadius,
    shapeRendering,
    selected,
    onClick,
  }) => {
    const fill = color || style?.background || style?.backgroundColor;
    const pad = Math.min(20, Math.max(10, Math.min(width, height) * 0.2));
    return (
      <g>
        <rect
          className={`react-flow__minimap-node${selected ? ' selected' : ''}${className ? ` ${className}` : ''}`}
          x={x}
          y={y}
          rx={borderRadius}
          ry={borderRadius}
          width={width}
          height={height}
          style={{
            fill: typeof fill === 'string' ? fill : undefined,
            stroke: strokeColor,
            strokeWidth,
          }}
          shapeRendering={shapeRendering}
          onClick={onClick ? (event) => onClick(event, id) : undefined}
        />
        {selected && (
          <rect
            className="fs-minimap-focus-ring"
            x={x - pad}
            y={y - pad}
            width={width + pad * 2}
            height={height + pad * 2}
            rx={borderRadius + 4}
            ry={borderRadius + 4}
            fill="none"
            stroke="var(--fs-primary)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            shapeRendering="geometricPrecision"
            pointerEvents="none"
          />
        )}
      </g>
    );
  }
);

export const CanvasControls: React.FC = () => {
  const { zoomIn, zoomOut, fitView, setCenter, getZoom } = useReactFlow();
  const [showMiniMap, setShowMiniMap] = useState(true);
  const miniMapContainerRef = useRef<HTMLDivElement>(null);
  const miniMapDragCleanupRef = useRef<() => void>(() => {});
  const isCommentMode = useCommentsStore((s) => s.isCommentMode);
  const setCommentMode = useCommentsStore((s) => s.setCommentMode);
  const isReviewDrawerOpen = useCommentsStore((s) => s.isReviewDrawerOpen);
  const setReviewDrawerOpen = useCommentsStore((s) => s.setReviewDrawerOpen);
  const commentsCount = useCommentsStore((s) => s.comments.length);
  const isReadOnly = usePresentationStore((s) => s.isReadOnly);

  useEffect(() => () => miniMapDragCleanupRef.current(), []);
  useEffect(() => {
    if (!showMiniMap) miniMapDragCleanupRef.current();
  }, [showMiniMap]);

  const handleMiniMapPointerDownCapture = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const container = miniMapContainerRef.current;
      if (!container) return;
      const metrics = readMiniMapSvgMetrics(container);
      if (!metrics) return;

      e.preventDefault();
      e.stopPropagation();

      const { rect, viewBox } = metrics;
      const storeState = useFlowStore.getState();
      if (storeState.followingUserId) {
        storeState.setFollowingUser(null);
      }
      const extent = computeCanvasTranslateExtent(storeState.nodes);

      const panToClient = (clientX: number, clientY: number) => {
        const target = resolveMiniMapFlowPosition(clientX, clientY, rect, viewBox, extent);
        setCenter(target.x, target.y, { zoom: getZoom(), duration: 0 });
      };

      panToClient(e.clientX, e.clientY);

      const onMove = (moveEvent: PointerEvent) => {
        panToClient(moveEvent.clientX, moveEvent.clientY);
      };

      const detach = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', detach);
        window.removeEventListener('pointercancel', detach);
        miniMapDragCleanupRef.current = () => {};
      };

      miniMapDragCleanupRef.current();
      miniMapDragCleanupRef.current = detach;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', detach);
      window.addEventListener('pointercancel', detach);
    },
    [setCenter, getZoom]
  );

  const resolveMiniMapNodeColor = useCallback((node: { type?: string; data?: unknown }) => {
    const data = (node.data ?? {}) as Partial<FlowNodeData>;
    switch (node.type) {
      case 'pool':
      case 'lane':
      case 'group':
        return 'rgba(148, 163, 184, 0.16)';
      case 'start-end':
        return data.role === 'end' ? '#f43f5e' : '#10b981';
      case 'decision':
        return '#f59e0b';
      case 'comment':
        return '#eab308';
      default:
        return '#3b82f6';
    }
  }, []);

  const resolveMiniMapNodeStrokeColor = useCallback((node: { type?: string }) => {
    if (node.type === 'pool' || node.type === 'lane' || node.type === 'group') {
      return 'rgba(148, 163, 184, 0.4)';
    }
    return 'transparent';
  }, []);

  return (
    <>
      {showMiniMap && (
        <Panel
          position="top-right"
          className={
            isReviewDrawerOpen
              ? '!mt-14 !mr-[340px] transition-all duration-200'
              : '!mt-3 !mr-3 transition-all duration-200'
          }
        >
          <div
            ref={miniMapContainerRef}
            onPointerDownCapture={handleMiniMapPointerDownCapture}
            onMouseDownCapture={(e) => e.stopPropagation()}
            title="点击或拖动缩略图快速定位画布视角"
            className="group relative nodrag nopan touch-none rounded-2xl backdrop-blur-md bg-[var(--fs-surface)]/85 shadow-[0_8px_30px_rgb(0,0,0,0.08)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.35)] ring-1 ring-black/[0.06] dark:ring-white/[0.08] overflow-hidden cursor-pointer select-none"
          >
            <div className="pointer-events-none absolute top-1.5 left-2 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[var(--fs-surface)]/75 backdrop-blur-xs text-[10px] font-medium text-[var(--fs-text-muted)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--fs-primary)]" />
              <span>导航</span>
            </div>
            <button
              type="button"
              aria-label="收起小地图"
              title="收起小地图"
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setShowMiniMap(false);
              }}
              className="absolute top-1.5 right-1.5 z-10 w-5 h-5 rounded-full flex items-center justify-center bg-[var(--fs-surface)]/80 text-[var(--fs-text-muted)] hover:text-[var(--fs-text)] hover:bg-[var(--fs-bg)] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
            <MiniMap
              className="!relative !m-0 !w-[184px] !h-[124px] !bg-transparent !border-0 !shadow-none"
              nodeColor={resolveMiniMapNodeColor}
              nodeStrokeColor={resolveMiniMapNodeStrokeColor}
              nodeStrokeWidth={1}
              nodeBorderRadius={6}
              nodeComponent={MiniMapFocusNode}
              maskColor="var(--fs-minimap-mask)"
              maskStrokeColor="transparent"
              maskStrokeWidth={0}
              style={{
                width: 184,
                height: 124,
                backgroundColor: 'transparent',
              }}
              zoomable
              pannable={false}
            />
          </div>
        </Panel>
      )}

      {/* 底部快捷缩放控制栏 */}
      <Panel position="bottom-left" className="!mb-3 !ml-3">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--fs-surface)] border border-[var(--fs-border)] shadow-md select-none text-[var(--fs-text)]">
          <button
            type="button"
            title="放大视口"
            onClick={() => zoomIn({ duration: 200 })}
            className="p-1.5 rounded-lg hover:bg-[var(--fs-bg)] text-[var(--fs-text-muted)] hover:text-[var(--fs-text)] transition-colors"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="缩小视口"
            onClick={() => zoomOut({ duration: 200 })}
            className="p-1.5 rounded-lg hover:bg-[var(--fs-bg)] text-[var(--fs-text-muted)] hover:text-[var(--fs-text)] transition-colors"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <div className="w-px h-4 bg-[var(--fs-border)] mx-0.5" />
          <button
            type="button"
            title="自适应画布全部内容"
            onClick={() => fitView({ padding: 0.2, duration: 250 })}
            className="p-1.5 rounded-lg hover:bg-[var(--fs-bg)] text-[var(--fs-text-muted)] hover:text-[var(--fs-text)] transition-colors"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <div className="w-px h-4 bg-[var(--fs-border)] mx-0.5" />
          <button
            type="button"
            title={showMiniMap ? '收起小地图' : '展开小地图'}
            onClick={() => setShowMiniMap((v) => !v)}
            className={`p-1.5 rounded-lg transition-colors ${
              showMiniMap
                ? 'bg-[var(--fs-primary)] text-white'
                : 'hover:bg-[var(--fs-bg)] text-[var(--fs-text-muted)] hover:text-[var(--fs-text)]'
            }`}
          >
            <MapIcon className="w-4 h-4" />
          </button>
          {!isReadOnly && (
            <>
              <div className="w-px h-4 bg-[var(--fs-border)] mx-0.5" />
              <button
                type="button"
                title={isCommentMode ? '退出批注打点模式 (按 Esc 或 C)' : '进入画布批注打点模式 (按 C)'}
                onClick={() => setCommentMode(!isCommentMode)}
                className={`relative p-1.5 rounded-lg transition-colors cursor-pointer ${
                  isCommentMode
                    ? 'bg-[var(--fs-primary)] text-white ring-2 ring-[var(--fs-primary)]/40 shadow-sm'
                    : 'hover:bg-[var(--fs-bg)] text-[var(--fs-text-muted)] hover:text-[var(--fs-text)]'
                }`}
              >
                <MessageSquare className="w-4 h-4" />
                {commentsCount > 0 && (
                  <span className="absolute -top-1 -right-1 px-1 py-0.2 bg-indigo-600 text-white rounded-full text-[8px] font-bold">
                    {commentsCount}
                  </span>
                )}
              </button>
            </>
          )}
          <button
            type="button"
            title={isReviewDrawerOpen ? '收起评审抽屉' : '展开批注评审抽屉'}
            onClick={() => setReviewDrawerOpen(!isReviewDrawerOpen)}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              isReviewDrawerOpen
                ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-white'
                : 'hover:bg-[var(--fs-bg)] text-[var(--fs-text-muted)] hover:text-[var(--fs-text)]'
            }`}
          >
            <MessagesSquare className="w-4 h-4" />
          </button>
        </div>
      </Panel>
    </>
  );
};

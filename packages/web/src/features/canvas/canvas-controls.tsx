/**
 * @fileoverview 画布辅助控制组件 (CanvasControls)
 * @description 位于画布左下角与右上角，提供缩放、自适应视口以及小地图 MiniMap 导航定位控制
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Panel, useReactFlow, MiniMap } from '@xyflow/react';
import { ZoomIn, ZoomOut, Maximize2, Map as MapIcon, MessageSquare, MessagesSquare } from 'lucide-react';
import { useCommentsStore } from '../comments';
import { usePresentationStore } from '../presentation';
import { useFlowStore } from '../../stores/flow-store';
import {
  computeCanvasTranslateExtent,
  resolveMiniMapFlowPosition,
  type MiniMapRectLike,
  type MiniMapViewBoxLike,
} from './utils/canvas-bounds';

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
            className="nodrag nopan touch-none p-1 rounded-xl bg-[var(--fs-surface)] border border-[var(--fs-border)] shadow-lg overflow-hidden cursor-pointer"
          >
            <MiniMap
              className="!relative !m-0 !w-44 !h-32 rounded-lg"
              nodeColor="var(--fs-node-border)"
              maskColor="var(--fs-canvas-dot)"
              style={{
                width: 176,
                height: 128,
                backgroundColor: 'var(--fs-canvas-bg)',
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

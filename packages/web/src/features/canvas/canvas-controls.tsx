/**
 * @fileoverview 画布辅助控制组件 (CanvasControls)
 * @description 位于画布左下角，提供缩放、自适应视口以及小地图 MiniMap 显隐控制
 */

import React, { useState } from 'react';
import { Panel, useReactFlow, MiniMap } from '@xyflow/react';
import { ZoomIn, ZoomOut, Maximize2, Map as MapIcon, MessageSquare, MessagesSquare } from 'lucide-react';
import { useCommentsStore } from '../comments';
import { usePresentationStore } from '../presentation';

export const CanvasControls: React.FC = () => {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const [showMiniMap, setShowMiniMap] = useState(false);
  const isCommentMode = useCommentsStore((s) => s.isCommentMode);
  const setCommentMode = useCommentsStore((s) => s.setCommentMode);
  const isReviewDrawerOpen = useCommentsStore((s) => s.isReviewDrawerOpen);
  const setReviewDrawerOpen = useCommentsStore((s) => s.setReviewDrawerOpen);
  const commentsCount = useCommentsStore((s) => s.comments.length);
  const isReadOnly = usePresentationStore((s) => s.isReadOnly);

  return (
    <>
      {/* 小地图浮层（悬浮在左下方控制条上方） */}
      {showMiniMap && (
        <Panel position="bottom-left" className="!mb-14 !ml-3">
          <div className="p-1 rounded-xl bg-[var(--fs-surface)] border border-[var(--fs-border)] shadow-lg overflow-hidden">
            <MiniMap
              className="!relative !m-0 !w-44 !h-32 rounded-lg"
              nodeColor="var(--fs-node-border)"
              maskColor="var(--fs-canvas-dot)"
              style={{
                backgroundColor: 'var(--fs-canvas-bg)',
              }}
              zoomable
              pannable
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

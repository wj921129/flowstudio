import React, { useEffect, useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { MessageSquare, Check, ChevronLeft, ChevronRight, X, AlertTriangle, Eye, CheckCircle2 } from 'lucide-react';
import { useCommentsStore } from './comments-store';
import { RightPanelTabs } from '../sidebar/right-panel-tabs';

export const ReviewDrawer: React.FC = () => {
  const {
    comments,
    activeCommentId,
    filterMode,
    isReviewDrawerOpen,
    setReviewDrawerOpen,
    setFilterMode,
    setActiveCommentId,
    getNextCommentId,
  } = useCommentsStore();

  const { setViewport, getViewport } = useReactFlow();

  const focusComment = useCallback((id: string) => {
    setActiveCommentId(id);
    const target = useCommentsStore.getState().comments.find((c) => c.id === id);
    if (!target) return;

    const vp = getViewport();
    setViewport(
      {
        x: -target.position.x * vp.zoom + window.innerWidth / 2 - 160,
        y: -target.position.y * vp.zoom + window.innerHeight / 2,
        zoom: Math.max(0.9, vp.zoom),
      },
      { duration: 250 }
    );
  }, [setActiveCommentId, getViewport, setViewport]);

  const handleNext = useCallback(() => {
    const nextId = getNextCommentId('next');
    if (nextId) focusComment(nextId);
  }, [getNextCommentId, focusComment]);

  const handlePrev = useCallback(() => {
    const prevId = getNextCommentId('prev');
    if (prevId) focusComment(prevId);
  }, [getNextCommentId, focusComment]);

  useEffect(() => {
    if (!isReviewDrawerOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        handlePrev();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isReviewDrawerOpen, handleNext, handlePrev]);

  if (!isReviewDrawerOpen) return null;

  const filteredComments = filterMode === 'unresolved_only'
    ? comments.filter((c) => !c.resolved)
    : comments;

  const currentIdx = filteredComments.findIndex((c) => c.id === activeCommentId);

  return (
    <aside
      onClick={(e) => e.stopPropagation()}
      className="absolute top-0 right-0 bottom-0 w-80 bg-fs-surface border-l border-fs-border shadow-xl flex flex-col z-40 select-none overflow-hidden"
    >
      <div className="flex items-center justify-between p-3.5 border-b border-fs-border">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-[var(--fs-selection-ring,#6366f1)]" />
          <h3 className="font-semibold text-sm text-fs-text">画布批注与评审</h3>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-fs-bg text-fs-text-muted">
            {comments.length}
          </span>
        </div>
        <button
          onClick={() => setReviewDrawerOpen(false)}
          className="p-1 rounded-md text-fs-text-muted hover:text-fs-text hover:bg-fs-bg cursor-pointer transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <RightPanelTabs activeTab="review" />

      <div className="flex items-center justify-between px-3.5 py-2 bg-fs-bg/60 border-b border-fs-border text-xs">
        <div className="flex items-center gap-1 bg-fs-bg p-0.5 rounded-lg border border-fs-border">
          <button
            onClick={() => setFilterMode('all')}
            className={`px-2 py-0.5 rounded-md font-medium text-[11px] transition-colors cursor-pointer ${
              filterMode === 'all'
                ? 'bg-fs-surface text-fs-text shadow-xs'
                : 'text-fs-text-muted hover:text-fs-text'
            }`}
          >
            全部
          </button>
          <button
            onClick={() => setFilterMode('unresolved_only')}
            className={`px-2 py-0.5 rounded-md font-medium text-[11px] transition-colors cursor-pointer ${
              filterMode === 'unresolved_only'
                ? 'bg-fs-surface text-fs-text shadow-xs'
                : 'text-fs-text-muted hover:text-fs-text'
            }`}
          >
            未解决
          </button>
        </div>

        {filteredComments.length > 0 && (
          <div className="flex items-center gap-1 text-[11px] text-fs-text-muted">
            <span>{currentIdx >= 0 ? currentIdx + 1 : 1}/{filteredComments.length}</span>
            <div className="flex items-center gap-0.5 ml-1">
              <button
                onClick={handlePrev}
                title="聚焦上一条批注 (←)"
                className="p-1 rounded hover:bg-fs-bg text-fs-text cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleNext}
                title="聚焦下一条批注 (→)"
                className="p-1 rounded hover:bg-fs-bg text-fs-text cursor-pointer"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
        {filteredComments.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-fs-text-muted gap-2">
            <CheckCircle2 className="w-8 h-8 opacity-40 text-emerald-500" />
            <p className="text-xs">暂无待解决批注</p>
            <p className="text-[11px] text-fs-text-muted">在画布中点击或按 M 键可添加新讨论图钉</p>
          </div>
        ) : (
          filteredComments.map((comment, idx) => {
            const isSelected = activeCommentId === comment.id;
            return (
              <div
                key={comment.id}
                onClick={() => focusComment(comment.id)}
                className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all flex flex-col gap-1.5 ${
                  isSelected
                    ? 'border-[var(--fs-selection-ring,#6366f1)] bg-fs-primary/10 shadow-sm'
                    : 'border-fs-border hover:border-fs-text-muted/50 bg-fs-surface'
                }`}
              >
                <div className="flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-1.5 truncate">
                    <span
                      className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0"
                      style={{ backgroundColor: comment.authorColor }}
                    >
                      {comment.authorName.slice(0, 1)}
                    </span>
                    <span className="font-semibold text-fs-text truncate">
                      {comment.authorName}
                    </span>
                    <span className="text-fs-text-muted text-[10px]">#{idx + 1}</span>
                  </div>

                  {comment.resolved && (
                    <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 bg-emerald-500/10 px-1.5 py-0.2 rounded font-medium">
                      <Check className="w-3 h-3" /> 已解决
                    </span>
                  )}
                </div>

                {comment.targetDetached ? (
                  <div className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                    <span>关联图元已移除</span>
                  </div>
                ) : comment.targetLabel ? (
                  <div className="text-[10px] text-fs-text-muted truncate">
                    吸附: {comment.targetLabel}
                  </div>
                ) : null}

                <p className="text-fs-text line-clamp-2 leading-relaxed">
                  {comment.content}
                </p>

                <div className="flex items-center justify-between text-[10px] text-fs-text-muted pt-1 border-t border-fs-border">
                  <span>{new Date(comment.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                  {comment.replies.length > 0 && (
                    <span className="font-medium text-fs-text-muted">
                      {comment.replies.length} 条回复
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};

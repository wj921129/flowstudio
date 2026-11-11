import React from 'react';
import { useReactFlow } from '@xyflow/react';
import { MessageSquare, Check, ChevronLeft, ChevronRight, X, AlertTriangle, Eye, CheckCircle2 } from 'lucide-react';
import { useCommentsStore } from './comments-store';

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

  if (!isReviewDrawerOpen) return null;

  const filteredComments = filterMode === 'unresolved_only'
    ? comments.filter((c) => !c.resolved)
    : comments;

  const currentIdx = filteredComments.findIndex((c) => c.id === activeCommentId);

  const focusComment = (id: string) => {
    setActiveCommentId(id);
    const target = comments.find((c) => c.id === id);
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
  };

  const handleNext = () => {
    const nextId = getNextCommentId('next');
    if (nextId) focusComment(nextId);
  };

  const handlePrev = () => {
    const prevId = getNextCommentId('prev');
    if (prevId) focusComment(prevId);
  };

  return (
    <aside
      onClick={(e) => e.stopPropagation()}
      className="absolute top-14 right-4 bottom-4 w-80 bg-[var(--fs-surface,#ffffff)] dark:bg-zinc-900 border border-[var(--fs-border,#e5e7eb)] rounded-2xl shadow-2xl flex flex-col z-40 select-none overflow-hidden"
    >
      <div className="flex items-center justify-between p-3.5 border-b border-[var(--fs-border,#e5e7eb)]">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-[var(--fs-selection-ring,#6366f1)]" />
          <h3 className="font-semibold text-sm text-[var(--fs-text,#18181b)]">画布批注与评审</h3>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
            {comments.length}
          </span>
        </div>
        <button
          onClick={() => setReviewDrawerOpen(false)}
          className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center justify-between px-3.5 py-2 bg-zinc-50 dark:bg-zinc-800/40 border-b border-[var(--fs-border,#e5e7eb)] text-xs">
        <div className="flex items-center gap-1 bg-zinc-200/60 dark:bg-zinc-800 p-0.5 rounded-lg">
          <button
            onClick={() => setFilterMode('all')}
            className={`px-2 py-0.5 rounded-md font-medium text-[11px] transition-colors cursor-pointer ${
              filterMode === 'all'
                ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-xs'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            全部
          </button>
          <button
            onClick={() => setFilterMode('unresolved_only')}
            className={`px-2 py-0.5 rounded-md font-medium text-[11px] transition-colors cursor-pointer ${
              filterMode === 'unresolved_only'
                ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-xs'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            未解决
          </button>
        </div>

        {filteredComments.length > 0 && (
          <div className="flex items-center gap-1 text-[11px] text-zinc-500">
            <span>{currentIdx >= 0 ? currentIdx + 1 : 1}/{filteredComments.length}</span>
            <div className="flex items-center gap-0.5 ml-1">
              <button
                onClick={handlePrev}
                title="聚焦上一条批注 (←)"
                className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleNext}
                title="聚焦下一条批注 (→)"
                className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 cursor-pointer"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
        {filteredComments.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-400 gap-2">
            <CheckCircle2 className="w-8 h-8 opacity-40 text-emerald-500" />
            <p className="text-xs">暂无待解决批注</p>
            <p className="text-[11px] text-zinc-400">在画布中点击或按 C 键可添加新讨论图钉</p>
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
                    ? 'border-[var(--fs-selection-ring,#6366f1)] bg-indigo-50/50 dark:bg-indigo-950/20 shadow-sm'
                    : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-white dark:bg-zinc-900/60'
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
                    <span className="font-semibold text-zinc-800 dark:text-zinc-200 truncate">
                      {comment.authorName}
                    </span>
                    <span className="text-zinc-400 text-[10px]">#{idx + 1}</span>
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
                  <div className="text-[10px] text-zinc-400 truncate">
                    吸附: {comment.targetLabel}
                  </div>
                ) : null}

                <p className="text-zinc-700 dark:text-zinc-300 line-clamp-2 leading-relaxed">
                  {comment.content}
                </p>

                <div className="flex items-center justify-between text-[10px] text-zinc-400 pt-1 border-t border-zinc-100 dark:border-zinc-800/80">
                  <span>{new Date(comment.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                  {comment.replies.length > 0 && (
                    <span className="font-medium text-zinc-500">
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

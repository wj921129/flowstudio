import React from 'react';
import { MessageSquare, Check, AlertTriangle } from 'lucide-react';
import type { CanvasComment } from './types';
import { CommentCard } from './comment-card';
import { useCommentsStore } from './comments-store';

export const CommentPin: React.FC<{
  comment: CanvasComment;
  index: number;
}> = ({ comment, index }) => {
  const { activeCommentId, setActiveCommentId, filterMode } = useCommentsStore();
  const isActive = activeCommentId === comment.id;

  if (filterMode === 'unresolved_only' && comment.resolved && !isActive) {
    return null;
  }

  return (
    <div
      style={{
        position: 'absolute',
        transform: `translate(${comment.position.x}px, ${comment.position.y}px)`,
        pointerEvents: 'all',
      }}
      className="z-40"
    >
      <div className="relative">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setActiveCommentId(isActive ? null : comment.id);
          }}
          title={`${comment.authorName}: ${comment.content}`}
          className={`group flex items-center justify-center -translate-x-1/2 -translate-y-full transition-transform cursor-pointer select-none ${
            isActive ? 'scale-125 z-50' : 'hover:scale-110'
          }`}
        >
          <div
            className={`relative flex items-center justify-center rounded-2xl p-1.5 shadow-xl border-2 transition-all ${
              comment.resolved
                ? 'bg-zinc-200 dark:bg-zinc-800 border-zinc-400 opacity-60'
                : comment.targetDetached
                ? 'border-amber-400 ring-2 ring-amber-400/40 shadow-amber-500/20'
                : 'border-white dark:border-zinc-900 shadow-indigo-500/30'
            }`}
            style={{ backgroundColor: comment.resolved ? undefined : comment.authorColor }}
          >
            {comment.resolved ? (
              <Check className="w-4 h-4 text-zinc-600 dark:text-zinc-300" />
            ) : comment.targetDetached ? (
              <AlertTriangle className="w-4 h-4 text-white" />
            ) : (
              <MessageSquare className="w-4 h-4 text-white fill-white/20" />
            )}

            <span className="absolute -top-1.5 -right-1.5 px-1 py-0.2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-full text-[9px] font-bold text-zinc-700 dark:text-zinc-300 shadow-xs">
              {index + 1}
            </span>
          </div>

          <div
            className={`w-0 h-0 border-x-4 border-x-transparent border-t-6 transition-colors -mt-0.5 ${
              comment.resolved
                ? 'border-t-zinc-400'
                : comment.targetDetached
                ? 'border-t-amber-400'
                : ''
            }`}
            style={{ borderTopColor: comment.resolved || comment.targetDetached ? undefined : comment.authorColor }}
          />
        </button>

        {isActive && (
          <div className="absolute left-4 top-2 z-50">
            <CommentCard comment={comment} onClose={() => setActiveCommentId(null)} />
          </div>
        )}
      </div>
    </div>
  );
};

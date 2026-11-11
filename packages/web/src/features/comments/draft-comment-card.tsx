import React, { useState, useRef, useEffect } from 'react';
import { Send, X, MessageSquare, AlertTriangle } from 'lucide-react';
import { useCommentsStore } from './comments-store';
import { useCollaboration } from '../collaboration/collaboration-provider';

export const DraftCommentCard: React.FC = () => {
  const collab = useCollaboration();
  const currentUser = collab?.currentUser || { clientId: 'local', nickname: '我', color: '#6366f1' };
  const { newCommentDraftPosition, newCommentDraftTarget, setNewCommentDraft, addComment } = useCommentsStore();

  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (newCommentDraftPosition) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [newCommentDraftPosition]);

  if (!newCommentDraftPosition) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;

    addComment({
      id: `comm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      authorId: currentUser.clientId,
      authorName: currentUser.nickname,
      authorColor: currentUser.color,
      content: text.trim(),
      createdAt: Date.now(),
      resolved: false,
      targetType: newCommentDraftTarget?.type || 'canvas',
      targetId: newCommentDraftTarget?.id,
      targetLabel: newCommentDraftTarget?.label,
      position: newCommentDraftPosition,
      replies: [],
      reactions: [],
    });
  };

  return (
    <div
      style={{
        position: 'absolute',
        transform: `translate(${newCommentDraftPosition.x}px, ${newCommentDraftPosition.y}px)`,
        pointerEvents: 'all',
      }}
      className="z-50"
    >
      <div className="relative">
        <div className="flex items-center justify-center -translate-x-1/2 -translate-y-full mb-1">
          <div
            className="flex items-center justify-center rounded-2xl p-1.5 shadow-xl border-2 border-white dark:border-zinc-900"
            style={{ backgroundColor: currentUser.color }}
          >
            <MessageSquare className="w-4 h-4 text-white fill-white/20" />
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          onClick={(e) => e.stopPropagation()}
          className="nodrag nopan w-72 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-2xl p-3 flex flex-col gap-2 z-50 select-text"
        >
          <div className="flex items-center justify-between text-xs border-b border-zinc-100 dark:border-zinc-800 pb-1.5">
            <div className="flex items-center gap-1.5 truncate">
              <span
                className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[9px] font-bold"
                style={{ backgroundColor: currentUser.color }}
              >
                {currentUser.nickname.slice(0, 1)}
              </span>
              <span className="font-semibold text-zinc-800 dark:text-zinc-200 truncate">{currentUser.nickname}</span>
              {newCommentDraftTarget?.label && (
                <span className="text-[10px] text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded truncate">
                  吸附: {newCommentDraftTarget.label}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setNewCommentDraft(null)}
              className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <textarea
            ref={inputRef}
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                handleSubmit(e);
              }
            }}
            placeholder="输入讨论批注... (Ctrl+Enter 提交)"
            className="w-full bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 text-xs outline-none focus:border-[var(--fs-selection-ring,#6366f1)] resize-none"
          />

          <div className="flex items-center justify-end gap-1.5 pt-1">
            <button
              type="button"
              onClick={() => setNewCommentDraft(null)}
              className="px-2.5 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md cursor-pointer transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!text.trim()}
              className="flex items-center gap-1 px-3 py-1 bg-[var(--fs-selection-ring,#6366f1)] text-white text-xs font-medium rounded-md hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-opacity"
            >
              <Send className="w-3 h-3" />
              <span>发表</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

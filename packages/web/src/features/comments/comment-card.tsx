import React, { useState } from 'react';
import { Check, MessageSquare, Trash2, Smile, AlertTriangle, Send, X, CornerDownRight } from 'lucide-react';
import type { CanvasComment } from './types';
import { useCommentsStore } from './comments-store';
import { useCollaboration } from '../collaboration/collaboration-provider';

const EMOJI_LIST = ['👍', '❤️', '🎉', '👀', '🚀'];

export const CommentCard: React.FC<{
  comment: CanvasComment;
  onClose: () => void;
}> = ({ comment, onClose }) => {
  const collab = useCollaboration();
  const currentUser = collab?.currentUser || { clientId: 'local', nickname: '我', color: '#6366f1' };
  const { addReply, toggleResolve, addReaction, deleteComment } = useCommentsStore();

  const [replyText, setReplyText] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const handleSendReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim()) return;

    addReply(comment.id, {
      id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      authorId: currentUser.clientId,
      authorName: currentUser.nickname,
      authorColor: currentUser.color,
      content: replyText.trim(),
      createdAt: Date.now(),
      reactions: [],
    });
    setReplyText('');
  };

  const formatTime = (ts: number) => {
    const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
    return new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="nodrag nopan w-80 bg-[var(--fs-surface,#ffffff)] dark:bg-zinc-900 border border-[var(--fs-border,#e5e7eb)] rounded-xl shadow-2xl p-3 flex flex-col gap-2.5 text-xs text-[var(--fs-text,#18181b)] z-50 select-text"
      style={{ minWidth: 280 }}
    >
      <div className="flex items-center justify-between border-b border-[var(--fs-border,#e5e7eb)] pb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold shadow-xs flex-shrink-0"
            style={{ backgroundColor: comment.authorColor }}
          >
            {comment.authorName.slice(0, 1)}
          </span>
          <span className="font-semibold truncate max-w-[100px]">{comment.authorName}</span>
          <span className="text-[10px] text-zinc-400 flex-shrink-0">{formatTime(comment.createdAt)}</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => toggleResolve(comment.id, currentUser.nickname)}
            title={comment.resolved ? '重新开启此讨论' : '标记为已解决'}
            className={`p-1 rounded-md transition-colors cursor-pointer flex items-center gap-1 text-[10px] font-medium ${
              comment.resolved
                ? 'bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25'
                : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            <Check className="w-3.5 h-3.5" />
            <span>{comment.resolved ? '已解决' : '解决'}</span>
          </button>
          <button
            onClick={() => deleteComment(comment.id)}
            title="删除此批注"
            className="p-1 rounded-md text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {comment.targetDetached ? (
        <div className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-1 rounded border border-amber-500/20">
          <AlertTriangle className="w-3 h-3 flex-shrink-0" />
          <span>关联图元已移除（原地保留评审记录）</span>
        </div>
      ) : comment.targetLabel ? (
        <div className="flex items-center gap-1 text-[10px] text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded truncate">
          <span className="text-zinc-400">吸附于:</span>
          <span className="font-medium text-zinc-700 dark:text-zinc-300 truncate">{comment.targetLabel}</span>
        </div>
      ) : null}

      <div className="text-zinc-800 dark:text-zinc-200 leading-relaxed break-words whitespace-pre-wrap">
        {comment.content}
      </div>

      <div className="flex flex-wrap items-center gap-1 pt-0.5">
        {comment.reactions.map((r, idx) => (
          <button
            key={idx}
            onClick={() => addReaction(comment.id, { emoji: r.emoji, userId: currentUser.clientId, nickname: currentUser.nickname })}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[11px] hover:bg-zinc-200 cursor-pointer transition-colors"
          >
            <span>{r.emoji}</span>
            <span className="text-[10px] text-zinc-500">{r.nickname}</span>
          </button>
        ))}

        <div className="relative">
          <button
            onClick={() => setShowEmojiPicker((v) => !v)}
            className="p-1 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            title="添加表情反应"
          >
            <Smile className="w-3.5 h-3.5" />
          </button>

          {showEmojiPicker && (
            <div className="absolute left-0 bottom-full mb-1 flex items-center gap-1 p-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg z-50">
              {EMOJI_LIST.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => {
                    addReaction(comment.id, { emoji, userId: currentUser.clientId, nickname: currentUser.nickname });
                    setShowEmojiPicker(false);
                  }}
                  className="hover:scale-125 transition-transform p-1 text-sm cursor-pointer"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {comment.replies.length > 0 && (
        <div className="flex flex-col gap-2 pt-2 border-t border-[var(--fs-border,#e5e7eb)] max-h-48 overflow-y-auto">
          {comment.replies.map((reply) => (
            <div key={reply.id} className="flex flex-col gap-1 bg-zinc-50 dark:bg-zinc-800/50 p-2 rounded-lg">
              <div className="flex items-center justify-between text-[10px]">
                <div className="flex items-center gap-1">
                  <span
                    className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[9px] font-bold"
                    style={{ backgroundColor: reply.authorColor }}
                  >
                    {reply.authorName.slice(0, 1)}
                  </span>
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300">{reply.authorName}</span>
                </div>
                <span className="text-zinc-400">{formatTime(reply.createdAt)}</span>
              </div>
              <div className="text-zinc-800 dark:text-zinc-200 leading-normal pl-5 break-words">
                {reply.content}
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSendReply} className="flex items-center gap-1 pt-1 border-t border-[var(--fs-border,#e5e7eb)]">
        <input
          type="text"
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          placeholder="回复此讨论，支持 @成员..."
          className="flex-1 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-md px-2 py-1 text-xs outline-none focus:border-[var(--fs-selection-ring,#6366f1)]"
        />
        <button
          type="submit"
          disabled={!replyText.trim()}
          className="p-1.5 rounded-md bg-[var(--fs-selection-ring,#6366f1)] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 cursor-pointer transition-opacity"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
};

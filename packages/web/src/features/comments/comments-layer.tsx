import React, { useEffect, useCallback } from 'react';
import { useReactFlow, ViewportPortal } from '@xyflow/react';
import { MessageSquare, Bell, ArrowRight, X } from 'lucide-react';
import { useCommentsStore } from './comments-store';
import { CommentPin } from './comment-pin';
import { DraftCommentCard } from './draft-comment-card';
import { useFlowStore } from '../../stores/flow-store';

export const CommentsLayer: React.FC = () => {
  const {
    comments,
    isCommentMode,
    setCommentMode,
    setNewCommentDraft,
    unreadNotification,
    setUnreadNotification,
    setActiveCommentId,
    updateDetachedStatus,
  } = useCommentsStore();

  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);

  const { screenToFlowPosition, setViewport, getViewport } = useReactFlow();

  useEffect(() => {
    updateDetachedStatus(nodes, edges);
  }, [nodes, edges, updateDetachedStatus]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if ((e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setCommentMode(!isCommentMode);
      } else if (e.key === 'Escape') {
        setCommentMode(false);
        setNewCommentDraft(null);
        setActiveCommentId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCommentMode, setCommentMode, setNewCommentDraft, setActiveCommentId]);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isCommentMode) return;
      e.preventDefault();
      e.stopPropagation();

      const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });

      let hitNode = nodes.find(
        (n) =>
          flowPos.x >= n.position.x &&
          flowPos.x <= n.position.x + (n.width || 120) &&
          flowPos.y >= n.position.y &&
          flowPos.y <= n.position.y + (n.height || 60)
      );

      let targetInfo = hitNode
        ? {
            type: 'node' as const,
            id: hitNode.id,
            label: String((hitNode.data as any)?.label || hitNode.id),
          }
        : {
            type: 'canvas' as const,
          };

      setNewCommentDraft(flowPos, targetInfo);
    },
    [isCommentMode, screenToFlowPosition, nodes, setNewCommentDraft]
  );

  const handleNotificationClick = () => {
    if (!unreadNotification) return;
    const { commentId, position } = unreadNotification;
    setActiveCommentId(commentId);
    setUnreadNotification(null);

    const vp = getViewport();
    setViewport(
      {
        x: -position.x * vp.zoom + window.innerWidth / 2 - 160,
        y: -position.y * vp.zoom + window.innerHeight / 2,
        zoom: Math.max(0.9, vp.zoom),
      },
      { duration: 250 }
    );
  };

  return (
    <>
      {isCommentMode && (
        <div
          onClick={handleCanvasClick}
          className="absolute inset-0 z-30 cursor-crosshair bg-indigo-500/5 select-none"
        />
      )}

      <ViewportPortal>
        {comments.map((comment, idx) => (
          <CommentPin key={comment.id} comment={comment} index={idx} />
        ))}
        <DraftCommentCard />
      </ViewportPortal>

      {unreadNotification && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-4 py-2 bg-zinc-900/95 dark:bg-white/95 text-white dark:text-zinc-900 rounded-full shadow-2xl border border-zinc-700 dark:border-zinc-200 animate-bounce">
          <Bell className="w-4 h-4 text-amber-400 dark:text-amber-500" />
          <span className="text-xs font-semibold">{unreadNotification.authorName}:</span>
          <span className="text-xs truncate max-w-xs opacity-90">{unreadNotification.text}</span>
          <button
            onClick={handleNotificationClick}
            className="flex items-center gap-1 text-xs font-bold text-indigo-400 dark:text-indigo-600 hover:underline ml-1 cursor-pointer"
          >
            <span>聚焦查看</span>
            <ArrowRight className="w-3 h-3" />
          </button>
          <button
            onClick={() => setUnreadNotification(null)}
            className="opacity-60 hover:opacity-100 ml-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </>
  );
};

import { create } from 'zustand';
import type { FlowNode, FlowEdge, XYPosition } from '@flowstudio/shared';
import type { CanvasComment, CommentReply, CommentReaction, ReviewFilterMode, CommentTargetType } from './types';

interface CommentsStoreState {
  comments: CanvasComment[];
  activeCommentId: string | null;
  isCommentMode: boolean;
  filterMode: ReviewFilterMode;
  isReviewDrawerOpen: boolean;
  newCommentDraftPosition: XYPosition | null;
  newCommentDraftTarget: { type: CommentTargetType; id?: string; label?: string } | null;
  unreadNotification: { commentId: string; authorName: string; text: string; position: XYPosition } | null;
  yjsSyncCallback: ((op: string, payload: any) => void) | null;

  setYjsSyncCallback: (cb: ((op: string, payload: any) => void) | null) => void;
  syncFromYjs: (comments: CanvasComment[]) => void;

  setCommentMode: (active: boolean) => void;
  setActiveCommentId: (id: string | null) => void;
  setFilterMode: (mode: ReviewFilterMode) => void;
  setReviewDrawerOpen: (open: boolean) => void;
  setNewCommentDraft: (
    pos: XYPosition | null,
    target?: { type: CommentTargetType; id?: string; label?: string } | null
  ) => void;
  setUnreadNotification: (
    notification: { commentId: string; authorName: string; text: string; position: XYPosition } | null
  ) => void;

  addComment: (comment: CanvasComment) => void;
  addReply: (commentId: string, reply: CommentReply) => void;
  toggleResolve: (commentId: string, resolvedBy: string) => void;
  addReaction: (commentId: string, reaction: CommentReaction, replyId?: string) => void;
  deleteComment: (commentId: string) => void;

  updateDetachedStatus: (nodes: FlowNode[], edges: FlowEdge[]) => void;
  getNextCommentId: (direction: 'next' | 'prev') => string | null;
  reset: () => void;
}

export const useCommentsStore = create<CommentsStoreState>((set, get) => ({
  comments: [],
  activeCommentId: null,
  isCommentMode: false,
  filterMode: 'all',
  isReviewDrawerOpen: false,
  newCommentDraftPosition: null,
  newCommentDraftTarget: null,
  unreadNotification: null,
  yjsSyncCallback: null,

  setYjsSyncCallback: (cb) => set({ yjsSyncCallback: cb }),

  syncFromYjs: (comments) => {
    set({ comments });
  },

  setCommentMode: (active) => set({ isCommentMode: active, newCommentDraftPosition: null, newCommentDraftTarget: null }),

  setActiveCommentId: (id) => set({ activeCommentId: id }),

  setFilterMode: (mode) => set({ filterMode: mode }),

  setReviewDrawerOpen: (open) => set({ isReviewDrawerOpen: open }),

  setNewCommentDraft: (pos, target = null) =>
    set({ newCommentDraftPosition: pos, newCommentDraftTarget: target, isCommentMode: Boolean(pos) }),

  setUnreadNotification: (notification) => set({ unreadNotification: notification }),

  addComment: (comment) => {
    const prev = get().comments;
    const next = [...prev, comment];
    set({ comments: next, activeCommentId: comment.id, newCommentDraftPosition: null, newCommentDraftTarget: null, isCommentMode: false });
    get().yjsSyncCallback?.('set_comment', comment);
  },

  addReply: (commentId, reply) => {
    const next = get().comments.map((c) => {
      if (c.id !== commentId) return c;
      return {
        ...c,
        replies: [...c.replies, reply],
      };
    });
    set({ comments: next });
    const updated = next.find((c) => c.id === commentId);
    if (updated) get().yjsSyncCallback?.('set_comment', updated);
  },

  toggleResolve: (commentId, resolvedBy) => {
    const next = get().comments.map((c) => {
      if (c.id !== commentId) return c;
      const willResolve = !c.resolved;
      return {
        ...c,
        resolved: willResolve,
        resolvedAt: willResolve ? Date.now() : undefined,
        resolvedBy: willResolve ? resolvedBy : undefined,
      };
    });
    set({ comments: next });
    const updated = next.find((c) => c.id === commentId);
    if (updated) get().yjsSyncCallback?.('set_comment', updated);
  },

  addReaction: (commentId, reaction, replyId) => {
    const next = get().comments.map((c) => {
      if (c.id !== commentId) return c;
      if (!replyId) {
        const exists = c.reactions.some(
          (r) => r.emoji === reaction.emoji && r.userId === reaction.userId
        );
        const nextReactions = exists
          ? c.reactions.filter((r) => !(r.emoji === reaction.emoji && r.userId === reaction.userId))
          : [...c.reactions, reaction];
        return { ...c, reactions: nextReactions };
      }
      const nextReplies = c.replies.map((rep) => {
        if (rep.id !== replyId) return rep;
        const repReactions = rep.reactions || [];
        const exists = repReactions.some(
          (r) => r.emoji === reaction.emoji && r.userId === reaction.userId
        );
        const filtered = exists
          ? repReactions.filter((r) => !(r.emoji === reaction.emoji && r.userId === reaction.userId))
          : [...repReactions, reaction];
        return { ...rep, reactions: filtered };
      });
      return { ...c, replies: nextReplies };
    });
    set({ comments: next });
    const updated = next.find((c) => c.id === commentId);
    if (updated) get().yjsSyncCallback?.('set_comment', updated);
  },

  deleteComment: (commentId) => {
    const next = get().comments.filter((c) => c.id !== commentId);
    set({
      comments: next,
      activeCommentId: get().activeCommentId === commentId ? null : get().activeCommentId,
    });
    get().yjsSyncCallback?.('delete_comment', { id: commentId });
  },

  updateDetachedStatus: (nodes, edges) => {
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edgeIds = new Set(edges.map((e) => e.id));
    let changed = false;

    const next = get().comments.map((c) => {
      let isDetached = false;
      if (c.targetType === 'node' && c.targetId && !nodeIds.has(c.targetId)) {
        isDetached = true;
      } else if (c.targetType === 'edge' && c.targetId && !edgeIds.has(c.targetId)) {
        isDetached = true;
      }

      if (c.targetDetached !== isDetached) {
        changed = true;
        return { ...c, targetDetached: isDetached };
      }
      return c;
    });

    if (changed) {
      set({ comments: next });
    }
  },

  getNextCommentId: (direction) => {
    const { comments, activeCommentId, filterMode } = get();
    const visible = filterMode === 'unresolved_only' ? comments.filter((c) => !c.resolved) : comments;
    if (visible.length === 0) return null;

    if (!activeCommentId) return visible[0].id;
    const curIdx = visible.findIndex((c) => c.id === activeCommentId);
    if (curIdx === -1) return visible[0].id;

    if (direction === 'next') {
      const nextIdx = (curIdx + 1) % visible.length;
      return visible[nextIdx].id;
    } else {
      const prevIdx = (curIdx - 1 + visible.length) % visible.length;
      return visible[prevIdx].id;
    }
  },

  reset: () =>
    set({
      comments: [],
      activeCommentId: null,
      isCommentMode: false,
      filterMode: 'all',
      isReviewDrawerOpen: false,
      newCommentDraftPosition: null,
      newCommentDraftTarget: null,
      unreadNotification: null,
    }),
}));

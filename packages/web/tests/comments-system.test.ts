import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { useCommentsStore } from '../src/features/comments/comments-store';
import { bindCommentsYjs } from '../src/features/comments/yjs-comments-sync';
import type { CanvasComment } from '../src/features/comments/types';
import type { FlowNode, FlowEdge } from '@flowstudio/shared';

describe('Canvas Comment & Pinning System', () => {
  beforeEach(() => {
    useCommentsStore.getState().reset();
  });

  it('manages comment lifecycle: add, reply, toggle resolve, and reaction', () => {
    const store = useCommentsStore.getState();

    const comment: CanvasComment = {
      id: 'comm-1',
      authorId: 'u1',
      authorName: '张工',
      authorColor: '#3b82f6',
      content: '这个节点的超时重试逻辑需要补充',
      createdAt: 1000,
      resolved: false,
      targetType: 'node',
      targetId: 'node-pay',
      targetLabel: '订单支付',
      position: { x: 120, y: 140 },
      replies: [],
      reactions: [],
    };

    store.addComment(comment);
    expect(useCommentsStore.getState().comments.length).toBe(1);
    expect(useCommentsStore.getState().comments[0].id).toBe('comm-1');
    expect(useCommentsStore.getState().activeCommentId).toBe('comm-1');

    store.addReply('comm-1', {
      id: 'rep-1',
      authorId: 'u2',
      authorName: '李架构',
      authorColor: '#10b981',
      content: '已在后端补充指数退避重试',
      createdAt: 1020,
    });
    expect(useCommentsStore.getState().comments[0].replies.length).toBe(1);

    store.addReaction('comm-1', { emoji: '👍', userId: 'u1', nickname: '张工' });
    expect(useCommentsStore.getState().comments[0].reactions.length).toBe(1);

    store.addReaction('comm-1', { emoji: '👍', userId: 'u1', nickname: '张工' });
    expect(useCommentsStore.getState().comments[0].reactions.length).toBe(0);

    store.toggleResolve('comm-1', '张工');
    expect(useCommentsStore.getState().comments[0].resolved).toBe(true);
    expect(useCommentsStore.getState().comments[0].resolvedBy).toBe('张工');
  });

  it('handles target detachment preservation when associated node is deleted', () => {
    const store = useCommentsStore.getState();

    const comment: CanvasComment = {
      id: 'comm-node',
      authorId: 'u1',
      authorName: '张工',
      authorColor: '#3b82f6',
      content: '需要确认合规审计规则',
      createdAt: 1000,
      resolved: false,
      targetType: 'node',
      targetId: 'node-audit',
      position: { x: 200, y: 300 },
      replies: [],
      reactions: [],
    };
    store.addComment(comment);

    const nodesBefore: FlowNode[] = [
      { id: 'node-audit', type: 'process', position: { x: 200, y: 300 }, data: { label: '合规审计' } },
    ];
    store.updateDetachedStatus(nodesBefore, []);
    expect(useCommentsStore.getState().comments[0].targetDetached).toBe(false);

    const nodesAfter: FlowNode[] = [];
    store.updateDetachedStatus(nodesAfter, []);
    const after = useCommentsStore.getState().comments[0];

    expect(after.targetDetached).toBe(true);
    expect(after.position).toEqual({ x: 200, y: 300 });
    expect(after.content).toBe('需要确认合规审计规则');
  });

  it('navigates next and previous comments sequentially with filter awareness', () => {
    const store = useCommentsStore.getState();

    const c1: CanvasComment = {
      id: 'c1',
      authorId: 'u1',
      authorName: 'A',
      authorColor: '#000',
      content: '1',
      createdAt: 10,
      resolved: false,
      targetType: 'canvas',
      position: { x: 0, y: 0 },
      replies: [],
      reactions: [],
    };
    const c2: CanvasComment = {
      id: 'c2',
      authorId: 'u1',
      authorName: 'A',
      authorColor: '#000',
      content: '2',
      createdAt: 20,
      resolved: true,
      targetType: 'canvas',
      position: { x: 10, y: 10 },
      replies: [],
      reactions: [],
    };
    const c3: CanvasComment = {
      id: 'c3',
      authorId: 'u1',
      authorName: 'A',
      authorColor: '#000',
      content: '3',
      createdAt: 30,
      resolved: false,
      targetType: 'canvas',
      position: { x: 20, y: 20 },
      replies: [],
      reactions: [],
    };

    store.addComment(c1);
    store.addComment(c2);
    store.addComment(c3);

    store.setActiveCommentId('c1');
    expect(store.getNextCommentId('next')).toBe('c2');
    expect(store.getNextCommentId('prev')).toBe('c3');

    store.setFilterMode('unresolved_only');
    expect(store.getNextCommentId('next')).toBe('c3');
  });

  it('synchronizes comments across two Y.Docs in real-time and triggers remote notification', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    docA.on('update', (update) => Y.applyUpdate(docB, update));
    docB.on('update', (update) => Y.applyUpdate(docA, update));

    const unbindA = bindCommentsYjs(docA, 'client-a');

    const commentA: CanvasComment = {
      id: 'comm-sync',
      authorId: 'client-a',
      authorName: 'Alice',
      authorColor: '#ef4444',
      content: '跨端实时协同批注测试',
      createdAt: 500,
      resolved: false,
      targetType: 'canvas',
      position: { x: 80, y: 90 },
      replies: [],
      reactions: [],
    };

    useCommentsStore.getState().addComment(commentA);

    const bCommentsMap = docB.getMap<Y.Map<unknown>>('comments');
    expect(bCommentsMap.has('comm-sync')).toBe(true);

    const sub = bCommentsMap.get('comm-sync');
    expect(sub?.get('content')).toBe('跨端实时协同批注测试');

    unbindA();
  });
});

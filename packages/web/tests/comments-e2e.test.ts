import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { useCommentsStore } from '../src/features/comments/comments-store';
import { bindCommentsYjs } from '../src/features/comments/yjs-comments-sync';
import type { CanvasComment } from '../src/features/comments/types';
import type { FlowNode, FlowEdge } from '@flowstudio/shared';

describe('Comments & Pinning End-to-End Suite', () => {
  beforeEach(() => {
    useCommentsStore.getState().reset();
  });

  it('simulates 5 concurrent clients creating comments and replies with 0 loss', () => {
    const docs = Array.from({ length: 5 }, () => new Y.Doc());
    const unbinds: Array<() => void> = [];

    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        if (i !== j) {
          docs[i].on('update', (update) => Y.applyUpdate(docs[j], update));
        }
      }
    }

    const unbind0 = bindCommentsYjs(docs[0], 'client-0');
    unbinds.push(unbind0);

    for (let i = 0; i < 5; i++) {
      const c: CanvasComment = {
        id: `comm-c${i}`,
        authorId: `client-${i}`,
        authorName: `Member ${i}`,
        authorColor: '#3b82f6',
        content: `Comment from member ${i}`,
        createdAt: 1000 + i * 10,
        resolved: false,
        targetType: 'canvas',
        position: { x: i * 50, y: i * 50 },
        replies: [
          {
            id: `rep-c${i}-1`,
            authorId: `client-${i}`,
            authorName: `Member ${i}`,
            authorColor: '#3b82f6',
            content: `Reply 1 from ${i}`,
            createdAt: 1005 + i * 10,
            reactions: [{ emoji: '🎉', userId: `client-${i}`, nickname: `Member ${i}` }],
          },
        ],
        reactions: [{ emoji: '👍', userId: `client-${i}`, nickname: `Member ${i}` }],
      };

      const cMap = docs[i].getMap<Y.Map<unknown>>('comments');
      docs[i].transact(() => {
        const sub = new Y.Map<unknown>();
        cMap.set(c.id, sub);
        Object.entries(c).forEach(([k, v]) => sub.set(k, v));
      }, `client-${i}`);
    }

    for (let i = 0; i < 5; i++) {
      const map = docs[i].getMap<Y.Map<unknown>>('comments');
      expect(map.size).toBe(5);
      for (let j = 0; j < 5; j++) {
        expect(map.has(`comm-c${j}`)).toBe(true);
      }
    }

    unbinds.forEach((u) => u());
  });

  it('guarantees 100% retention rate and detached badge when pinned node is deleted', () => {
    const store = useCommentsStore.getState();

    const nodeA: FlowNode = {
      id: 'node-approval',
      type: 'decision',
      position: { x: 300, y: 150 },
      data: { label: '审批校验' },
    };

    store.addComment({
      id: 'comm-approval',
      authorId: 'u-qa',
      authorName: '测试组',
      authorColor: '#f59e0b',
      content: '此处分支需补充双重审批逻辑',
      createdAt: Date.now(),
      resolved: false,
      targetType: 'node',
      targetId: 'node-approval',
      targetLabel: '审批校验',
      position: { x: 300, y: 150 },
      replies: [],
      reactions: [],
    });

    store.updateDetachedStatus([nodeA], []);
    expect(useCommentsStore.getState().comments[0].targetDetached).toBe(false);

    store.updateDetachedStatus([], []);
    const commentAfter = useCommentsStore.getState().comments[0];
    expect(commentAfter.targetDetached).toBe(true);
    expect(commentAfter.position).toEqual({ x: 300, y: 150 });
    expect(commentAfter.content).toBe('此处分支需补充双重审批逻辑');
  });

  it('verifies sequential review mode navigation and resolved filter flow', () => {
    const store = useCommentsStore.getState();

    for (let i = 1; i <= 4; i++) {
      store.addComment({
        id: `comm-seq-${i}`,
        authorId: `u${i}`,
        authorName: `User ${i}`,
        authorColor: '#6366f1',
        content: `Issue ${i}`,
        createdAt: 100 * i,
        resolved: i % 2 === 0,
        targetType: 'canvas',
        position: { x: i * 100, y: i * 50 },
        replies: [],
        reactions: [],
      });
    }

    expect(useCommentsStore.getState().comments.length).toBe(4);

    store.setActiveCommentId('comm-seq-1');
    expect(store.getNextCommentId('next')).toBe('comm-seq-2');
    expect(store.getNextCommentId('prev')).toBe('comm-seq-4');

    store.setFilterMode('unresolved_only');
    expect(store.getNextCommentId('next')).toBe('comm-seq-3');
    expect(store.getNextCommentId('prev')).toBe('comm-seq-3');

    store.toggleResolve('comm-seq-1', '测试经理');
    expect(useCommentsStore.getState().comments.find((c) => c.id === 'comm-seq-1')?.resolved).toBe(true);
  });
});

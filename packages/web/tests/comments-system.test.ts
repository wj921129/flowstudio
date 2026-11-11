import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { useCommentsStore } from '../src/features/comments/comments-store';
import { bindCommentsYjs } from '../src/features/comments/yjs-comments-sync';
import type { CanvasComment } from '../src/features/comments/types';
import type { FlowNode, FlowEdge } from '@flowstudio/shared';
import { getNodeWorldPosition, findEdgeAtPosition } from '../src/features/canvas/utils/split-insert-manager';

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

  it('prevents cross-diagram contamination on switch and unbind', () => {
    const doc1 = new Y.Doc();
    const unbind1 = bindCommentsYjs(doc1, 'client-1');

    useCommentsStore.getState().addComment({
      id: 'comm-diag-1',
      authorId: 'client-1',
      authorName: 'U1',
      authorColor: '#000',
      content: 'Diagram 1 comment',
      createdAt: 10,
      resolved: false,
      targetType: 'canvas',
      position: { x: 10, y: 10 },
      replies: [],
      reactions: [],
    });

    expect(useCommentsStore.getState().comments.length).toBe(1);

    unbind1();
    expect(useCommentsStore.getState().comments.length).toBe(0);

    const doc2 = new Y.Doc();
    const unbind2 = bindCommentsYjs(doc2, 'client-1');
    expect(useCommentsStore.getState().comments.length).toBe(0);

    unbind2();
  });

  it('correctly resolves swimlane nested child node world coordinates and edge snapping', () => {
    const nodes: FlowNode[] = [
      { id: 'pool-1', type: 'pool', position: { x: 100, y: 100 }, data: { label: '审批泳池' }, width: 800, height: 400 },
      { id: 'lane-1', type: 'lane', parentId: 'pool-1', position: { x: 0, y: 40 }, data: { label: '风控泳道' }, width: 800, height: 180 },
      { id: 'step-1', type: 'process', parentId: 'lane-1', position: { x: 50, y: 30 }, data: { label: '反洗钱检查' }, width: 120, height: 60 },
      { id: 'step-2', type: 'process', parentId: 'lane-1', position: { x: 250, y: 30 }, data: { label: '信用评分' }, width: 120, height: 60 },
    ];

    const edges: FlowEdge[] = [
      { id: 'edge-step-1-2', source: 'step-1', target: 'step-2', data: { label: '通过审核' } },
    ];

    const nodeMap = new Map<string, FlowNode>(nodes.map((n) => [n.id, n]));
    const worldStep1 = getNodeWorldPosition(nodes[2], nodeMap);
    expect(worldStep1).toEqual({ x: 150, y: 170 });

    const clickPointInsideStep1 = { x: 180, y: 190 };
    const candidates = nodes.filter((n) => {
      const wp = getNodeWorldPosition(n, nodeMap);
      const w = n.width || 120;
      const h = n.height || 60;
      return (
        clickPointInsideStep1.x >= wp.x &&
        clickPointInsideStep1.x <= wp.x + w &&
        clickPointInsideStep1.y >= wp.y &&
        clickPointInsideStep1.y <= wp.y + h
      );
    });

    candidates.sort((a, b) => {
      const isContainerA = a.type === 'lane' || a.type === 'pool' || a.type === 'group';
      const isContainerB = b.type === 'lane' || b.type === 'pool' || b.type === 'group';
      if (isContainerA !== isContainerB) return isContainerA ? 1 : -1;
      const depthA = a.parentId ? 1 : 0;
      const depthB = b.parentId ? 1 : 0;
      return depthB - depthA;
    });

    expect(candidates[0].id).toBe('step-1');
    expect(candidates[0].data.label).toBe('反洗钱检查');

    const clickPointNearEdge = { x: 300, y: 200 };
    const hitEdge = findEdgeAtPosition(edges, nodes, clickPointNearEdge, 20);
    expect(hitEdge).not.toBeNull();
    expect(hitEdge?.edge.id).toBe('edge-step-1-2');
  });
});

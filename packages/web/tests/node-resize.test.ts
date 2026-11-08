/**
 * @fileoverview 元素宽高中心同步缩放回归测试
 * @description 需求：拖任意一边/一角改尺寸时，对侧等量同步变化（中心点保持不动）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import type { NodeChange } from '@xyflow/react';
import { YjsDiagramBridge } from '../src/features/collaboration/yjs-doc-bridge';
import { CollaborativeUndoManager } from '../src/features/collaboration/undo-manager';
import { useFlowStore } from '../src/stores/flow-store';

const resizeChange = (id: string, width: number, height: number) => [
  {
    id,
    type: 'dimensions',
    resizing: true,
    setAttributes: true,
    dimensions: { width, height },
  } as unknown as NodeChange,
];

describe('元素宽高中心同步缩放', () => {
  let docA: Y.Doc;
  let docB: Y.Doc;
  let bridgeA: YjsDiagramBridge;
  let bridgeB: YjsDiagramBridge;
  let undoA: CollaborativeUndoManager;

  beforeEach(() => {
    useFlowStore.getState().unbindCollaboration();
    useFlowStore.setState({
      nodes: [],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeId: null,
      historyPast: [],
      historyFuture: [],
    });

    docA = new Y.Doc();
    docB = new Y.Doc();
    docA.on('update', (u: Uint8Array) => Y.applyUpdate(docB, u));
    docB.on('update', (u: Uint8Array) => Y.applyUpdate(docA, u));

    bridgeA = new YjsDiagramBridge(docA, { localClientId: 'client-a' });
    bridgeB = new YjsDiagramBridge(docB, { localClientId: 'client-b' });
    undoA = new CollaborativeUndoManager(docA, 'client-a');
    useFlowStore.getState().bindCollaboration(bridgeA, undoA);
  });

  afterEach(() => {
    useFlowStore.getState().unbindCollaboration();
    docA.destroy();
    docB.destroy();
  });

  it('向左扩 20px 时右边界同样外扩 20px，上下同理', () => {
    // process 默认 160x80，落点 (100,100) → 中心 (180,140)，右边界 260，下边界 180
    const node = useFlowStore.getState().addNode('process', { x: 100, y: 100 });
    const store = useFlowStore.getState();

    store.startCenteredResize(node.id);
    store.onNodesChange(resizeChange(node.id, 200, 120));

    const after = useFlowStore.getState().nodes.find((n) => n.id === node.id)!;
    expect(after.width).toBe(200);
    expect(after.height).toBe(120);
    // 中心 (180,140) 保持不变：左边界 100→80（外扩 20），右边界 260→280（同样外扩 20）
    expect(after.position).toEqual({ x: 80, y: 80 });
    expect(100 - after.position.x).toBe(after.position.x + 200 - 260);
    expect(100 - after.position.y).toBe(after.position.y + 120 - 180);
  });

  it('缩放结束把中心锚定后的位置与尺寸落到 Y.Doc', () => {
    const node = useFlowStore.getState().addNode('decision', { x: 300, y: 200 });
    const store = useFlowStore.getState();

    store.startCenteredResize(node.id);
    store.onNodesChange(resizeChange(node.id, 200, 140));
    useFlowStore.getState().finishCenteredResize(node.id);

    const persisted = bridgeB.toReactFlowState().nodes.find((n) => n.id === node.id)!;
    // decision 默认 140x100 → 中心 (370,250)
    expect(persisted.width).toBe(200);
    expect(persisted.position).toEqual({ x: 270, y: 180 });
  });

  it('未开启中心锚定时沿用 React Flow 的对角锚定（位置不动）', () => {
    const node = useFlowStore.getState().addNode('process', { x: 100, y: 100 });

    useFlowStore.getState().onNodesChange(resizeChange(node.id, 200, 120));

    const after = useFlowStore.getState().nodes.find((n) => n.id === node.id)!;
    expect(after.position).toEqual({ x: 100, y: 100 });
    expect(after.width).toBe(200);
  });
});

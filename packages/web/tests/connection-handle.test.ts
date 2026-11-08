/**
 * @fileoverview 连线链路回归测试
 * @description 锁定协同层曾打断连线的两处回归：
 *   1) React Flow 的纯 DOM 尺寸测量不得写入 Y.Doc，否则 commit→回灌→重测量自激循环；
 *   2) 桥回灌必须保留 React Flow 拥有的 measured，否则 handleBounds 被清空，连不出线且已有连线不渲染。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import type { NodeChange } from '@xyflow/react';
import { YjsDiagramBridge } from '../src/features/collaboration/yjs-doc-bridge';
import { CollaborativeUndoManager } from '../src/features/collaboration/undo-manager';
import { useFlowStore } from '../src/stores/flow-store';

const measuredOf = (nodeId: string) => {
  const node = useFlowStore.getState().nodes.find((n) => n.id === nodeId);
  return (node as { measured?: { width?: number; height?: number } } | undefined)?.measured;
};

const applyMeasurement = (nodeId: string, width: number, height: number) => {
  useFlowStore.getState().onNodesChange([
    { id: nodeId, type: 'dimensions', dimensions: { width, height } } as unknown as NodeChange,
  ]);
};

describe('连线链路与协同回灌', () => {
  let docA: Y.Doc;
  let docB: Y.Doc;
  let bridgeA: YjsDiagramBridge;
  let bridgeB: YjsDiagramBridge;
  let undoA: CollaborativeUndoManager;
  let localWrites = 0;
  const countLocalWrites = () => localWrites++;

  beforeEach(() => {
    useFlowStore.getState().unbindCollaboration();
    useFlowStore.setState({
      nodes: [],
      edges: [],
      selectedNodeIds: [],
      selectedEdgeId: null,
      historyPast: [],
      historyFuture: [],
      diagramTitle: '未命名流程图',
    });

    docA = new Y.Doc();
    docB = new Y.Doc();
    docA.on('update', (u: Uint8Array) => Y.applyUpdate(docB, u));
    docB.on('update', (u: Uint8Array) => Y.applyUpdate(docA, u));
    docA.on('update', countLocalWrites);

    bridgeA = new YjsDiagramBridge(docA, { localClientId: 'client-a' });
    bridgeB = new YjsDiagramBridge(docB, { localClientId: 'client-b' });
    undoA = new CollaborativeUndoManager(docA, 'client-a');
    useFlowStore.getState().bindCollaboration(bridgeA, undoA);
  });

  afterEach(() => {
    docA.off('update', countLocalWrites);
    localWrites = 0;
    useFlowStore.getState().unbindCollaboration();
    docA.destroy();
    docB.destroy();
  });

  it('纯尺寸测量只落本地，既不写 Y.Doc 也不污染撤销栈', () => {
    const node = useFlowStore.getState().addNode('process', { x: 0, y: 0 });
    const historyLen = useFlowStore.getState().historyPast.length;
    const writesAfterAdd = localWrites;

    applyMeasurement(node.id, 160, 80);

    expect(localWrites).toBe(writesAfterAdd);
    expect(useFlowStore.getState().historyPast.length).toBe(historyLen);
    expect(measuredOf(node.id)).toEqual({ width: 160, height: 80 });
  });

  it('泳道 Resizer 的尺寸变更仍需持久化到 Y.Doc', () => {
    const node = useFlowStore.getState().addNode('process', { x: 0, y: 0 });

    useFlowStore.getState().onNodesChange([
      {
        id: node.id,
        type: 'dimensions',
        resizing: false,
        setAttributes: true,
        dimensions: { width: 320, height: 200 },
      } as unknown as NodeChange,
    ]);

    const persisted = bridgeB.toReactFlowState().nodes.find((n) => n.id === node.id);
    expect(persisted?.width).toBe(320);
  });

  it('桥回灌后仍保留 measured，保住 handleBounds 赖以存在的度量', () => {
    const node = useFlowStore.getState().addNode('process', { x: 0, y: 0 });
    applyMeasurement(node.id, 160, 80);
    expect(measuredOf(node.id)).toEqual({ width: 160, height: 80 });

    // 同事在另一端改标题，触发本地全量回灌
    bridgeB.setTitle('同事改过的标题');

    expect(useFlowStore.getState().diagramTitle).toBe('同事改过的标题');
    expect(measuredOf(node.id)).toEqual({ width: 160, height: 80 });
  });

  it('onConnect 建立的连线同步给协作端', () => {
    const a = useFlowStore.getState().addNode('start-end', { x: 0, y: 0 });
    const b = useFlowStore.getState().addNode('process', { x: 240, y: 0 });

    useFlowStore.getState().onConnect({ source: a.id, target: b.id, sourceHandle: 'right', targetHandle: 'left' });

    expect(useFlowStore.getState().edges).toHaveLength(1);
    const remote = bridgeB.toReactFlowState();
    expect(remote.edges).toHaveLength(1);
    expect(remote.edges[0].source).toBe(a.id);
    expect(remote.edges[0].sourceHandle).toBe('right');
  });
});

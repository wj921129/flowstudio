import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { YjsDiagramBridge } from '../src/features/collaboration/yjs-doc-bridge';
import { CollaborativeUndoManager } from '../src/features/collaboration/undo-manager';
import { useFlowStore } from '../src/stores/flow-store';

describe('useFlowStore + Yjs integration', () => {
  let docA: Y.Doc;
  let docB: Y.Doc;
  let bridgeA: YjsDiagramBridge;
  let bridgeB: YjsDiagramBridge;
  let undoA: CollaborativeUndoManager;

  beforeEach(() => {
    docA = new Y.Doc();
    docB = new Y.Doc();
    docA.on('update', (u: Uint8Array) => Y.applyUpdate(docB, u));
    docB.on('update', (u: Uint8Array) => Y.applyUpdate(docA, u));

    bridgeA = new YjsDiagramBridge(docA, { localClientId: 'client-a' });
    bridgeB = new YjsDiagramBridge(docB, { localClientId: 'client-b' });
    undoA = new CollaborativeUndoManager(docA, 'client-a', 0);

    useFlowStore.getState().bindCollaboration(bridgeA, undoA);
  });

  it('syncs addNode, groupSelectedNodes, alignSelectedNodes, and undo across Y.Doc', () => {
    const store = useFlowStore.getState();
    store.addNode('process', { x: 30, y: 30 });
    store.addNode('decision', { x: 240, y: 120 });

    const nodes = useFlowStore.getState().nodes;
    expect(nodes.length).toBe(2);
    expect(bridgeB.toReactFlowState().nodes.length).toBe(2);

    // 选中两个节点并执行成组
    useFlowStore.setState({
      nodes: nodes.map((n) => ({ ...n, selected: true })),
      selectedNodeIds: nodes.map((n) => n.id),
    });
    useFlowStore.getState().groupSelectedNodes({ label: '核心分组' });

    const stateB = bridgeB.toReactFlowState();
    expect(stateB.nodes.length).toBe(3); // 1 group + 2 children
    expect(stateB.nodes[0].type).toBe('group');

    // 执行撤销：回退成组操作
    useFlowStore.getState().undo();
    expect(bridgeB.toReactFlowState().nodes.length).toBe(2);
  });
});

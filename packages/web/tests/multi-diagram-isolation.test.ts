import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { YjsDiagramBridge } from '../src/features/collaboration/yjs-doc-bridge';
import { CollaborativeUndoManager } from '../src/features/collaboration/undo-manager';
import { useFlowStore } from '../src/stores/flow-store';

describe('Multi-Diagram Lifecycle Isolation & Spotlight State', () => {
  let doc1: Y.Doc;
  let bridge1: YjsDiagramBridge;
  let undo1: CollaborativeUndoManager;

  let doc2: Y.Doc;
  let bridge2: YjsDiagramBridge;
  let undo2: CollaborativeUndoManager;

  beforeEach(() => {
    // 确保每个测试用例前重置 store 状态并清理解析
    useFlowStore.getState().unbindCollaboration();
    useFlowStore.getState().resetDiagramState();

    doc1 = new Y.Doc();
    bridge1 = new YjsDiagramBridge(doc1, { localClientId: 'client-diagram-1' });
    undo1 = new CollaborativeUndoManager(doc1, 'client-diagram-1', 0);

    doc2 = new Y.Doc();
    bridge2 = new YjsDiagramBridge(doc2, { localClientId: 'client-diagram-2' });
    undo2 = new CollaborativeUndoManager(doc2, 'client-diagram-2', 0);
  });

  it('thoroughly cleans up state when resetting diagram state', () => {
    const store = useFlowStore.getState();

    // 1. 设置丰富的业务瞬态
    store.addNode('process', { x: 100, y: 100 });
    store.setSelectedNodes(['test-node-1']);
    store.setSelectedEdge('test-edge-1');
    store.toggleSpotlightMode(true);
    store.setSpotlightTarget('test-node-1', '分支A');
    store.setFollowingUser('user-lead-123');

    // 验证状态已生效
    expect(useFlowStore.getState().nodes.length).toBeGreaterThan(0);
    expect(useFlowStore.getState().spotlightActive).toBe(true);
    expect(useFlowStore.getState().spotlightTargetId).toBe('test-node-1');
    expect(useFlowStore.getState().spotlightBranchFilter).toBe('分支A');
    expect(useFlowStore.getState().followingUserId).toBe('user-lead-123');

    // 2. 执行 resetDiagramState
    useFlowStore.getState().resetDiagramState();

    // 验证所有图元与交互状态全部归零，杜绝跨图残留
    const after = useFlowStore.getState();
    expect(after.nodes).toEqual([]);
    expect(after.edges).toEqual([]);
    expect(after.selectedNodeIds).toEqual([]);
    expect(after.selectedEdgeId).toBeNull();
    expect(after.spotlightActive).toBe(false);
    expect(after.spotlightTargetId).toBeNull();
    expect(after.spotlightBranchFilter).toBeNull();
    expect(after.followingUserId).toBeNull();
    expect(after.canUndo).toBe(false);
    expect(after.canRedo).toBe(false);
  });

  it('isolates Y.Doc synchronization across different diagram sessions', () => {
    // 1. 进入图表 1 并绑定协同
    const unbind1 = useFlowStore.getState().bindCollaboration(bridge1, undo1);

    useFlowStore.getState().addNode('start-end', { x: 50, y: 50 });
    useFlowStore.getState().addNode('process', { x: 200, y: 50 });

    expect(useFlowStore.getState().nodes.length).toBe(2);
    expect(bridge1.toReactFlowState().nodes.length).toBe(2);
    expect(bridge2.toReactFlowState().nodes.length).toBe(0);

    // 2. 模拟切图：解绑图表 1，重置本地状态并销毁旧 bridge
    unbind1();
    bridge1.destroy();
    doc1.destroy();
    useFlowStore.getState().resetDiagramState();

    expect(useFlowStore.getState().nodes.length).toBe(0);

    // 3. 绑定图表 2
    const unbind2 = useFlowStore.getState().bindCollaboration(bridge2, undo2);

    // 验证图表 2 中没有任何图表 1 的节点残留
    expect(useFlowStore.getState().nodes.length).toBe(0);
    expect(bridge2.toReactFlowState().nodes.length).toBe(0);

    // 在图表 2 中新建节点
    useFlowStore.getState().addNode('database', { x: 300, y: 150 });

    expect(useFlowStore.getState().nodes.length).toBe(1);
    expect(bridge2.toReactFlowState().nodes.length).toBe(1);
    expect(bridge2.toReactFlowState().nodes[0].type).toBe('database');

    unbind2();
    bridge2.destroy();
    doc2.destroy();
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import type { FlowNode, FlowEdge } from '@flowstudio/shared';
import { YjsDiagramBridge } from '../src/features/collaboration/yjs-doc-bridge';
import { CollaborativeUndoManager } from '../src/features/collaboration/undo-manager';
import { useFlowStore } from '../src/stores/flow-store';
import { handleNodeDragNesting } from '../src/features/canvas/utils/lane-nesting-manager';

describe('useFlowStore + Yjs integration', () => {
  let docA: Y.Doc;
  let docB: Y.Doc;
  let bridgeA: YjsDiagramBridge;
  let bridgeB: YjsDiagramBridge;
  let undoA: CollaborativeUndoManager;

  beforeEach(() => {
    useFlowStore.getState().unbindCollaboration();
    useFlowStore.getState().resetDiagramState();

    docA = new Y.Doc();
    docB = new Y.Doc();
    docA.on('update', (u: Uint8Array) => Y.applyUpdate(docB, u));
    docB.on('update', (u: Uint8Array) => Y.applyUpdate(docA, u));

    bridgeA = new YjsDiagramBridge(docA, { localClientId: 'client-a' });
    bridgeB = new YjsDiagramBridge(docB, { localClientId: 'client-b' });
    undoA = new CollaborativeUndoManager(docA, 'client-a', 0);

    useFlowStore.getState().bindCollaboration(bridgeA, undoA);
  });

  afterEach(() => {
    useFlowStore.getState().unbindCollaboration();
    bridgeA.destroy();
    bridgeB.destroy();
    undoA.destroy();
    docA.destroy();
    docB.destroy();
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

  it('commits local edits incrementally without calling bridge.setDiagram', () => {
    const spySetDiagram = vi.spyOn(bridgeA, 'setDiagram');
    const store = useFlowStore.getState();

    const n1 = store.addNode('process', { x: 20, y: 20 });
    const n2 = store.addNode('process', { x: 220, y: 20 });
    store.updateNodeData(n1.id, { label: '步骤一' });
    store.updateNodeDimensions(n1.id, 180, 90);
    store.onConnect({ source: n1.id, target: n2.id, sourceHandle: null, targetHandle: null });

    const edgeId = useFlowStore.getState().edges[0].id;
    store.updateEdgeData(edgeId, { label: '流转' });
    store.setSelectedNodes([n1.id, n2.id]);
    store.alignSelectedNodes('top');
    store.groupSelectedNodes({ label: '分组' });
    store.ungroupNodes();
    store.deleteEdgeLabel(edgeId);
    store.onNodesChange([
      { id: n1.id, type: 'position', position: { x: 60, y: 40 }, dragging: false } as any,
    ]);

    expect(spySetDiagram).not.toHaveBeenCalled();

    const stateB = bridgeB.toReactFlowState();
    expect(stateB.nodes.find((n) => n.id === n1.id)?.data.label).toBe('步骤一');
    expect(stateB.nodes.find((n) => n.id === n1.id)?.position).toEqual({ x: 60, y: 40 });
    expect(stateB.edges.length).toBe(1);
    expect(stateB.edges[0].label).toBeUndefined();

    // 显式全图替换才调用 bridge.setDiagram
    store.setDiagram([], []);
    expect(spySetDiagram).toHaveBeenCalledTimes(1);
  });

  it('protects dragging node position during remote updates and preserves remote edits on drag end', () => {
    const store = useFlowStore.getState();
    const nA = store.addNode('process', { x: 100, y: 100 });
    const nB = store.addNode('process', { x: 300, y: 100 });

    // 开始拖拽 nA（dragging: true）
    store.onNodesChange([
      { id: nA.id, type: 'position', position: { x: 180, y: 150 }, dragging: true } as any,
    ]);

    const draggingNode = useFlowStore.getState().nodes.find((n) => n.id === nA.id)!;
    expect(draggingNode.position).toEqual({ x: 180, y: 150 });
    expect(draggingNode.dragging).toBe(true);

    // 拖拽中途远端新增 nC 并修改 nB 位置、修改 nA 文案
    const nC: FlowNode = { id: 'remote-c', type: 'decision', position: { x: 500, y: 100 }, data: { label: '远端节点', type: 'decision' } };
    bridgeB.putNodes([nC]);
    bridgeB.patchNode(nB.id, { position: { x: 350, y: 120 } });
    bridgeB.patchNode(nA.id, { data: { label: '远端改名' } });

    // 本地状态已包含远端新增与改动，同时被拖拽节点 nA 位置与 dragging 态不被弹回
    const midNodes = useFlowStore.getState().nodes;
    const midA = midNodes.find((n) => n.id === nA.id)!;
    expect(midA.position).toEqual({ x: 180, y: 150 });
    expect(midA.dragging).toBe(true);
    expect(midA.data.label).toBe('远端改名');
    expect(midNodes.some((n) => n.id === 'remote-c')).toBe(true);
    expect(midNodes.find((n) => n.id === nB.id)?.position).toEqual({ x: 350, y: 120 });

    // 松手（React Flow 常只发 dragging: false 不带 position）
    store.onNodesChange([
      { id: nA.id, type: 'position', dragging: false } as any,
    ]);

    const syncedB = bridgeB.toReactFlowState();
    expect(syncedB.nodes.find((n) => n.id === nA.id)?.position).toEqual({ x: 180, y: 150 });
    expect(syncedB.nodes.some((n) => n.id === 'remote-c')).toBe(true);
    expect(syncedB.nodes.find((n) => n.id === nB.id)?.position).toEqual({ x: 350, y: 120 });
  });

  it('commits swimlane nesting incrementally via applyIncrementalUpdate without overwriting concurrent remote nodes', () => {
    const store = useFlowStore.getState();
    const pool: FlowNode = {
      id: 'pool-1',
      type: 'pool',
      position: { x: 0, y: 0 },
      width: 800,
      height: 240,
      data: { label: '泳道池', type: 'pool', orientation: 'horizontal', laneOrder: ['lane-1'], headerSize: 40 },
    };
    const lane: FlowNode = {
      id: 'lane-1',
      type: 'lane',
      parentId: 'pool-1',
      position: { x: 0, y: 40 },
      width: 800,
      height: 200,
      data: { label: '泳道1', type: 'lane' },
    };
    const step: FlowNode = {
      id: 'step-1',
      type: 'process',
      position: { x: 120, y: 80 },
      width: 160,
      height: 80,
      data: { label: '步骤', type: 'process' },
    };
    store.setDiagram([pool, lane, step], []);

    // 远端并发新增一个节点
    const remoteNode: FlowNode = { id: 'remote-node', type: 'process', position: { x: 900, y: 50 }, data: { label: '远端', type: 'process' } };
    bridgeB.putNodes([remoteNode]);

    // 本地松手触发泳道吸附
    const prevNodes = useFlowStore.getState().nodes;
    const prevById = new Map(prevNodes.map((n) => [n.id, n]));
    const { updated, nextNodes } = handleNodeDragNesting('step-1', prevNodes);
    expect(updated).toBe(true);

    const changedNodes = nextNodes.filter((n) => prevById.get(n.id) !== n);
    store.applyIncrementalUpdate({ putNodes: changedNodes });

    const syncedB = bridgeB.toReactFlowState();
    expect(syncedB.nodes.some((n) => n.id === 'remote-node')).toBe(true);
    expect(syncedB.nodes.find((n) => n.id === 'step-1')?.parentId).toBe('lane-1');
  });

  it('cleans up dangling selectedNodeIds, selectedEdgeId, editingEdgeLabelId, and centeredResizes when remote deletes entities', () => {
    const store = useFlowStore.getState();
    const n1 = store.addNode('process', { x: 100, y: 100 });
    const n2 = store.addNode('process', { x: 300, y: 100 });
    store.onConnect({ source: n1.id, target: n2.id, sourceHandle: null, targetHandle: null });

    const edgeId = useFlowStore.getState().edges[0].id;
    store.setSelectedNodes([n1.id, n2.id]);
    store.setSelectedEdge(edgeId);
    store.setEditingEdgeLabelId(edgeId);
    store.startCenteredResize(n1.id);

    // 远端删除 n1（级联删除 edgeId）
    bridgeB.removeNodes([n1.id]);

    const after = useFlowStore.getState();
    expect(after.selectedNodeIds).toEqual([n2.id]);
    expect(after.selectedEdgeId).toBeNull();
    expect(after.editingEdgeLabelId).toBeNull();

    // finishCenteredResize 不应再触发任何写回
    const spyPatch = vi.spyOn(bridgeA, 'patchNode');
    store.finishCenteredResize(n1.id);
    expect(spyPatch).not.toHaveBeenCalled();
  });

  it('preserves untouched node references in store and skips undo pollution on system:init title hydration', () => {
    const store = useFlowStore.getState();
    const n1 = store.addNode('process', { x: 0, y: 0 });
    const n2 = store.addNode('process', { x: 200, y: 0 });
    undoA.clear();

    // 先由远端同步一次建立 raw cache 基线
    bridgeB.patchNode(n1.id, { position: { x: 10, y: 10 } });
    const refN2Before = useFlowStore.getState().nodes.find((n) => n.id === n2.id)!;

    // 远端再次只改 n1，n2 引用在 store 中也应保持稳定
    bridgeB.patchNode(n1.id, { position: { x: 20, y: 20 } });
    const refN2After = useFlowStore.getState().nodes.find((n) => n.id === n2.id)!;
    expect(refN2After).toBe(refN2Before);

    // system:init 标题补齐不污染撤销栈
    bridgeA.setTitle('服务端初始化标题', 'system:init');
    expect(useFlowStore.getState().diagramTitle).toBe('服务端初始化标题');
    expect(undoA.canUndo()).toBe(false);
  });

  it('skips structuredClone history snapshot in collaborative mode and short-circuits identical viewportZoom', () => {
    const cloneSpy = vi.spyOn(globalThis, 'structuredClone');
    const store = useFlowStore.getState();

    const n1 = store.addNode('process', { x: 10, y: 10 });
    store.updateNodeData(n1.id, { label: '已修改' });
    store.onNodesChange([
      { id: n1.id, type: 'position', position: { x: 50, y: 60 }, dragging: false } as any,
    ]);

    expect(cloneSpy).not.toHaveBeenCalled();
    cloneSpy.mockRestore();

    let notifyCount = 0;
    const unsub = useFlowStore.subscribe(() => {
      notifyCount++;
    });
    store.setViewportZoom(1.5);
    expect(notifyCount).toBe(1);
    store.setViewportZoom(1.5);
    expect(notifyCount).toBe(1);
    unsub();
  });

  it('merges rapid local edits within 500ms captureTimeout while keeping explicit breakpoints for imports', () => {
    useFlowStore.getState().unbindCollaboration();
    const timedUndo = new CollaborativeUndoManager(docA, 'client-a', 500);
    useFlowStore.getState().bindCollaboration(bridgeA, timedUndo);

    const store = useFlowStore.getState();
    const n1 = store.addNode('process', { x: 10, y: 10 });
    store.updateNodeData(n1.id, { label: '连贯编辑' });

    expect(timedUndo.canUndo()).toBe(true);
    store.undo();
    expect(useFlowStore.getState().nodes.length).toBe(0);

    // 显式导入操作（appendSubgraph / setDiagram）保持断点隔离
    const n2: FlowNode = { id: 'imp-1', type: 'process', position: { x: 0, y: 0 }, data: { label: '前置', type: 'process' } };
    store.addNodes([n2]);
    store.appendSubgraph(
      [{ id: 'imp-2', type: 'process', position: { x: 200, y: 0 }, data: { label: '导入', type: 'process' } }],
      []
    );
    expect(useFlowStore.getState().nodes.length).toBe(2);
    store.undo();
    expect(useFlowStore.getState().nodes.map((n) => n.id)).toEqual(['imp-1']);

    timedUndo.destroy();
  });

  it('clears toastTimer and centeredResizes on unbindCollaboration', () => {
    vi.useFakeTimers();
    const store = useFlowStore.getState();
    const n1 = store.addNode('process', { x: 100, y: 100 });
    store.startCenteredResize(n1.id);
    store.showToast('临时提示', 1000);

    store.unbindCollaboration();

    vi.advanceTimersByTime(1500);
    expect(useFlowStore.getState().toastMessage).toBe('临时提示');

    const spyPatch = vi.spyOn(bridgeA, 'patchNode');
    store.finishCenteredResize(n1.id);
    expect(spyPatch).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});

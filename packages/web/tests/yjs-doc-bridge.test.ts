import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { YjsDiagramBridge } from '../src/features/collaboration/yjs-doc-bridge';
import { getThemePreset } from '../src/features/sidebar/styles/theme-presets';
import type { FlowNode, FlowEdge } from '@flowstudio/shared';

describe('YjsDiagramBridge', () => {
  let docA: Y.Doc;
  let docB: Y.Doc;
  let bridgeA: YjsDiagramBridge;
  let bridgeB: YjsDiagramBridge;

  beforeEach(() => {
    docA = new Y.Doc();
    docB = new Y.Doc();
    bridgeA = new YjsDiagramBridge(docA, { localClientId: 'client-a' });
    bridgeB = new YjsDiagramBridge(docB, { localClientId: 'client-b' });

    docA.on('update', (update: Uint8Array) => Y.applyUpdate(docB, update));
    docB.on('update', (update: Uint8Array) => Y.applyUpdate(docA, update));
  });

  it('syncs nodes, edges, parent-child topological order, and filters dangling edges', () => {
    const childNode: FlowNode = {
      id: 'child-1',
      type: 'process',
      parentId: 'group-1',
      extent: 'parent',
      position: { x: 20, y: 40 },
      data: { label: '子节点', type: 'process', parentId: 'group-1' },
    };
    const groupNode: FlowNode = {
      id: 'group-1',
      type: 'group',
      position: { x: 100, y: 100 },
      width: 300,
      height: 200,
      data: { label: '分组容器', type: 'group', isFrame: true },
    };
    const validEdge: FlowEdge = {
      id: 'edge-1',
      source: 'child-1',
      target: 'group-1',
      type: 'orthogonal',
      data: { label: '连接', routingType: 'orthogonal' },
    };
    const danglingEdge: FlowEdge = {
      id: 'edge-ghost',
      source: 'child-1',
      target: 'non-existent-node',
    };

    // 故意先传入 child 再传入 group，验证输出时父容器自动排在前面
    bridgeA.setDiagram([childNode, groupNode], [validEdge, danglingEdge]);

    const stateB = bridgeB.toReactFlowState();
    expect(stateB.nodes.map((n) => n.id)).toEqual(['group-1', 'child-1']);
    expect(stateB.edges.map((e) => e.id)).toEqual(['edge-1']);
  });

  it('supports node and edge patch updates and cascading removal', () => {
    const n1: FlowNode = {
      id: 'n1',
      type: 'process',
      position: { x: 10, y: 10 },
      data: { label: '初版', type: 'process' },
    };
    const n2: FlowNode = {
      id: 'n2',
      type: 'decision',
      position: { x: 100, y: 100 },
      data: { label: '判定', type: 'decision' },
    };
    const e1: FlowEdge = {
      id: 'e1',
      source: 'n1',
      target: 'n2',
    };

    bridgeA.setDiagram([n1, n2], [e1]);
    expect(bridgeB.toReactFlowState().nodes.length).toBe(2);

    // 修改 n1
    bridgeA.patchNode('n1', { data: { label: '修改版', type: 'process' } });
    expect(bridgeB.toReactFlowState().nodes.find((n) => n.id === 'n1')?.data.label).toBe('修改版');

    // 删除 n1，关联的 e1 级联被剔除
    bridgeA.removeNodes(['n1']);
    const stateAfterRemove = bridgeB.toReactFlowState();
    expect(stateAfterRemove.nodes.map((n) => n.id)).toEqual(['n2']);
    expect(stateAfterRemove.edges.length).toBe(0);
  });

  it('does not accumulate CRDT history when re-committing an unchanged graph', () => {
    const node: FlowNode = {
      id: 'n1',
      type: 'process',
      position: { x: 10, y: 10 },
      data: { label: '处理', type: 'process' },
    };
    const edge: FlowEdge = { id: 'e1', source: 'n1', target: 'n1', data: { label: '', type: 'process' } };

    bridgeA.setDiagram([node], [edge]);
    const baseline = Y.encodeStateAsUpdate(docA).byteLength;

    // 画布每次变更都全量提交，重复提交同一状态不应产生新的 CRDT 条目
    for (let round = 0; round < 50; round++) {
      bridgeA.setDiagram([node], [edge]);
    }
    expect(Y.encodeStateAsUpdate(docA).byteLength).toBe(baseline);

    // 真实改动仍然同步
    bridgeA.setDiagram([{ ...node, position: { x: 999, y: 999 } }], [edge]);
    expect(bridgeB.toReactFlowState().nodes[0]?.position.x).toBe(999);
  });

  it('drops nodes and edges absent from the committed graph', () => {
    const nodeA: FlowNode = { id: 'a', type: 'process', position: { x: 0, y: 0 }, data: { label: 'A', type: 'process' } };
    const nodeB: FlowNode = { id: 'b', type: 'decision', position: { x: 1, y: 1 }, data: { label: 'B', type: 'decision' } };
    const edge: FlowEdge = { id: 'e-ab', source: 'a', target: 'b', data: { label: '', type: 'process' } };

    bridgeA.setDiagram([nodeA, nodeB], [edge]);
    bridgeA.setDiagram([nodeA], []);

    const state = bridgeB.toReactFlowState();
    expect(state.nodes.map((n) => n.id)).toEqual(['a']);
    expect(state.edges).toEqual([]);
  });

  it('sorts multi-level nested containers (pool -> lane -> group -> node) strictly parent-before-child', () => {
    const leaf: FlowNode = { id: 'leaf', type: 'process', parentId: 'group-1', position: { x: 10, y: 10 }, data: { label: 'Leaf' } };
    const group: FlowNode = { id: 'group-1', type: 'group', parentId: 'lane-1', position: { x: 20, y: 20 }, data: { label: 'Group' } };
    const lane: FlowNode = { id: 'lane-1', type: 'lane', parentId: 'pool-1', position: { x: 0, y: 40 }, data: { label: 'Lane' } };
    const pool: FlowNode = { id: 'pool-1', type: 'pool', position: { x: 50, y: 50 }, data: { label: 'Pool' } };

    // 故意以最深子孙在前、根池在后的逆序写入
    bridgeA.setDiagram([leaf, group, lane, pool], []);

    const ids = bridgeB.toReactFlowState().nodes.map((n) => n.id);
    expect(ids).toEqual(['pool-1', 'lane-1', 'group-1', 'leaf']);
  });

  it('skips redundant full toReactFlowState rebuild & subscriber broadcast on local graph mutations, while still syncing title and theme', () => {
    const n1: FlowNode = { id: 'n1', type: 'process', position: { x: 0, y: 0 }, data: { label: 'N1', type: 'process' } };
    bridgeA.putNodes([n1]);

    const spyToReactFlow = vi.spyOn(bridgeA, 'toReactFlowState');
    const localStates: Array<{ title: string; themeId?: string }> = [];
    bridgeA.subscribe((state) => {
      localStates.push({ title: state.title, themeId: state.themeId });
    });

    bridgeA.patchNode('n1', { position: { x: 80, y: 90 } });
    expect(spyToReactFlow).not.toHaveBeenCalled();
    expect(localStates.length).toBe(0);

    // 标题变更与主题变更仍需通知订阅者
    bridgeA.setTitle('新流程标题');
    expect(localStates.length).toBe(1);
    expect(localStates[0].title).toBe('新流程标题');

    bridgeA.applyTheme(getThemePreset('business-blue'));
    expect(localStates.length).toBe(2);
    expect(localStates[1].themeId).toBe('business-blue');
    expect(spyToReactFlow).not.toHaveBeenCalled();
  });

  it('reuses untouched node and edge object references on incremental remote updates', () => {
    const n1: FlowNode = { id: 'n1', type: 'process', position: { x: 0, y: 0 }, data: { label: 'N1', type: 'process' } };
    const n2: FlowNode = { id: 'n2', type: 'process', position: { x: 200, y: 0 }, data: { label: 'N2', type: 'process' } };
    const e1: FlowEdge = { id: 'e1', source: 'n1', target: 'n2', data: { label: '连接' } };

    bridgeA.setDiagram([n1, n2], [e1]);

    let latestStateB = bridgeB.getState();
    const unsub = bridgeB.subscribe((state) => {
      latestStateB = state;
    });

    const prevN1 = latestStateB.nodes.find((n) => n.id === 'n1')!;
    const prevN2 = latestStateB.nodes.find((n) => n.id === 'n2')!;
    const prevEdges = latestStateB.edges;

    // 远端仅更新 n1 位置，n2 与 edges 引用应保持完全不变
    bridgeA.patchNode('n1', { position: { x: 50, y: 60 } });

    const nextN1 = latestStateB.nodes.find((n) => n.id === 'n1')!;
    const nextN2 = latestStateB.nodes.find((n) => n.id === 'n2')!;
    expect(nextN1).not.toBe(prevN1);
    expect(nextN1.position).toEqual({ x: 50, y: 60 });
    expect(nextN2).toBe(prevN2);
    expect(latestStateB.edges).toBe(prevEdges);

    // 远端仅更新 e1 标签，nodes 数组引用应保持完全不变
    const prevNodes = latestStateB.nodes;
    const prevE1 = latestStateB.edges[0];
    bridgeA.patchEdge('e1', { label: '通过' });

    expect(latestStateB.nodes).toBe(prevNodes);
    expect(latestStateB.edges[0]).not.toBe(prevE1);
    expect(latestStateB.edges[0].label).toBe('通过');

    unsub();
  });

  it('allows patchNode and patchEdge to clear optional fields with explicit undefined', () => {
    const n1: FlowNode = {
      id: 'n1',
      type: 'process',
      parentId: 'lane-1',
      extent: 'parent',
      position: { x: 10, y: 10 },
      data: { label: 'N1' },
    };
    const lane: FlowNode = { id: 'lane-1', type: 'lane', position: { x: 0, y: 0 }, data: { label: 'L1' } };
    const e1: FlowEdge = { id: 'e1', source: 'lane-1', target: 'n1', label: '旧标签' };

    bridgeA.setDiagram([lane, n1], [e1]);
    bridgeA.patchNode('n1', { parentId: undefined, extent: undefined });
    bridgeA.patchEdge('e1', { label: undefined });

    const stateB = bridgeB.toReactFlowState();
    const syncedN1 = stateB.nodes.find((n) => n.id === 'n1')!;
    const syncedE1 = stateB.edges.find((e) => e.id === 'e1')!;
    expect(syncedN1.parentId).toBeUndefined();
    expect(syncedN1.extent).toBeUndefined();
    expect(syncedE1.label).toBeUndefined();
  });
});

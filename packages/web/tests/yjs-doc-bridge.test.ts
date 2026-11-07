import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { YjsDiagramBridge } from '../src/features/collaboration/yjs-doc-bridge';
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
});

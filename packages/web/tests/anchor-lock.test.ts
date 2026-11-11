import { describe, it, expect, beforeEach } from 'vitest';
import { useFlowStore } from '../src/stores/flow-store';
import { layoutDiagram } from '../src/features/canvas/layout/elk-layout';
import type { FlowNode, FlowEdge } from '@flowstudio/shared';

describe('Anchor Lock (事前防线：节点/泳道锚定锁)', () => {
  beforeEach(() => {
    useFlowStore.getState().unbindCollaboration();
    useFlowStore.getState().resetDiagramState();
  });

  it('cycles lockMode between none -> position -> full -> none on toggleSelectedLockMode', () => {
    const store = useFlowStore.getState();
    const node1 = store.addNode('process', { x: 100, y: 100 });

    useFlowStore.setState({ selectedNodeIds: [node1.id] });

    // 初始状态默认为 undefined 或 none
    expect(useFlowStore.getState().nodes[0].data?.lockMode ?? 'none').toBe('none');

    // 第一次触发：切换到 position 坐标锁
    useFlowStore.getState().toggleSelectedLockMode();
    expect(useFlowStore.getState().nodes[0].data?.lockMode).toBe('position');

    // 第二次触发：切换到 full 完全锁
    useFlowStore.getState().toggleSelectedLockMode();
    expect(useFlowStore.getState().nodes[0].data?.lockMode).toBe('full');

    // 第三次触发：解除锁定切回 none
    useFlowStore.getState().toggleSelectedLockMode();
    expect(useFlowStore.getState().nodes[0].data?.lockMode).toBe('none');
  });

  it('prevents deletion and label mutation on full locked nodes', () => {
    const store = useFlowStore.getState();
    const normalNode = store.addNode('process', { x: 50, y: 50 });
    const lockedNode = store.addNode('decision', { x: 200, y: 50 });

    // 将 lockedNode 设为 full 完全锁
    store.updateNodeData(lockedNode.id, { lockMode: 'full' });
    expect(useFlowStore.getState().nodes.find((n) => n.id === lockedNode.id)?.data?.lockMode).toBe('full');

    // 尝试修改文案：应被守卫拦截
    store.updateNodeData(lockedNode.id, { label: '非法改动文案' });
    expect(useFlowStore.getState().nodes.find((n) => n.id === lockedNode.id)?.data?.label).not.toBe('非法改动文案');

    // 选中两个节点执行批量删除：normalNode 应当被删，lockedNode 必须被安全保留
    useFlowStore.setState({ selectedNodeIds: [normalNode.id, lockedNode.id] });
    useFlowStore.getState().deleteSelected();

    const currentNodes = useFlowStore.getState().nodes;
    expect(currentNodes.length).toBe(1);
    expect(currentNodes[0].id).toBe(lockedNode.id);
  });

  it('preserves fixed coordinates during elkjs auto-layout for position & full locked nodes', async () => {
    const nodes: FlowNode[] = [
      {
        id: 'node-free-1',
        type: 'process',
        position: { x: 0, y: 0 },
        data: { label: '自由节点1', type: 'process' },
      },
      {
        id: 'node-locked-pos',
        type: 'decision',
        position: { x: 555, y: 777 }, // 特殊固定坐标
        data: { label: '坐标锁定节点', type: 'decision', lockMode: 'position' },
      },
      {
        id: 'node-free-2',
        type: 'process',
        position: { x: 0, y: 0 },
        data: { label: '自由节点2', type: 'process' },
      },
    ];

    const edges: FlowEdge[] = [
      { id: 'e1', source: 'node-free-1', target: 'node-locked-pos' },
      { id: 'e2', source: 'node-locked-pos', target: 'node-free-2' },
    ];

    const result = await layoutDiagram(nodes, edges, { direction: 'RIGHT' });
    const lockedResult = result.nodes.find((n) => n.id === 'node-locked-pos')!;

    // 验证坐标完全维持原位
    expect(lockedResult.position.x).toBe(555);
    expect(lockedResult.position.y).toBe(777);
  });
});

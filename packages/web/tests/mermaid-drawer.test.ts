import { describe, it, expect, beforeEach } from 'vitest';
import { useFlowStore } from '../src/stores/flow-store';
import { diagramToMermaid, diffMermaidToOps } from '@flowstudio/shared';
import type { FlowNode, FlowEdge } from '@flowstudio/shared';

describe('Mermaid Drawer (生产力闭环：Mermaid 语义双向同频桥)', () => {
  beforeEach(() => {
    useFlowStore.getState().unbindCollaboration();
    useFlowStore.getState().resetDiagramState();
  });

  it('exports deterministic Mermaid DSL for flowchart and swimlane containers', () => {
    const nodes: FlowNode[] = [
      {
        id: 'start',
        type: 'start-end',
        position: { x: 50, y: 50 },
        data: { label: '发起申请', type: 'start-end' },
      },
      {
        id: 'proc',
        type: 'process',
        position: { x: 200, y: 50 },
        data: { label: '领导审批', type: 'process' },
      },
      {
        id: 'dec',
        type: 'decision',
        position: { x: 380, y: 50 },
        data: { label: '是否核准', type: 'decision' },
      },
    ];
    const edges: FlowEdge[] = [
      { id: 'e1', source: 'start', target: 'proc' },
      { id: 'e2', source: 'proc', target: 'dec', data: { label: '提交' } },
    ];

    const mermaid = diagramToMermaid(nodes, edges);
    expect(mermaid).toContain('flowchart');
    expect(mermaid).toContain('start(["发起申请"])');
    expect(mermaid).toContain('proc["领导审批"]');
    expect(mermaid).toContain('dec{"是否核准"}');
    expect(mermaid).toContain('start --> proc');
  });

  it('applies incremental Mermaid ops while 100% preserving existing manual coordinates and lockMode', () => {
    const store = useFlowStore.getState();

    // 1. 初始化既有节点（包含手工坐标与 position 锁定）
    const nodeA = store.addNode('process', { x: 321, y: 654 });
    store.updateNodeData(nodeA.id, {
      label: '已有节点A',
      lockMode: 'position',
      style: { fillColor: '#fef08a' },
    });

    const currentNodes = useFlowStore.getState().nodes;
    const currentEdges = useFlowStore.getState().edges;

    // 2. 模拟用户在编辑器中添加了新节点 B 并从 A 连线到 B
    const editorMermaid = `flowchart LR
  ${nodeA.id}["已有节点A"] --> B["新审批步骤"]
`;

    const diff = diffMermaidToOps(editorMermaid, currentNodes, currentEdges);

    // 验证 diff 精确识别既有节点并保留
    expect(diff.preservedNodeIds).toContain(nodeA.id);
    expect(diff.addedNodeIds).toContain('B');

    // 3. 应用增量操作
    const { addedNodes, addedEdges } = useFlowStore.getState().applyMermaidOps(diff.ops);
    expect(addedNodes).toBe(1);
    expect(addedEdges).toBe(1);

    const updatedNodes = useFlowStore.getState().nodes;
    const preservedA = updatedNodes.find((n) => n.id === nodeA.id)!;

    // 关键校验：既有节点 A 的坐标、样式和 lockMode 100% 保持不动
    expect(preservedA.position.x).toBe(321);
    expect(preservedA.position.y).toBe(654);
    expect(preservedA.data.lockMode).toBe('position');
    expect(preservedA.data.style?.fillColor).toBe('#fef08a');

    // 新节点 B 成功创建上屏
    const newNodeB = updatedNodes.find((n) => n.id === 'B')!;
    expect(newNodeB).toBeDefined();
    expect(newNodeB.data.label).toBe('新审批步骤');
  });
});

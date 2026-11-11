import { describe, it, expect } from 'vitest';
import {
  diagramToMermaid,
  diffMermaidToOps,
  parseMermaid,
  type FlowEdge,
  type FlowNode,
  type FlowNodeType,
} from '../src/index.js';

function makeNode(
  id: string,
  type: FlowNodeType,
  label: string,
  extra: Partial<FlowNode> = {},
): FlowNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { label, type },
    ...extra,
  };
}

function makeEdge(id: string, source: string, target: string, label?: string): FlowEdge {
  return { id, source, target, data: { label } };
}

describe('Mermaid 双向语义桥', () => {
  it('确定性地导出 9 种流程节点与泳道 subgraph 结构', () => {
    const pool = makeNode('pool-1', 'pool', '业务泳道池', {
      data: {
        label: '业务泳道池',
        type: 'pool',
        orientation: 'horizontal',
        laneOrder: ['lane-b', 'lane-a'],
      },
    });
    const laneA = makeNode('lane-a', 'lane', '前端组', {
      parentId: 'pool-1',
      data: { label: '前端组', type: 'lane', laneTitle: '前端组' },
    });
    const laneB = makeNode('lane-b', 'lane', '后端组', {
      parentId: 'pool-1',
      data: { label: '后端组', type: 'lane', laneTitle: '后端组' },
    });

    const types: FlowNodeType[] = [
      'start-end',
      'process',
      'decision',
      'io',
      'document',
      'subprocess',
      'database',
      'comment',
      'group',
    ];
    const nodes = [
      pool,
      laneA,
      laneB,
      ...types.map((type, idx) =>
        makeNode(`n-${idx}`, type, `节点${idx}`, {
          parentId: idx % 2 === 0 ? 'lane-a' : 'lane-b',
        }),
      ),
    ];
    const edges = types.slice(1).map((_, idx) => makeEdge(`e-${idx}`, `n-${idx}`, `n-${idx + 1}`));

    const first = diagramToMermaid(nodes, edges);
    const second = diagramToMermaid([...nodes].reverse(), [...edges].reverse());

    // 输入顺序打乱后输出仍完全一致
    expect(second).toBe(first);

    // 泳道池与泳道按 laneOrder 输出为嵌套 subgraph
    expect(first.startsWith('flowchart LR')).toBe(true);
    expect(first).toContain('subgraph pool-1["业务泳道池"]');
    expect(first.indexOf('subgraph lane-b["后端组"]')).toBeLessThan(
      first.indexOf('subgraph lane-a["前端组"]'),
    );

    // 9 种形状语法全部出现
    expect(first).toContain('n-0(["节点0"])');
    expect(first).toContain('n-1["节点1"]');
    expect(first).toContain('n-2{"节点2"}');
    expect(first).toContain('n-3[/节点3/]');
    expect(first).toContain('n-4[\\节点4\\]');
    expect(first).toContain('n-5[["节点5"]]');
    expect(first).toContain('n-6[("节点6")]');
    expect(first).toContain('n-7{{"节点7"}}');
    expect(first).toContain('n-8("节点8")');
  });

  it('解析 Mermaid 时还原节点类型、泳道归属与连线标签', () => {
    const text = [
      'flowchart TB',
      '  subgraph lane-1["风控组"]',
      '    A(["开始"])',
      '    B{是否通过}',
      '  end',
      '  B -->|拒绝| C[(黑名单库)]',
      '  A --> B',
    ].join('\n');

    const parsed = parseMermaid(text);
    expect(parsed.lanes).toEqual([{ id: 'lane-1', label: '风控组' }]);

    const typeMap = new Map(parsed.nodes.map((n) => [n.id, n]));
    expect(typeMap.get('A')?.type).toBe('start-end');
    expect(typeMap.get('B')?.type).toBe('decision');
    expect(typeMap.get('C')?.type).toBe('database');
    expect(typeMap.get('A')?.laneId).toBe('lane-1');

    expect(parsed.edges).toContainEqual({ sourceId: 'B', targetId: 'C', label: '拒绝' });
    expect(parsed.edges).toContainEqual({ sourceId: 'A', targetId: 'B', label: undefined });
  });

  it('增量融合命中既有节点时 100% 保留坐标、样式与 lockMode', () => {
    const existingNodes: FlowNode[] = [
      makeNode('n-1', 'process', '审批', {
        position: { x: 320, y: 180 },
        data: {
          label: '审批',
          type: 'process',
          lockMode: 'position',
          style: { fillColor: '#EEF2FF' },
        },
      }),
      makeNode('n-2', 'decision', '是否通过', {
        position: { x: 600, y: 180 },
      }),
    ];
    const existingEdges: FlowEdge[] = [makeEdge('e-1', 'n-1', 'n-2', '提交')];

    const text = [
      'flowchart LR',
      '  n-1["审批"] -->|提交| n-2{"是否通过"}',
      '  n-2 --> n-3["新增归档"]',
    ].join('\n');

    const result = diffMermaidToOps(text, existingNodes, existingEdges);

    // 既有节点全部保留，且绝不产生坐标/样式/lockMode 相关操作
    expect(result.preservedNodeIds).toEqual(['n-1', 'n-2']);
    expect(result.updatedNodeIds).toEqual([]);
    expect(result.ops.every((op) => op.op !== 'update_node')).toBe(true);
    expect(result.ops.every((op) => op.op !== 'move_node')).toBe(true);

    // 新节点与新增连线按增量操作产出
    expect(result.addedNodeIds).toEqual(['n-3']);
    expect(result.ops).toContainEqual({
      op: 'add_node',
      id: 'n-3',
      type: 'process',
      label: '新增归档',
    });
    expect(result.ops).toContainEqual({ op: 'connect', source: 'n-2', target: 'n-3' });
    expect(result.addedEdgeIds).toContain('n-2->n-3');

    // 既有连线未被误删
    expect(result.removedEdgeIds).toEqual([]);
  });

  it('按 Label 匹配既有节点，避免重生成时重复建点', () => {
    const existingNodes: FlowNode[] = [
      makeNode('node-approve', 'process', '人工审批', {
        position: { x: 120, y: 90 },
      }),
    ];

    const text = [
      'flowchart LR',
      '  tmp_1["人工审批"] --> tmp_2["自动放款"]',
    ].join('\n');

    const result = diffMermaidToOps(text, existingNodes, []);

    expect(result.preservedNodeIds).toEqual(['node-approve']);
    expect(result.addedNodeIds).toEqual(['tmp_2']);
    expect(result.ops).toContainEqual({
      op: 'add_node',
      id: 'tmp_2',
      type: 'process',
      label: '自动放款',
    });
    expect(result.ops).toContainEqual({
      op: 'connect',
      source: 'node-approve',
      target: 'tmp_2',
    });
  });

  it('仅删除两端仍存在的丢失连线，缺失节点非破坏性保留', () => {
    const existingNodes: FlowNode[] = [
      makeNode('a', 'process', 'A'),
      makeNode('b', 'process', 'B'),
      makeNode('c', 'process', 'C'),
    ];
    const existingEdges: FlowEdge[] = [
      makeEdge('e-ab', 'a', 'b'),
      makeEdge('e-bc', 'b', 'c'),
    ];

    // Mermaid 中仅保留 A、B，且 A、B 之间仍有连线
    const text = ['flowchart LR', '  a["A"] --> b["B"]'].join('\n');
    const result = diffMermaidToOps(text, existingNodes, existingEdges);

    // C 在 Mermaid 中缺失，但画布不主动删除，仅记录 missing
    expect(result.missingNodeIds).toEqual(['c']);
    expect(result.preservedNodeIds).toEqual(['a', 'b']);

    // e-ab 仍存在不删除；e-bc 因 c 缺失无法判定为真实删除 → 不删除
    expect(result.removedEdgeIds).toEqual([]);
    expect(result.ops.every((op) => op.op !== 'disconnect')).toBe(true);

    // 当文本明确移除两端均存在的连线时才产出 disconnect
    const text2 = ['flowchart LR', '  a["A"]', '  b["B"]'].join('\n');
    const result2 = diffMermaidToOps(text2, existingNodes, existingEdges);
    expect(result2.removedEdgeIds).toEqual(['e-ab']);
    expect(result2.ops).toContainEqual({ op: 'disconnect', edgeId: 'e-ab' });
  });

  it('含泳道池往返同步不产生幻影 add_lane，laneOrder 不被污染且幂等', () => {
    const pool = makeNode('pool-1', 'pool', '业务泳道池', {
      data: {
        label: '业务泳道池',
        type: 'pool',
        orientation: 'horizontal',
        laneOrder: ['lane-a', 'lane-b'],
      },
    });
    const laneA = makeNode('lane-a', 'lane', '前端组', {
      parentId: 'pool-1',
      data: { label: '前端组', type: 'lane', laneTitle: '前端组' },
    });
    const laneB = makeNode('lane-b', 'lane', '后端组', {
      parentId: 'pool-1',
      data: { label: '后端组', type: 'lane', laneTitle: '后端组' },
    });
    const n1 = makeNode('n-1', 'start-end', '开始', { parentId: 'lane-a' });
    const n2 = makeNode('n-2', 'process', '处理', { parentId: 'lane-b' });
    const nodes = [pool, laneA, laneB, n1, n2];
    const edges = [makeEdge('e-1', 'n-1', 'n-2')];

    const text = diagramToMermaid(nodes, edges);
    const diff = diffMermaidToOps(text, nodes, edges);
    expect(diff.ops).toEqual([]);
    expect(diff.addedLaneIds).toEqual([]);
    expect(diff.addedNodeIds).toEqual([]);

    const n3 = makeNode('n-3', 'process', '新增步骤', { parentId: 'lane-a' });
    const text2 = diagramToMermaid([...nodes, n3], edges);
    const diff2 = diffMermaidToOps(text2, nodes, edges);
    expect(diff2.addedLaneIds).toEqual([]);
    expect(diff2.ops.some((op) => op.op === 'add_lane')).toBe(false);
    expect(diff2.addedNodeIds).toEqual(['n-3']);
  });

  it('新增泳道产出 add_lane，并将新节点挂载到对应泳道', () => {
    const text = [
      'flowchart LR',
      '  subgraph lane-new["新泳道"]',
      '    x1["步骤一"]',
      '  end',
    ].join('\n');

    const result = diffMermaidToOps(text, [], []);

    expect(result.addedLaneIds).toEqual(['lane-new']);
    expect(result.ops).toContainEqual({ op: 'add_lane', id: 'lane-new', label: '新泳道' });
    expect(result.ops).toContainEqual({
      op: 'add_node',
      id: 'x1',
      type: 'process',
      label: '步骤一',
      laneId: 'lane-new',
    });
  });
});

import { describe, it, expect } from 'vitest';
import { compareSnapshots, type FlowNode, type FlowEdge } from '../src/index.js';

describe('快照版本 Visual Diff 计算引擎', () => {
  it('正确识别节点的相对新增、相对删除与多维度属性修改', () => {
    const baseNodes: FlowNode[] = [
      {
        id: 'node-stay',
        type: 'start-end',
        position: { x: 100, y: 100 },
        width: 120,
        height: 60,
        data: { label: '发起申请', type: 'start-end' },
      },
      {
        id: 'node-modify',
        type: 'process',
        position: { x: 300, y: 100 },
        width: 140,
        height: 60,
        data: { label: '人工初审', type: 'process' },
      },
      {
        id: 'node-delete',
        type: 'decision',
        position: { x: 500, y: 100 },
        width: 100,
        height: 80,
        data: { label: '是否合格', type: 'decision' },
      },
    ];

    const targetNodes: FlowNode[] = [
      {
        id: 'node-stay',
        type: 'start-end',
        position: { x: 100, y: 100 },
        width: 120,
        height: 60,
        data: { label: '发起申请', type: 'start-end' },
      },
      {
        id: 'node-modify',
        type: 'process',
        position: { x: 320, y: 120 },
        width: 160,
        height: 80,
        data: { label: '智能风控审核', type: 'process' },
      },
      {
        id: 'node-add',
        type: 'database',
        position: { x: 700, y: 100 },
        width: 100,
        height: 80,
        data: { label: '结果存档', type: 'database' },
      },
    ];

    const res = compareSnapshots(baseNodes, [], targetNodes, [], '快照 v1', '快照 v2');

    expect(res.summary.addedCount).toBe(1);
    expect(res.summary.updatedCount).toBe(1);
    expect(res.summary.deletedCount).toBe(1);
    expect(res.summary.totalChanges).toBe(3);

    const addedItem = res.items.find((i) => i.id === 'node-add');
    expect(addedItem?.opType).toBe('add');
    expect(addedItem?.label).toBe('结果存档');

    const updatedItem = res.items.find((i) => i.id === 'node-modify');
    expect(updatedItem?.opType).toBe('update');
    expect(updatedItem?.changes).toContain('文案由「人工初审」变更为「智能风控审核」');
    expect(updatedItem?.changes).toContain('坐标偏移 (20, 20)');
    expect(updatedItem?.changes).toContain('尺寸调整');

    const deletedItem = res.items.find((i) => i.id === 'node-delete');
    expect(deletedItem?.opType).toBe('delete');
    expect(deletedItem?.label).toBe('是否合格');
  });

  it('正确识别连线的相对新增、相对删除与端点关系变更', () => {
    const baseEdges: FlowEdge[] = [
      {
        id: 'e-1',
        source: 'node-1',
        target: 'node-2',
        type: 'orthogonal',
        data: { label: '流转中' },
      },
      {
        id: 'e-2',
        source: 'node-2',
        target: 'node-3',
        type: 'orthogonal',
        data: { label: '废弃线' },
      },
    ];

    const targetEdges: FlowEdge[] = [
      {
        id: 'e-1',
        source: 'node-1',
        target: 'node-4',
        type: 'orthogonal',
        data: { label: '重定向流转' },
      },
      {
        id: 'e-3',
        source: 'node-4',
        target: 'node-5',
        type: 'orthogonal',
        data: { label: '新连线' },
      },
    ];

    const res = compareSnapshots([], baseEdges, [], targetEdges);

    expect(res.summary.addedCount).toBe(1);
    expect(res.summary.updatedCount).toBe(1);
    expect(res.summary.deletedCount).toBe(1);

    const addEdge = res.items.find((i) => i.id === 'e-3');
    expect(addEdge?.opType).toBe('add');

    const updEdge = res.items.find((i) => i.id === 'e-1');
    expect(updEdge?.opType).toBe('update');
    expect(updEdge?.changes).toContain('关系标签由「流转中」变更为「重定向流转」');
    expect(updEdge?.changes).toContain('连接端点重定向');

    const delEdge = res.items.find((i) => i.id === 'e-2');
    expect(delEdge?.opType).toBe('delete');
  });

  it('图表无差异时返回空列表与零计数', () => {
    const nodes: FlowNode[] = [
      { id: 'n-1', type: 'start-end', position: { x: 0, y: 0 }, data: { label: '开始', type: 'start-end' } },
    ];
    const edges: FlowEdge[] = [
      { id: 'e-1', source: 'n-1', target: 'n-1', type: 'orthogonal' },
    ];
    const res = compareSnapshots(nodes, edges, nodes, edges);
    expect(res.items.length).toBe(0);
    expect(res.summary.totalChanges).toBe(0);
  });
});

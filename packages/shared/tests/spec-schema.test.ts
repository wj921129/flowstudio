import { describe, it, expect } from 'vitest';
import { normalizeSpec, SpecError } from '../src/spec/normalize.js';
import type { DiagramSpec } from '../src/spec/types.js';
import { diagramSpecSchema } from '../src/spec/spec-schema.js';

const retry: DiagramSpec = {
  paradigm: 'vertical-flow',
  nodes: [
    { id: 'm1', label: '执行核心远程调用' },
    { id: 'd1', label: '调用成功？', type: 'decision' },
    { id: 'd2', label: '重试 < 3次？', type: 'decision' },
    { id: 'alarm', label: '熔断降级与报警通知' },
    { id: 'end', label: '任务成功提交', type: 'start-end' },
  ],
  edges: [
    { from: 'm1', to: 'd1' },
    { from: 'd1', to: 'end', label: '是' },
    { from: 'd1', to: 'd2', kind: 'branch', label: '否' },
    { from: 'd2', to: 'm1', kind: 'loop', label: '指数退避' },
    { from: 'd2', to: 'alarm', label: '超限' },
  ],
};

describe('DiagramSpec 语义校验与推断', () => {
  it('attachTo 推断为 annotation 并补全 annotate 边', () => {
    const n = normalizeSpec({
      paradigm: 'vertical-flow',
      nodes: [{ id: 'a', label: 'A' }, { id: 'n', label: 'N', attachTo: 'a' }],
      edges: [],
    });
    expect(n.nodes.find((x) => x.id === 'n')!.role).toBe('annotation');
    expect(n.edges).toContainEqual({ from: 'a', to: 'n', kind: 'annotate' });
    expect(n.mainOrder).toEqual(['a']);
  });

  it('annotate 边反向补全 attachTo', () => {
    const n = normalizeSpec({
      paradigm: 'vertical-flow',
      nodes: [{ id: 'a', label: 'A' }, { id: 'n', label: 'N' }],
      edges: [{ from: 'a', to: 'n', kind: 'annotate' }],
    });
    expect(n.nodes.find((x) => x.id === 'n')!.attachTo).toBe('a');
  });

  it('branch 边推断 role 且基准回环 branch→main 合法', () => {
    const n = normalizeSpec(retry);
    expect(n.nodes.find((x) => x.id === 'd2')!.role).toBe('branch');
    expect(n.nodes.find((x) => x.id === 'alarm')!.role).toBe('branch');
    expect(n.mainOrder).toEqual(['m1', 'd1', 'end']);
    expect(n.edges.find((e) => e.kind === 'loop')).toBeTruthy();
  });

  it('mainOrder 保持 nodes 出现序', () => {
    const n = normalizeSpec({
      paradigm: 'vertical-flow',
      nodes: [{ id: 'z', label: 'Z' }, { id: 'a', label: 'A' }],
      edges: [{ from: 'z', to: 'a' }],
    });
    expect(n.mainOrder).toEqual(['z', 'a']);
  });

  it('重复 id 报 SpecError', () => {
    expect(() => normalizeSpec({
      paradigm: 'vertical-flow',
      nodes: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }],
      edges: [],
    })).toThrow(SpecError);
  });

  it('悬空边端点报 SpecError', () => {
    expect(() => normalizeSpec({
      paradigm: 'vertical-flow',
      nodes: [{ id: 'a', label: 'A' }],
      edges: [{ from: 'a', to: 'ghost' }],
    })).toThrow(SpecError);
  });

  it('jump 边跨段旁路不污染主干角色', () => {
    const n = normalizeSpec({
      paradigm: 'vertical-flow',
      nodes: [
        { id: 'd1', label: '命中？', type: 'decision' },
        { id: 'p1', label: '中段处理' },
        { id: 'd2', label: '下游判定', type: 'decision' },
        { id: 'end', label: '结束', type: 'start-end' },
      ],
      edges: [
        { from: 'd1', to: 'p1', label: '是' },
        { from: 'p1', to: 'd2' },
        { from: 'd1', to: 'd2', kind: 'jump', label: '否' },
        { from: 'd2', to: 'end' },
      ],
    });
    expect(n.nodes.every((x) => x.role === 'main')).toBe(true);
    expect(n.mainOrder).toEqual(['d1', 'p1', 'd2', 'end']);
    expect(n.nodes.find((x) => x.id === 'd2')!.role).toBe('main');
  });

  it('jump 边端点非主干或指向更早节点报 SpecError', () => {
    expect(() => normalizeSpec({
      paradigm: 'vertical-flow',
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a', kind: 'jump' }],
    })).toThrow(SpecError);
    expect(() => normalizeSpec({
      paradigm: 'vertical-flow',
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      edges: [{ from: 'a', to: 'b', kind: 'branch' }, { from: 'a', to: 'b', kind: 'jump' }],
    })).toThrow(SpecError);
  });

  it('loop 指向拓扑序更晚的节点报 SpecError', () => {
    expect(() => normalizeSpec({
      paradigm: 'vertical-flow',
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'b', kind: 'loop' }],
    })).toThrow(SpecError);
  });

  it('显式 role 与推断冲突报 SpecError', () => {
    expect(() => normalizeSpec({
      paradigm: 'vertical-flow',
      nodes: [{ id: 'a', label: 'A' }, { id: 'n', label: 'N', role: 'main', attachTo: 'a' }],
      edges: [],
    })).toThrow(SpecError);
  });

  it('attachTo 与 annotate 边宿主不一致报 SpecError', () => {
    expect(() => normalizeSpec({
      paradigm: 'vertical-flow',
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'n', label: 'N', attachTo: 'a' }],
      edges: [{ from: 'b', to: 'n', kind: 'annotate' }],
    })).toThrow(SpecError);
  });

  it('swimlane 主节点缺 laneId 报 SpecError', () => {
    expect(() => normalizeSpec({
      paradigm: 'swimlane',
      lanes: [{ id: 'l1', label: 'L1' }],
      nodes: [{ id: 'a', label: 'A' }],
      edges: [],
    })).toThrow(SpecError);
  });

  it('swimlane 附注 laneId 继承宿主', () => {
    const n = normalizeSpec({
      paradigm: 'swimlane',
      lanes: [{ id: 'l1', label: 'L1' }, { id: 'l2', label: 'L2' }],
      nodes: [{ id: 'a', label: 'A', laneId: 'l1' }, { id: 'n', label: 'N', attachTo: 'a' }],
      edges: [],
    });
    expect(n.nodes.find((x) => x.id === 'n')!.laneId).toBe('l1');
  });

  it('swimlane 缺 lanes 报 SpecError', () => {
    expect(() => normalizeSpec({ paradigm: 'swimlane', nodes: [{ id: 'a', label: 'A', laneId: 'l1' }], edges: [] })).toThrow(SpecError);
  });

  it('tiered-dag 存在环报 SpecError', () => {
    expect(() => normalizeSpec({
      paradigm: 'tiered-dag',
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }],
    })).toThrow(SpecError);
  });

  it('tiered-dag 出现附注报 SpecError', () => {
    expect(() => normalizeSpec({
      paradigm: 'tiered-dag',
      nodes: [{ id: 'a', label: 'A' }, { id: 'n', label: 'N', attachTo: 'a' }],
      edges: [],
    })).toThrow(SpecError);
  });

  it('tree 范式必须含 tree 边', () => {
    expect(() => normalizeSpec({
      paradigm: 'tree',
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      edges: [{ from: 'a', to: 'b' }],
    })).toThrow(SpecError);
    const n = normalizeSpec({
      paradigm: 'tree',
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      edges: [{ from: 'a', to: 'b', kind: 'tree' }],
    });
    expect(n.edges[0].kind).toBe('tree');
  });

  it('非 tree 范式出现 tree 边记 warning 并忽略', () => {
    const n = normalizeSpec({
      paradigm: 'vertical-flow',
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'b', kind: 'tree' }],
    });
    expect(n.warnings.length).toBeGreaterThan(0);
    expect(n.edges.some((e) => e.kind === 'tree')).toBe(false);
  });

  it('空 spec 合法且 mainOrder 为空', () => {
    const n = normalizeSpec({ paradigm: 'vertical-flow', nodes: [], edges: [] });
    expect(n.mainOrder).toEqual([]);
    expect(n.nodes).toEqual([]);
  });

  it('swimlane 跨泳道 branch 边报 SpecError（不静默丢节点）', () => {
    expect(() => normalizeSpec({
      paradigm: 'swimlane',
      lanes: [{ id: 'l1', label: 'L1' }, { id: 'l2', label: 'L2' }],
      nodes: [{ id: 'a', label: 'A', laneId: 'l1' }, { id: 'b', label: 'B', laneId: 'l2' }],
      edges: [{ from: 'a', to: 'b', kind: 'branch' }],
    })).toThrow(SpecError);
  });

  it('tree 范式环/自环/多父报 SpecError', () => {
    const base = { paradigm: 'tree' as const, nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] };
    expect(() => normalizeSpec({ ...base, edges: [{ from: 'a', to: 'b', kind: 'tree' }, { from: 'b', to: 'a', kind: 'tree' }] })).toThrow(SpecError);
    expect(() => normalizeSpec({ ...base, edges: [{ from: 'a', to: 'a', kind: 'tree' }] })).toThrow(SpecError);
    expect(() => normalizeSpec({
      paradigm: 'tree',
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
      edges: [{ from: 'a', to: 'c', kind: 'tree' }, { from: 'b', to: 'c', kind: 'tree' }],
    })).toThrow(SpecError);
  });

  it('zod schema 拒绝非法 paradigm 与空 label', () => {
    expect(diagramSpecSchema.safeParse({ paradigm: 'nope', nodes: [], edges: [] }).success).toBe(false);
    expect(diagramSpecSchema.safeParse({ paradigm: 'vertical-flow', nodes: [{ id: 'a', label: '' }], edges: [] }).success).toBe(false);
  });

  it('spec 节点不允许 pool/lane 类型', () => {
    expect(diagramSpecSchema.safeParse({
      paradigm: 'vertical-flow',
      nodes: [{ id: 'p', label: 'P', type: 'pool' }],
      edges: [],
    }).success).toBe(false);
  });
});
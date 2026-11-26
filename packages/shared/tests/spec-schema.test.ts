import { describe, it, expect } from 'vitest';
import { normalizeSpec, SpecError } from '../src/spec/normalize.js';
import type { DiagramSpec } from '../src/spec/types.js';
import { diagramSpecSchema } from '../src/spec/spec-schema.js';
import { buildYeepaySpec } from './helpers/render-asserts.js';

const retry: DiagramSpec = {
  paradigm: 'circuit-flow',
  nodes: [
    { id: 'm1', label: '执行核心远程调用' },
    { id: 'd1', label: '调用成功？', type: 'decision' },
    { id: 'd2', label: '重试 < 3次？', type: 'decision' },
    { id: 'alarm', label: '熔断降级与报警通知', earlyExit: true },
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
      paradigm: 'circuit-flow',
      nodes: [{ id: 'a', label: 'A' }, { id: 'n', label: 'N', attachTo: 'a' }],
      edges: [],
    });
    expect(n.nodes.find((x) => x.id === 'n')!.role).toBe('annotation');
    expect(n.edges).toContainEqual({ from: 'a', to: 'n', kind: 'annotate' });
    expect(n.mainOrder).toEqual(['a']);
  });

  it('annotate 边反向补全 attachTo', () => {
    const n = normalizeSpec({
      paradigm: 'circuit-flow',
      nodes: [{ id: 'a', label: 'A' }, { id: 'n', label: 'N' }],
      edges: [{ from: 'a', to: 'n', kind: 'annotate' }],
    });
    expect(n.nodes.find((x) => x.id === 'n')!.attachTo).toBe('a');
  });

  it('circuit-flow 按拓扑序产出 mainOrder，不受 nodes 声明序和 branch 吞干影响', () => {
    const n = normalizeSpec({
      paradigm: 'circuit-flow',
      nodes: [
        { id: 'end', label: '结束', type: 'start-end' },
        { id: 'b2', label: '支路2' },
        { id: 'b1', label: '支路1' },
        { id: 'start', label: '入口', type: 'start-end' },
      ],
      edges: [
        { from: 'start', to: 'b1', kind: 'branch' },
        { from: 'start', to: 'b2', kind: 'branch' },
        { from: 'b1', to: 'end' },
        { from: 'b2', to: 'end' },
      ],
    });
    expect(n.mainOrder[0]).toBe('start');
    expect(n.mainOrder[n.mainOrder.length - 1]).toBe('end');
    expect(n.nodes.find((x) => x.id === 'end')!.role).toBe('main');
    expect(() => normalizeSpec(retry)).not.toThrow();
  });

  it('重复 id 与悬空边端点报 SpecError', () => {
    expect(() => normalizeSpec({
      paradigm: 'circuit-flow',
      nodes: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }],
      edges: [],
    })).toThrow(SpecError);
    expect(() => normalizeSpec({
      paradigm: 'circuit-flow',
      nodes: [{ id: 'a', label: 'A' }],
      edges: [{ from: 'a', to: 'ghost' }],
    })).toThrow(SpecError);
  });

  it('circuit-flow 支持跨段 jump 与任意位置回环 loop', () => {
    const n = normalizeSpec(buildYeepaySpec());
    expect(n.nodes.filter((x) => x.role === 'annotation').length).toBe(9);
    expect(n.edges.filter((e) => e.kind === 'jump').map((e) => `${e.from}->${e.to}`).sort()).toEqual(['d4->d8', 'd9->d11']);
  });

  it('attachTo 与 annotate 边宿主不一致报 SpecError', () => {
    expect(() => normalizeSpec({
      paradigm: 'circuit-flow',
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'n', label: 'N', attachTo: 'a' }],
      edges: [{ from: 'b', to: 'n', kind: 'annotate' }],
    })).toThrow(SpecError);
  });

  it('swimlane 主节点缺 laneId 报 SpecError 且附注继承宿主 laneId', () => {
    expect(() => normalizeSpec({
      paradigm: 'swimlane',
      lanes: [{ id: 'l1', label: 'L1' }],
      nodes: [{ id: 'a', label: 'A' }],
      edges: [],
    })).toThrow(SpecError);
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

  it('tiered-dag 存在环或附注报 SpecError', () => {
    expect(() => normalizeSpec({
      paradigm: 'tiered-dag',
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }],
    })).toThrow(SpecError);
    expect(() => normalizeSpec({
      paradigm: 'tiered-dag',
      nodes: [{ id: 'a', label: 'A' }, { id: 'n', label: 'N', attachTo: 'a' }],
      edges: [],
    })).toThrow(SpecError);
  });

  it('tree 范式兼容多边类型并允许非自环回边', () => {
    const n1 = normalizeSpec({
      paradigm: 'tree',
      edgeRouting: 'straight',
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C', attachTo: 'b' }],
      edges: [{ from: 'a', to: 'b', kind: 'branch', routingType: 'orthogonal' }],
    });
    expect(n1.edgeRouting).toBe('straight');
    expect(n1.edges.some((e) => e.kind === 'branch' && e.routingType === 'orthogonal')).toBe(true);
    expect(n1.nodes.find((x) => x.id === 'c')!.role).toBe('annotation');
    expect(() => normalizeSpec({
      paradigm: 'tree',
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      edges: [{ from: 'a', to: 'a', kind: 'tree' }],
    })).toThrow(SpecError);
    expect(() => normalizeSpec({
      paradigm: 'tree',
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }],
    })).not.toThrow();
  });

  it('非 tree 范式出现 tree 边记 warning 并忽略', () => {
    const n = normalizeSpec({
      paradigm: 'circuit-flow',
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'b', kind: 'tree' }],
    });
    expect(n.warnings.length).toBeGreaterThan(0);
    expect(n.edges.some((e) => e.kind === 'tree')).toBe(false);
  });

  it('swimlane 支持跨泳道 branch 边且支持 orientation', () => {
    const n = normalizeSpec({
      paradigm: 'swimlane',
      orientation: 'vertical',
      lanes: [{ id: 'l1', label: 'L1' }, { id: 'l2', label: 'L2' }],
      nodes: [{ id: 'a', label: 'A', laneId: 'l1' }, { id: 'b', label: 'B', laneId: 'l2' }],
      edges: [{ from: 'a', to: 'b', kind: 'branch' }],
    });
    expect(n.orientation).toBe('vertical');
    expect(n.edges[0].kind).toBe('branch');
  });

  it('zod schema 拒绝非法 paradigm、空 label 与 pool/lane 节点', () => {
    expect(diagramSpecSchema.safeParse({ paradigm: 'nope', nodes: [], edges: [] }).success).toBe(false);
    expect(diagramSpecSchema.safeParse({ paradigm: 'circuit-flow', nodes: [{ id: 'a', label: '' }], edges: [] }).success).toBe(false);
    expect(diagramSpecSchema.safeParse({ paradigm: 'circuit-flow', nodes: [{ id: 'p', label: 'P', type: 'pool' }], edges: [] }).success).toBe(false);
  });
});

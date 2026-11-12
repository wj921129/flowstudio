import { describe, it, expect } from 'vitest';
import { normalizeSpec } from '../src/spec/normalize.js';
import type { DiagramSpec } from '../src/spec/types.js';
import { renderSwimlane } from '../src/render/swimlane.js';
import type { RenderContext } from '../src/render/types.js';
import { noOverlap, byId, laneContainsAllChildren, annotationLaneIdInherited } from './helpers/render-asserts.js';

const crossDeptSpec: DiagramSpec = {
  paradigm: 'swimlane',
  lanes: [{ id: 'lane-biz', label: '业务' }, { id: 'lane-tech', label: '技术' }, { id: 'lane-ops', label: '运营' }],
  nodes: [
    { id: 'n1', label: '提出需求', laneId: 'lane-biz' },
    { id: 'n2', label: '评估实现', laneId: 'lane-tech' },
    { id: 'n3', label: '部署上线', laneId: 'lane-ops' },
    { id: 'n4', label: '验收', laneId: 'lane-biz' },
    { id: 'a1', label: '附注说明', attachTo: 'n2' },
  ],
  edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n3', to: 'n4' }],
};

const ctx: RenderContext = { idPrefix: '', origin: { x: 50, y: 50 }, fixed: new Map() };

describe('swimlane 几何约定', () => {
  it('业务节点与附注挂 lane 而非 pool，且 extent=parent', () => {
    const r = renderSwimlane(normalizeSpec(crossDeptSpec), ctx);
    const biz = r.nodes.filter((n) => !['pool', 'lane'].includes(n.type));
    expect(biz.every((n) => n.parentId!.startsWith('lane'))).toBe(true);
    expect(biz.every((n) => n.extent === 'parent')).toBe(true);
    expect(annotationLaneIdInherited(r)).toBe(true);
  });

  it('pool 持有 laneOrder 且 lane 自上而下堆叠', () => {
    const r = renderSwimlane(normalizeSpec(crossDeptSpec), ctx);
    const pool = r.nodes.find((n) => n.type === 'pool')!;
    expect(pool.data!.laneOrder).toEqual(['lane-biz', 'lane-tech', 'lane-ops']);
    const lanes = r.nodes.filter((n) => n.type === 'lane');
    expect(lanes.every((l) => l.parentId === pool.id && l.extent === 'parent')).toBe(true);
    expect(lanes[0].position).toEqual({ x: 0, y: 40 });
    expect(lanes[1].position.y).toBe(40 + lanes[0].height!);
    expect(lanes[2].position.y).toBe(40 + lanes[0].height! + lanes[1].height!);
    expect(pool.height).toBe(40 + lanes.reduce((acc, l) => acc + l.height!, 0));
    expect(pool.width).toBe(Math.max(...lanes.map((l) => l.width!)));
  });

  it('lane 尺寸容纳全部子节点且不小于下限', () => {
    const r = renderSwimlane(normalizeSpec(crossDeptSpec), ctx);
    expect(laneContainsAllChildren(r)).toBe(true);
    const lanes = r.nodes.filter((n) => n.type === 'lane');
    expect(lanes.every((l) => l.width! >= 800 && l.height! >= 200)).toBe(true);
  });

  it('泳道内主干恒距且跨 lane 边显式连接桩', () => {
    const r = renderSwimlane(normalizeSpec(crossDeptSpec), ctx);
    const n1 = byId(r, 'n1');
    const n4 = byId(r, 'n4');
    expect(n4.position.y - (n1.position.y + n1.height!)).toBe(50);
    expect(n1.position.x).toBe(n4.position.x);
    expect(r.edges.every((e) => e.sourceHandle && e.targetHandle)).toBe(true);
    const cross = r.edges.find((e) => e.source === 'n1' && e.target === 'n2')!;
    expect(cross.sourceHandle).toBe('bottom');
    expect(cross.targetHandle).toBe('top');
  });

  it('子节点为泳道局部坐标且全图无重叠', () => {
    const r = renderSwimlane(normalizeSpec(crossDeptSpec), ctx);
    const n2 = byId(r, 'n2');
    expect(n2.position.y).toBeLessThan(200);
    const world = r.nodes.map((n) => {
      const lane = r.nodes.find((l) => l.id === n.parentId && l.type === 'lane');
      return lane ? { ...n, position: { x: n.position.x + lane.position.x, y: n.position.y + lane.position.y } } : n;
    });
    expect(noOverlap(world.filter((n) => !['pool', 'lane'].includes(n.type)))).toBe(true);
  });
});
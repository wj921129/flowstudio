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

const horizontalSpec: DiagramSpec = {
  paradigm: 'swimlane',
  lanes: [
    { id: 'lane-db', label: '数据库交互' },
    { id: 'lane-main', label: '主流程' },
    { id: 'lane-ext', label: '外部服务' },
  ],
  nodes: [
    { id: 'm1', label: '开始', laneId: 'lane-main', type: 'start-end' },
    { id: 'm2', label: '处理', laneId: 'lane-main' },
    { id: 'm3', label: '校验', laneId: 'lane-main', type: 'decision' },
    { id: 'b1', label: '失败告警', laneId: 'lane-main' },
    { id: 'm4', label: '完成', laneId: 'lane-main', type: 'start-end' },
    { id: 'd1', label: '订单表', laneId: 'lane-db', type: 'database', attachTo: 'm2' },
    { id: 'd2', label: '动账表', laneId: 'lane-db', type: 'database', attachTo: 'm2' },
    { id: 'e1', label: '账务服务', laneId: 'lane-ext', type: 'arch-microservice', attachTo: 'm3' },
  ],
  edges: [
    { from: 'm1', to: 'm2' },
    { from: 'm2', to: 'm3' },
    { from: 'm3', to: 'm4', label: '通过' },
    { from: 'm3', to: 'b1', kind: 'branch', label: '不通过' },
  ],
};

const ctx: RenderContext = { idPrefix: '', origin: { x: 50, y: 50 }, fixed: new Map(), laneSizes: new Map(), obstacles: new Map() };

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

  it('跨泳道主干沿横向从左向右递推且跨 lane 边显式连接桩', () => {
    const r = renderSwimlane(normalizeSpec(crossDeptSpec), ctx);
    const n1 = byId(r, 'n1');
    const n2 = byId(r, 'n2');
    const n3 = byId(r, 'n3');
    const n4 = byId(r, 'n4');
    expect(n2.position.x).toBeGreaterThan(n1.position.x + n1.width!);
    expect(n3.position.x).toBeGreaterThan(n2.position.x + n2.width!);
    expect(n4.position.x).toBeGreaterThan(n3.position.x + n3.width!);
    expect(n1.position.y).toBe(n4.position.y);
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

  it('竖向泳道图按列自左向右并排、业务按因果自上而下推进且支持跨列分支', () => {
    const vertSpec: DiagramSpec = {
      paradigm: 'swimlane',
      orientation: 'vertical',
      lanes: [
        { id: 'c', label: '客户端' },
        { id: 's', label: '服务端' },
        { id: 'a', label: '业管端' },
      ],
      nodes: [
        { id: 'c1', label: '提交申请', laneId: 'c', type: 'start-end' },
        { id: 's1', label: '风控校验', laneId: 's', type: 'decision' },
        { id: 'a1', label: '人工复核', laneId: 'a' },
        { id: 'a2', label: '补充审核', laneId: 'a' },
        { id: 's2', label: '落单记账', laneId: 's' },
        { id: 'c2', label: '结果回显', laneId: 'c', type: 'start-end' },
        { id: 'n1', label: '附注', attachTo: 's1' },
      ],
      edges: [
        { from: 'c1', to: 's1' },
        { from: 's1', to: 'a1', kind: 'branch', label: '人工' },
        { from: 's1', to: 'a2', kind: 'branch', label: '复核' },
        { from: 'a1', to: 's2' },
        { from: 'a2', to: 's2' },
        { from: 's2', to: 'c2' },
      ],
    };
    const r = renderSwimlane(normalizeSpec(vertSpec), ctx);
    const pool = r.nodes.find((n) => n.type === 'pool')!;
    const lanes = r.nodes.filter((n) => n.type === 'lane');
    expect(pool.data!.orientation).toBe('vertical');
    expect(lanes[0].position).toEqual({ x: 0, y: 40 });
    expect(lanes[1].position).toEqual({ x: lanes[0].width!, y: 40 });
    expect(lanes[2].position).toEqual({ x: lanes[0].width! + lanes[1].width!, y: 40 });
    expect(new Set(lanes.map((l) => l.height)).size).toBe(1);
    expect(pool.height).toBe(40 + lanes[0].height!);
    expect(pool.width).toBe(lanes.reduce((acc, l) => acc + l.width!, 0));
    const c1 = byId(r, 'c1');
    const s1 = byId(r, 's1');
    const a1 = byId(r, 'a1');
    const s2 = byId(r, 's2');
    const c2 = byId(r, 'c2');
    expect(s1.position.y).toBeGreaterThan(c1.position.y + c1.height!);
    expect(a1.position.y).toBeGreaterThan(s1.position.y + s1.height!);
    expect(s2.position.y).toBeGreaterThan(a1.position.y + a1.height!);
    expect(c2.position.y).toBeGreaterThan(s2.position.y + s2.height!);
    expect(laneContainsAllChildren(r)).toBe(true);
    expect(annotationLaneIdInherited(r)).toBe(true);
    const world = r.nodes.map((n) => {
      const lane = lanes.find((l) => l.id === n.parentId);
      return lane ? { ...n, position: { x: n.position.x + lane.position.x, y: n.position.y + lane.position.y } } : n;
    });
    expect(noOverlap(world.filter((n) => !['pool', 'lane'].includes(n.type)))).toBe(true);
  });
});

describe('swimlane 横向主干范式（主干同泳道）', () => {
  const r = renderSwimlane(normalizeSpec(horizontalSpec), ctx);

  it('主干自左向右推进且主干边走 right → left', () => {
    const m1 = byId(r, 'm1');
    const m2 = byId(r, 'm2');
    const m3 = byId(r, 'm3');
    const m4 = byId(r, 'm4');
    expect(m2.position.x).toBeGreaterThan(m1.position.x);
    expect(m3.position.x).toBeGreaterThan(m2.position.x);
    expect(m4.position.x).toBeGreaterThan(m3.position.x);
    expect(new Set([m1.position.y, m2.position.y, m3.position.y, m4.position.y]).size).toBe(1);
    const trunk = r.edges.find((e) => e.source === 'm1' && e.target === 'm2')!;
    expect(trunk.sourceHandle).toBe('right');
    expect(trunk.targetHandle).toBe('left');
  });

  it('依赖节点与主干水平居中对齐并走上下连接桩', () => {
    const d1 = byId(r, 'd1');
    const m2 = byId(r, 'm2');
    expect(d1.position.x + d1.width! / 2).toBeCloseTo(m2.position.x + m2.width! / 2, 0);
    const ann = r.edges.find((e) => e.source === 'm2' && e.target === 'd1')!;
    expect(ann.sourceHandle).toBe('top');
    expect(ann.targetHandle).toBe('bottom');
    const ext = r.edges.find((e) => e.source === 'm3' && e.target === 'e1')!;
    expect(ext.sourceHandle).toBe('bottom');
    expect(ext.targetHandle).toBe('top');
  });

  it('同宿主附注纵向堆叠且分支落在主干下方', () => {
    const d1 = byId(r, 'd1');
    const d2 = byId(r, 'd2');
    expect(d2.position.y).toBeGreaterThan(d1.position.y + d1.height!);
    const b1 = byId(r, 'b1');
    const m3 = byId(r, 'm3');
    expect(b1.position.y).toBeGreaterThan(m3.position.y + m3.height!);
  });

  it('全图无重叠且子节点收纳在泳道内', () => {
    const world = r.nodes.map((n) => {
      const lane = r.nodes.find((l) => l.id === n.parentId && l.type === 'lane');
      return lane ? { ...n, position: { x: n.position.x + lane.position.x, y: n.position.y + lane.position.y } } : n;
    });
    expect(noOverlap(world.filter((n) => !['pool', 'lane'].includes(n.type)))).toBe(true);
    expect(laneContainsAllChildren(r)).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { normalizeSpec } from '../src/spec/normalize.js';
import type { DiagramSpec } from '../src/spec/types.js';
import { renderVerticalFlow } from '../src/render/vertical-flow.js';
import type { RenderContext } from '../src/render/types.js';
import { noOverlap, byId } from './helpers/render-asserts.js';

const retrySpec: DiagramSpec = {
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

const ctx: RenderContext = { idPrefix: '', origin: { x: 50, y: 50 }, fixed: new Map() };

describe('vertical-flow 几何约定', () => {
  it('主干中心线对齐且净间距恒为 MAIN_GAP', () => {
    const r = renderVerticalFlow(normalizeSpec(retrySpec), ctx);
    const mains = r.nodes.filter((n) => ['m1', 'd1', 'end'].includes(n.id));
    expect(new Set(mains.map((n) => n.position.x + n.width! / 2)).size).toBe(1);
    expect(mains[1].position.y - (mains[0].position.y + mains[0].height!)).toBe(50);
    expect(mains[2].position.y - (mains[1].position.y + mains[1].height!)).toBe(50);
  });

  it('分支与 from 同行右置 BRANCH_GAP，分支下游垂直', () => {
    const r = renderVerticalFlow(normalizeSpec(retrySpec), ctx);
    const d1 = byId(r, 'd1');
    const d2 = byId(r, 'd2');
    const alarm = byId(r, 'alarm');
    expect(d2.position.y + d2.height! / 2).toBe(d1.position.y + d1.height! / 2);
    expect(d2.position.x - (d1.position.x + d1.width!)).toBe(85);
    expect(alarm.position.y - (d2.position.y + d2.height!)).toBe(50);
    expect(alarm.position.x + alarm.width! / 2).toBe(d2.position.x + d2.width! / 2);
  });

  it('loop 走上方侧路且不穿越主干', () => {
    const r = renderVerticalFlow(normalizeSpec(retrySpec), ctx);
    const mains = r.nodes.filter((n) => ['m1', 'd1', 'end'].includes(n.id));
    const mainRightEdge = Math.max(...mains.map((n) => n.position.x + n.width!));
    const loop = r.edges.find((e) => e.data!.kind === 'loop')!;
    expect(loop.sourceHandle).toBe('top');
    expect(loop.targetHandle).toBe('right');
    expect(loop.data!.waypoints!.length).toBe(3);
    expect(loop.data!.waypoints!.every((p) => p.x > mainRightEdge)).toBe(true);
    expect(loop.data!.waypoints![0].y).toBeLessThan(Math.min(byId(r, 'd2').position.y, byId(r, 'm1').position.y));
  });

  it('所有边显式连接桩且节点取 registry 尺寸', () => {
    const r = renderVerticalFlow(normalizeSpec(retrySpec), ctx);
    expect(r.edges.every((e) => e.sourceHandle && e.targetHandle)).toBe(true);
    expect(r.nodes.every((n) => n.width && n.height)).toBe(true);
    expect(byId(r, 'm1').width).toBe(160);
    expect(byId(r, 'd1').width).toBe(140);
    expect(noOverlap(r.nodes)).toBe(true);
  });

  it('空 spec 与单节点 spec 产出合法几何', () => {
    expect(renderVerticalFlow(normalizeSpec({ paradigm: 'vertical-flow', nodes: [], edges: [] }), ctx).nodes).toEqual([]);
    const one = renderVerticalFlow(normalizeSpec({ paradigm: 'vertical-flow', nodes: [{ id: 'a', label: 'A' }], edges: [] }), ctx);
    expect(byId(one, 'a').position).toEqual({ x: 50, y: 50 });
  });

  it('fixed 锁节点坐标零改写且其余节点让位不重叠', () => {
    const fixed = new Map([['m1', { position: { x: 60, y: 200 }, width: 160, height: 80 }]]);
    const r = renderVerticalFlow(normalizeSpec(retrySpec), { ...ctx, fixed });
    expect(byId(r, 'm1').position).toEqual({ x: 60, y: 200 });
    expect(byId(r, 'd1').position.y).toBeGreaterThanOrEqual(330);
    expect(noOverlap(r.nodes)).toBe(true);
  });

  it('main→main 回环走右侧侧路不穿越主干', () => {
    const r = renderVerticalFlow(normalizeSpec({
      paradigm: 'vertical-flow',
      nodes: [{ id: 'm1', label: '一' }, { id: 'm2', label: '二' }, { id: 'm3', label: '三' }],
      edges: [{ from: 'm1', to: 'm2' }, { from: 'm2', to: 'm3' }, { from: 'm3', to: 'm1', kind: 'loop' }],
    }), ctx);
    const mains = r.nodes.filter((n) => ['m1', 'm2', 'm3'].includes(n.id));
    const mainRight = Math.max(...mains.map((n) => n.position.x + n.width!));
    const loop = r.edges.find((e) => e.data!.kind === 'loop')!;
    expect(loop.data!.waypoints!.every((p) => p.x > mainRight)).toBe(true);
    expect(noOverlap(r.nodes)).toBe(true);
  });

  it('jump 跨段旁路走最右外侧侧路且主干角色不变', () => {
    const r = renderVerticalFlow(normalizeSpec({
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
    }), ctx);
    const jump = r.edges.find((e) => e.data!.kind === 'jump')!;
    expect(jump.sourceHandle).toBe('right');
    expect(jump.targetHandle).toBe('right');
    const maxRight = Math.max(...r.nodes.map((n) => n.position.x + n.width!));
    expect(jump.data!.waypoints!.every((p) => p.x > maxRight)).toBe(true);
    expect(jump.data!.waypoints![0].y).toBe(byId(r, 'd1').position.y + byId(r, 'd1').height! / 2);
    expect(jump.data!.waypoints![1].y).toBe(byId(r, 'd2').position.y + byId(r, 'd2').height! / 2);
    expect(noOverlap(r.nodes)).toBe(true);
  });

  it('idPrefix 作用于实体与边端点', () => {
    const r = renderVerticalFlow(normalizeSpec(retrySpec), { ...ctx, idPrefix: 'x_' });
    expect(r.nodes.every((n) => n.id.startsWith('x_'))).toBe(true);
    expect(r.edges.every((e) => e.source.startsWith('x_') && e.target.startsWith('x_'))).toBe(true);
  });
});
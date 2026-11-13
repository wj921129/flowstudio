import { describe, it, expect } from 'vitest';
import { normalizeSpec } from '../src/spec/normalize.js';
import type { DiagramSpec } from '../src/spec/types.js';
import { renderVerticalFlowGrid } from '../src/render/vertical-flow-grid.js';
import type { RenderContext } from '../src/render/types.js';
import { MAIN_GAP } from '../src/render/constants.js';
import { noOverlap, byId } from './helpers/render-asserts.js';

const spec: DiagramSpec = {
  paradigm: 'vertical-flow',
  nodes: [
    { id: 'm1', label: '入口', type: 'start-end' },
    { id: 'd1', label: '员工薪酬？', type: 'decision' },
    { id: 'b1', label: '薪酬>30万？', type: 'decision' },
    { id: 'pass', label: '不限额', type: 'start-end' },
    { id: 'limit', label: '限额', type: 'start-end' },
    { id: 'm2', label: '大陆公司？', type: 'decision' },
    { id: 'note', label: '调用点说明', type: 'comment', attachTo: 'm1' },
  ],
  edges: [
    { from: 'm1', to: 'd1' },
    { from: 'd1', to: 'm2', label: '否' },
    { from: 'd1', to: 'b1', kind: 'branch', label: '是' },
    { from: 'b1', to: 'pass', label: '否' },
    { from: 'b1', to: 'limit', kind: 'branch', label: '是' },
    { from: 'pass', to: 'd1', kind: 'loop', label: '回归' },
  ],
};

const ctx: RenderContext = { idPrefix: '', origin: { x: 50, y: 50 }, fixed: new Map(), laneSizes: new Map(), obstacles: new Map() };

describe('vertical-flow 网格几何约定', () => {
  it('便签左置且 annotate 左出右入', () => {
    const r = renderVerticalFlowGrid(normalizeSpec(spec), ctx);
    const m1 = byId(r, 'm1');
    const note = byId(r, 'note');
    expect(note.position.x + note.width!).toBeLessThan(m1.position.x);
    const ann = r.edges.find((e) => e.data!.kind === 'annotate')!;
    expect(ann.sourceHandle).toBe('left');
    expect(ann.targetHandle).toBe('right');
  });

  it('分支网格：next 下行同列、终端分支同行右置不共线', () => {
    const r = renderVerticalFlowGrid(normalizeSpec(spec), ctx);
    const b1 = byId(r, 'b1');
    const pass = byId(r, 'pass');
    const limit = byId(r, 'limit');
    expect(pass.position.x).toBe(b1.position.x);
    expect(pass.position.y).toBeGreaterThan(b1.position.y);
    expect(limit.position.y).toBe(pass.position.y);
    expect(limit.position.x).toBeGreaterThan(pass.position.x + pass.width!);
    expect(noOverlap(r.nodes)).toBe(true);
  });

  it('回归边横向侧路左出右入且独立 lane 不穿主干', () => {
    const r = renderVerticalFlowGrid(normalizeSpec(spec), ctx);
    const reg = r.edges.find((e) => e.data!.kind === 'loop')!;
    expect(reg.sourceHandle).toBe('left');
    expect(reg.targetHandle).toBe('right');
    expect(reg.data!.waypoints!.length).toBe(4);
    const d1 = byId(r, 'd1');
    const trunkRight = d1.position.x + d1.width!;
    expect(reg.data!.waypoints!.every((p) => p.x > trunkRight)).toBe(true);
  });

  it('主干为分支块留白', () => {
    const r = renderVerticalFlowGrid(normalizeSpec(spec), ctx);
    const m2 = byId(r, 'm2');
    const blockBottom = Math.max(...['b1', 'pass', 'limit'].map((id) => byId(r, id).position.y + byId(r, id).height!));
    expect(m2.position.y).toBeGreaterThanOrEqual(blockBottom + MAIN_GAP);
  });

  it('双重判断回归通过 normalize 锚点例外', () => {
    expect(() => normalizeSpec(spec)).not.toThrow();
  });
});
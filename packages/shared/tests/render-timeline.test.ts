import { describe, it, expect } from 'vitest';
import { normalizeSpec } from '../src/spec/normalize.js';
import { renderTimeline } from '../src/render/timeline.js';
import type { RenderContext } from '../src/render/types.js';
import { noOverlap, byId, columnsOf, buildSvnSpec } from './helpers/render-asserts.js';

const ctx: RenderContext = { idPrefix: '', origin: { x: 50, y: 50 }, fixed: new Map() };

describe('timeline-annotated 几何约定', () => {
  it('附注超 4 条折列且列内 pitch 恒为 annotH+ANNOT_GAP', () => {
    const r = renderTimeline(normalizeSpec(buildSvnSpec()), ctx);
    expect(columnsOf(r, 't1')).toBe(2);
    expect(columnsOf(r, 't13')).toBe(1);
    const col1 = r.nodes.filter((n) => n.data!.attachTo === 't1').sort((a, b) => a.position.y - b.position.y);
    const firstCol = col1.filter((n) => n.position.x === col1[0].position.x);
    expect(firstCol.length).toBe(4);
    expect(firstCol[1].position.y - (firstCol[0].position.y + firstCol[0].height!)).toBe(16);
    const xs = [...new Set(col1.map((n) => n.position.x))].sort((a, b) => a - b);
    expect(xs[1] - xs[0]).toBe(240);
  });

  it('相连主干净距恒为 MAIN_GAP，附注块不撑高主干间距', () => {
    const r = renderTimeline(normalizeSpec(buildSvnSpec()), ctx);
    const t1 = byId(r, 't1');
    const t2 = byId(r, 't2');
    expect(t2.position.y - (t1.position.y + t1.height!)).toBe(50);
    const t12 = byId(r, 't12');
    const t13 = byId(r, 't13');
    expect(t13.position.y - (t12.position.y + t12.height!)).toBe(50);
  });

  it('附注块自 origin 连续账本式排布且不重叠', () => {
    const r = renderTimeline(normalizeSpec(buildSvnSpec()), ctx);
    const t1 = byId(r, 't1');
    const anns1 = r.nodes.filter((n) => n.data!.attachTo === 't1');
    const top1 = Math.min(...anns1.map((n) => n.position.y));
    const bottom1 = Math.max(...anns1.map((n) => n.position.y + n.height!));
    expect(top1).toBe(50);
    expect(t1.position.y).toBe(50);
    const anns2 = r.nodes.filter((n) => n.data!.attachTo === 't2');
    expect(Math.min(...anns2.map((n) => n.position.y))).toBeGreaterThanOrEqual(bottom1 + 16);
  });

  it('全图无重叠且 annotate 边为肘形扇出', () => {
    const r = renderTimeline(normalizeSpec(buildSvnSpec()), ctx);
    expect(noOverlap(r.nodes)).toBe(true);
    const annotEdges = r.edges.filter((e) => e.data!.kind === 'annotate');
    expect(annotEdges.length).toBe(25);
    expect(annotEdges.every((e) => e.sourceHandle === 'right' && e.targetHandle === 'left')).toBe(true);
    expect(annotEdges.every((e) => e.data!.waypoints!.length === 2)).toBe(true);
  });

  it('超长 label 原样保留且尺寸取 registry', () => {
    const r = renderTimeline(normalizeSpec(buildSvnSpec()), ctx);
    expect(byId(r, 'a1').data!.label.length).toBeGreaterThan(30);
    expect(byId(r, 'a1').width).toBe(200);
    expect(byId(r, 'a1').height).toBe(120);
    expect(byId(r, 't1').width).toBe(160);
  });

  it('无附注步骤退化为 vertical-flow 恒距主干', () => {
    const r = renderTimeline(normalizeSpec({
      paradigm: 'timeline-annotated',
      nodes: [{ id: 's1', label: 'S1' }, { id: 's2', label: 'S2' }],
      edges: [{ from: 's1', to: 's2' }],
    }), ctx);
    expect(byId(r, 's2').position.y - (byId(r, 's1').position.y + byId(r, 's1').height!)).toBe(50);
    expect(byId(r, 's1').position.x).toBe(byId(r, 's2').position.x);
  });
});
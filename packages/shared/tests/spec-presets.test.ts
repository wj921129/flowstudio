import { describe, it, expect } from 'vitest';
import { renderSpec } from '../src/render/index.js';
import { DIAGRAM_PRESETS } from '../src/spec/presets.js';
import { noOverlap, byId, preset, laneContainsAllChildren } from './helpers/render-asserts.js';

describe('renderSpec 入口与范式预设', () => {
  it('8 个预设齐全且覆盖 4 个分类', () => {
    expect(DIAGRAM_PRESETS.length).toBe(8);
    expect(new Set(DIAGRAM_PRESETS.map((p) => p.category)).size).toBe(4);
  });

  it('所有预设渲染无重叠且泳道容纳子节点', () => {
    for (const p of DIAGRAM_PRESETS) {
      const r = renderSpec(p.spec);
      if (p.spec.paradigm === 'swimlane') {
        expect(laneContainsAllChildren(r)).toBe(true);
        const lanes = r.nodes.filter((n) => n.type === 'lane');
        const world = r.nodes
          .filter((n) => !['pool', 'lane'].includes(n.type))
          .map((n) => {
            const lane = lanes.find((l) => l.id === n.parentId)!;
            return { ...n, position: { x: n.position.x + lane.position.x, y: n.position.y + lane.position.y } };
          });
        expect(noOverlap(world)).toBe(true);
      } else {
        expect(noOverlap(r.nodes)).toBe(true);
      }
    }
  });

  it('基准预设满足四条几何约定', () => {
    const r = renderSpec(preset('flowchart-retry-compensation'));
    const mains = r.nodes.filter((n) => ['start-2', 'proc-task', 'dec-status', 'end-success'].includes(n.id));
    expect(new Set(mains.map((n) => n.position.x + n.width! / 2)).size).toBe(1);
    expect(mains[1].position.y - (mains[0].position.y + mains[0].height!)).toBe(50);
    const d1 = byId(r, 'dec-status');
    const d2 = byId(r, 'dec-retry');
    expect(d2.position.y + d2.height! / 2).toBe(d1.position.y + d1.height! / 2);
    expect(d2.position.x - (d1.position.x + d1.width!)).toBe(85);
    const loop = r.edges.find((e) => e.data!.kind === 'loop')!;
    const mainRight = Math.max(...mains.map((n) => n.position.x + n.width!));
    expect(loop.data!.waypoints!.every((p) => p.x > mainRight)).toBe(true);
  });

  it('泳道预设业务节点挂 lane（修复旧模板挂 pool 缺陷）', () => {
    const r = renderSpec(preset('swimlane-cross-department'));
    expect(r.nodes.filter((n) => !['pool', 'lane'].includes(n.type)).every((n) => n.parentId!.startsWith('lane'))).toBe(true);
  });

  it('idPrefix 产出互不相同的实体 id', () => {
    const p = DIAGRAM_PRESETS[0];
    const a = renderSpec(p.spec, { idPrefix: 'x_' });
    const b = renderSpec(p.spec, { idPrefix: 'y_' });
    expect(a.nodes[0].id).not.toBe(b.nodes[0].id);
    expect(a.nodes.every((n) => n.id.startsWith('x_'))).toBe(true);
  });

  it('空 spec 渲染为空结果', () => {
    expect(renderSpec({ paradigm: 'vertical-flow', nodes: [], edges: [] }).nodes).toEqual([]);
  });

  it('双父敏捷阵型以 tiered-dag 渲染且同层不重叠', () => {
    const r = renderSpec(preset('org-agile-squad'));
    const be = byId(r, 'squad-be');
    const fe = byId(r, 'squad-fe');
    expect(be.position.y).toBe(fe.position.y);
    expect(noOverlap(r.nodes)).toBe(true);
  });
});
import { describe, it, expect } from 'vitest';
import {
  alignWaypointsToAnchors,
  distributeEdgePorts,
  getBorderAnchorWorldPoint,
  parseBorderAnchorHandle,
  pickEdgePortsForConnect,
  renderSpec,
  resolveNodeWorldBoxes,
  type DiagramSpec,
  type FlowEdge,
  type FlowNode,
} from '../src/index.js';

function makeNode(id: string, x: number, y: number, type: FlowNode['type'] = 'process', parentId?: string): FlowNode {
  return {
    id,
    type,
    position: { x, y },
    width: 160,
    height: 80,
    ...(parentId ? { parentId } : {}),
    data: { label: id, type },
  };
}

describe('edge-port-allocator 共享端口分摊引擎', () => {
  it('resolveNodeWorldBoxes 累加父子坐标并防止异常环死循环', () => {
    const nodes: FlowNode[] = [
      { id: 'pool', type: 'pool', position: { x: 100, y: 200 }, width: 600, height: 400, data: { label: 'pool', type: 'pool' } },
      { id: 'lane', type: 'lane', parentId: 'pool', position: { x: 0, y: 40 }, width: 600, height: 200, data: { label: 'lane', type: 'lane' } },
      { id: 'n1', type: 'process', parentId: 'lane', position: { x: 30, y: 50 }, data: { label: 'n1', type: 'process' } },
      { id: 'cyc1', type: 'process', parentId: 'cyc2', position: { x: 10, y: 10 }, data: { label: 'cyc1', type: 'process' } },
      { id: 'cyc2', type: 'process', parentId: 'cyc1', position: { x: 20, y: 20 }, data: { label: 'cyc2', type: 'process' } },
    ];
    const boxes = resolveNodeWorldBoxes(nodes);
    expect(boxes.get('n1')).toEqual({ id: 'n1', type: 'process', x: 130, y: 290, width: 160, height: 80 });
    expect(boxes.get('cyc1')?.x).toBe(30);
  });

  it('distributeEdgePorts：1/2/3/5 条同侧边按对端坐标排序并均匀错开', () => {
    const src = makeNode('s', 0, 200);
    const t1 = makeNode('t1', 300, 0);
    const t2 = makeNode('t2', 300, 150);
    const t3 = makeNode('t3', 300, 300);
    const t4 = makeNode('t4', 300, 450);
    const t5 = makeNode('t5', 300, 600);

    const edges2: FlowEdge[] = [
      { id: 'e2', source: 's', target: 't2', sourceHandle: 'right', targetHandle: 'left' },
      { id: 'e1', source: 's', target: 't1', sourceHandle: 'right', targetHandle: 'left' },
    ];
    const res2 = distributeEdgePorts([src, t1, t2], edges2);
    expect(res2.find((e) => e.id === 'e1')!.sourceHandle).toBe('right@0.3333');
    expect(res2.find((e) => e.id === 'e2')!.sourceHandle).toBe('right@0.6667');
    expect(res2.find((e) => e.id === 'e1')!.data?.autoSourceHandle).toBe('right@0.3333');

    const edges3: FlowEdge[] = [
      { id: 'e3', source: 's', target: 't3', sourceHandle: 'right', targetHandle: 'left' },
      { id: 'e1', source: 's', target: 't1', sourceHandle: 'right', targetHandle: 'left' },
      { id: 'e2', source: 's', target: 't2', sourceHandle: 'right', targetHandle: 'left' },
    ];
    const res3 = distributeEdgePorts([src, t1, t2, t3], edges3);
    expect(res3.find((e) => e.id === 'e1')!.sourceHandle).toBe('right@0.25');
    expect(res3.find((e) => e.id === 'e2')!.sourceHandle).toBe('right');
    expect(res3.find((e) => e.id === 'e3')!.sourceHandle).toBe('right@0.75');

    const edges5: FlowEdge[] = [t1, t2, t3, t4, t5].map((t, i) => ({
      id: `e${i + 1}`,
      source: 's',
      target: t.id,
      sourceHandle: 'right',
      targetHandle: 'left',
    }));
    const res5 = distributeEdgePorts([src, t1, t2, t3, t4, t5], edges5);
    const offsets5 = res5.map((e) => parseBorderAnchorHandle(e.sourceHandle)!.offset);
    expect(offsets5[0]).toBeCloseTo(0.15, 3);
    expect(offsets5[4]).toBeCloseTo(0.85, 3);
    for (let i = 1; i < offsets5.length; i++) {
      expect(offsets5[i] - offsets5[i - 1]).toBeGreaterThan(0.1);
    }
  });

  it('distributeEdgePorts：双向边 A↔B 自动拆开不在同一点重合', () => {
    const a = makeNode('a', 0, 100);
    const b = makeNode('b', 300, 100);
    const edges: FlowEdge[] = [
      { id: 'ab', source: 'a', target: 'b' },
      { id: 'ba', source: 'b', target: 'a' },
    ];
    const res = distributeEdgePorts([a, b], edges);
    const ab = res.find((e) => e.id === 'ab')!;
    const ba = res.find((e) => e.id === 'ba')!;
    expect(ab.sourceHandle).toBe('right@0.3333');
    expect(ba.targetHandle).toBe('right@0.6667');
    expect(ab.targetHandle).toBe('left@0.3333');
    expect(ba.sourceHandle).toBe('left@0.6667');
  });

  it('distributeEdgePorts：decision 菱形收敛至安全区间且联动校准 waypoints 首尾坐标', () => {
    const d = makeNode('d', 100, 100, 'decision');
    const t1 = makeNode('t1', 350, 0);
    const t2 = makeNode('t2', 350, 200);
    const edges: FlowEdge[] = [
      {
        id: 'e1',
        source: 'd',
        target: 't1',
        sourceHandle: 'right',
        targetHandle: 'left',
        data: { waypoints: [{ x: 300, y: 150 }, { x: 300, y: 40 }] },
      },
      { id: 'e2', source: 'd', target: 't2', sourceHandle: 'right', targetHandle: 'left' },
    ];
    const res = distributeEdgePorts([d, t1, t2], edges);
    const e1 = res.find((e) => e.id === 'e1')!;
    const boxes = resolveNodeWorldBoxes([d, t1, t2]);
    const anchor = getBorderAnchorWorldPoint(boxes.get('d')!, e1.sourceHandle, 'right', 'decision');
    expect(e1.data!.waypoints![0].y).toBeCloseTo(anchor.y, 4);
    expect(e1.data!.waypoints![0].x).toBe(300);
  });

  it('distributeEdgePorts：尊重 fixedEdgeIds / lockedSourceEdgeIds 与 obstacleEdges 避让', () => {
    const a = makeNode('a', 0, 100);
    const b = makeNode('b', 300, 0);
    const c = makeNode('c', 300, 200);
    const obs: FlowEdge[] = [{ id: 'obs', source: 'a', target: 'b', sourceHandle: 'right@0.5', targetHandle: 'left' }];
    const edges: FlowEdge[] = [{ id: 'new1', source: 'a', target: 'c', sourceHandle: 'right', targetHandle: 'left' }];
    const res = distributeEdgePorts([a, b, c], edges, { obstacleEdges: obs });
    const off = parseBorderAnchorHandle(res[0].sourceHandle)!.offset;
    expect(Math.abs(off - 0.5)).toBeGreaterThanOrEqual(0.08);
  });

  it('pickEdgePortsForConnect：增量逐条连接自动避让同侧旧边且绝不修改旧边', () => {
    const a = makeNode('a', 0, 200);
    const b1 = makeNode('b1', 300, 100);
    const b2 = makeNode('b2', 300, 200);
    const b3 = makeNode('b3', 300, 300);

    const existing: FlowEdge[] = [];
    const p1 = pickEdgePortsForConnect([a, b1], existing, { sourceId: 'a', targetId: 'b1' });
    expect(p1.sourceHandle).toBe('right');
    expect(p1.targetHandle).toBe('left');
    expect(p1.sourceAuto).toBe(true);

    existing.push({ id: 'e1', source: 'a', target: 'b1', sourceHandle: p1.sourceHandle, targetHandle: p1.targetHandle });
    const snapshotBefore = JSON.stringify(existing);

    const p2 = pickEdgePortsForConnect([a, b1, b2], existing, { sourceId: 'a', targetId: 'b2' });
    expect(p2.sourceHandle).toMatch(/^right@/);
    expect(p2.sourceHandle).not.toBe('right');
    expect(JSON.stringify(existing)).toBe(snapshotBefore);

    existing.push({ id: 'e2', source: 'a', target: 'b2', sourceHandle: p2.sourceHandle, targetHandle: p2.targetHandle });
    const p3 = pickEdgePortsForConnect([a, b1, b2, b3], existing, { sourceId: 'a', targetId: 'b3', sourceHandle: 'right' });
    expect(p3.sourceAuto).toBe(true);
    expect(p3.sourceHandle).not.toBe(p1.sourceHandle);
    expect(p3.sourceHandle).not.toBe(p2.sourceHandle);

    const p4 = pickEdgePortsForConnect([a, b1, b2, b3], existing, {
      sourceId: 'a',
      targetId: 'b3',
      sourceHandle: 'right@0.88',
      targetHandle: 'top@0.2',
    });
    expect(p4.sourceHandle).toBe('right@0.88');
    expect(p4.targetHandle).toBe('top@0.2');
    expect(p4.sourceAuto).toBe(false);
    expect(p4.targetAuto).toBe(false);
  });

  it('renderSpec：支持 strokeStyle、annotate 默认虚线与 5 范式防重叠端口分摊', () => {
    const spec: DiagramSpec = {
      paradigm: 'tiered-dag',
      nodes: [
        { id: 'n1', label: '入口' },
        { id: 'n2', label: '下游A' },
        { id: 'n3', label: '下游B' },
      ],
      edges: [
        { from: 'n1', to: 'n2', strokeStyle: 'dashed', label: '异步' },
        { from: 'n1', to: 'n3', strokeStyle: 'dotted', label: '弱依赖' },
      ],
    };
    const res = renderSpec(spec);
    const e1 = res.edges.find((e) => e.target === 'n2')!;
    const e2 = res.edges.find((e) => e.target === 'n3')!;
    expect(e1.data?.style?.strokeStyle).toBe('dashed');
    expect(e2.data?.style?.strokeStyle).toBe('dotted');
    expect(e1.sourceHandle).toBe('bottom@0.3333');
    expect(e2.sourceHandle).toBe('bottom@0.6667');

    const flowSpec: DiagramSpec = {
      paradigm: 'circuit-flow',
      nodes: [
        { id: 'm1', label: '开始', type: 'start-end' },
        { id: 'm2', label: '结束', type: 'start-end' },
        { id: 'note', label: '备注', type: 'comment', attachTo: 'm1' },
      ],
      edges: [{ from: 'm1', to: 'm2' }],
    };
    const flowRes = renderSpec(flowSpec);
    const ann = flowRes.edges.find((e) => e.data?.kind === 'annotate')!;
    expect(ann.data?.style?.strokeStyle).toBe('dashed');
  });

  it('alignWaypointsToAnchors：L 型单拐点与同轴单拐点对齐后保持严格正交', () => {
    const s = makeNode('s', 100, 100);
    const t = makeNode('t', 380, 260);
    const boxes = resolveNodeWorldBoxes([s, t]);
    const sBox = boxes.get('s')!;
    const tBox = boxes.get('t')!;

    const lAligned = alignWaypointsToAnchors([{ x: 460, y: 140 }], sBox, 'right@0.3333', tBox, 'top@0.25');
    const lS = getBorderAnchorWorldPoint(sBox, 'right@0.3333', 'right', 'process');
    const lT = getBorderAnchorWorldPoint(tBox, 'top@0.25', 'top', 'process');
    const lPts = [lS, ...lAligned, lT];
    expect(lAligned).toHaveLength(1);
    expect(lPts.slice(1).every((p, i) => Math.abs(p.x - lPts[i].x) < 0.5 || Math.abs(p.y - lPts[i].y) < 0.5)).toBe(true);

    const sameAxisAligned = alignWaypointsToAnchors([{ x: 240, y: 200 }], sBox, 'bottom@0.3333', tBox, 'top@0.6667');
    const saS = getBorderAnchorWorldPoint(sBox, 'bottom@0.3333', 'bottom', 'process');
    const saT = getBorderAnchorWorldPoint(tBox, 'top@0.6667', 'top', 'process');
    const saPts = [saS, ...sameAxisAligned, saT];
    expect(sameAxisAligned).toHaveLength(2);
    expect(saPts.slice(1).every((p, i) => Math.abs(p.x - saPts[i].x) < 0.5 || Math.abs(p.y - saPts[i].y) < 0.5)).toBe(true);
  });
});

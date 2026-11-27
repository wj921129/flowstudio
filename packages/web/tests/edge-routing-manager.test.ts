import { describe, it, expect, beforeEach } from 'vitest';
import {
  EdgeRoutingManager,
  computeEdgeOverlaps,
  computeOverlapStrokeWidth,
  pickOverlapRepresentative,
} from '../src/features/canvas/custom-edges';
import type { FlowNode } from '@flowstudio/shared';

describe('EdgeRoutingManager', () => {
  let manager: EdgeRoutingManager;

  beforeEach(() => {
    manager = EdgeRoutingManager.getInstance();
    manager.clear();
  });

  it('updates nodes and generates obstacle boxes with world coordinates', () => {
    const nodes: FlowNode[] = [
      {
        id: 'parent-lane',
        type: 'lane',
        position: { x: 100, y: 100 },
        data: { label: 'Lane 1', type: 'lane' },
        width: 400,
        height: 300,
      },
      {
        id: 'child-node',
        type: 'process',
        parentId: 'parent-lane',
        position: { x: 50, y: 40 },
        data: { label: 'Process', type: 'process' },
        width: 100,
        height: 60,
      },
    ];

    manager.updateNodes(nodes);
    const obstacles = manager.getObstacles();

    expect(obstacles.length).toBe(2);
    const childObs = obstacles.find((o) => o.id === 'child-node');
    expect(childObs).toBeDefined();
    expect(childObs?.x).toBe(150);
    expect(childObs?.y).toBe(140);
    expect(childObs?.isLane).toBe(false);

    const laneObs = obstacles.find((o) => o.id === 'parent-lane');
    expect(laneObs?.isLane).toBe(true);
  });

  it('routes an edge, caches the result, and invalidates on node move', () => {
    const route1 = manager.routeEdge({
      id: 'e1',
      source: { x: 50, y: 100 },
      target: { x: 300, y: 100 },
      sourcePosition: 'right',
      targetPosition: 'left',
    });

    const route2 = manager.routeEdge({
      id: 'e1',
      source: { x: 50, y: 100 },
      target: { x: 300, y: 100 },
      sourcePosition: 'right',
      targetPosition: 'left',
    });

    expect(route1).toBe(route2);

    manager.updateNodes([
      {
        id: 'n1',
        type: 'process',
        position: { x: 150, y: 80 },
        data: { label: 'N1', type: 'process' },
        width: 80,
        height: 40,
      },
    ]);

    const route3 = manager.routeEdge({
      id: 'e1',
      source: { x: 50, y: 100 },
      target: { x: 300, y: 100 },
      sourcePosition: 'right',
      targetPosition: 'left',
    });

    expect(route3).not.toBe(route1);
    expect(route3.waypoints.length).toBeGreaterThanOrEqual(2);
  });

  it('generates bridge jump when two registered edges cross each other', () => {
    manager.routeEdge({
      id: 'edge-horizontal',
      source: { x: 20, y: 150 },
      target: { x: 200, y: 150 },
      sourcePosition: 'right',
      targetPosition: 'left',
    });

    const verticalRoute = manager.routeEdge({
      id: 'edge-vertical',
      source: { x: 100, y: 50 },
      target: { x: 100, y: 250 },
      sourcePosition: 'bottom',
      targetPosition: 'top',
    });

    expect(verticalRoute.path).toContain('A 5 5 0 0 0');
  });

  it('schedules and executes RAF debounced callbacks', async () => {
    let called = false;
    manager.scheduleRaf(() => {
      called = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(called).toBe(true);
  });

  it('resets all indices, caches, and obstacle states via reset()', () => {
    manager.updateNodes([
      {
        id: 'n1',
        type: 'process',
        position: { x: 50, y: 50 },
        data: { label: 'N1', type: 'process' },
        width: 100,
        height: 60,
      },
    ]);

    manager.routeEdge({
      id: 'e1',
      source: { x: 20, y: 50 },
      target: { x: 200, y: 50 },
    });

    expect(manager.getObstacles().length).toBe(1);
    expect(manager.getCandidateObstacles({ x: 20, y: 50 }, { x: 200, y: 50 }).length).toBe(1);

    manager.reset();

    expect(manager.getObstacles().length).toBe(0);
    expect(manager.getCandidateObstacles({ x: 20, y: 50 }, { x: 200, y: 50 }).length).toBe(0);
    expect(manager.getOtherHorizontalSegments('e1').length).toBe(0);
  });

  it('retrieves only candidate obstacles within the bounding box plus margin', () => {
    manager.updateNodes([
      {
        id: 'near-node',
        type: 'process',
        position: { x: 100, y: 100 },
        data: { label: 'Near', type: 'process' },
        width: 80,
        height: 40,
      },
      {
        id: 'far-node',
        type: 'process',
        position: { x: 2500, y: 2500 },
        data: { label: 'Far', type: 'process' },
        width: 80,
        height: 40,
      },
    ]);

    const candidates = manager.getCandidateObstacles(
      { x: 50, y: 100 },
      { x: 250, y: 100 },
      150
    );

    const candidateIds = candidates.map((c) => c.id);
    expect(candidateIds).toContain('near-node');
    expect(candidateIds).not.toContain('far-node');
  });

  it('updates only moved node in spatial grid without clearing other nodes', () => {
    manager.updateNodes([
      {
        id: 'stationary',
        type: 'process',
        position: { x: 100, y: 100 },
        data: { label: 'Stationary', type: 'process' },
        width: 80,
        height: 40,
      },
      {
        id: 'mover',
        type: 'process',
        position: { x: 200, y: 200 },
        data: { label: 'Mover', type: 'process' },
        width: 80,
        height: 40,
      },
    ]);

    const initialStatCandidates = manager.getCandidateObstacles({ x: 100, y: 100 }, { x: 120, y: 120 }, 50);
    expect(initialStatCandidates.map((c) => c.id)).toContain('stationary');

    // Move only mover to a far location
    manager.updateNodes([
      {
        id: 'stationary',
        type: 'process',
        position: { x: 100, y: 100 },
        data: { label: 'Stationary', type: 'process' },
        width: 80,
        height: 40,
      },
      {
        id: 'mover',
        type: 'process',
        position: { x: 2000, y: 2000 },
        data: { label: 'Mover', type: 'process' },
        width: 80,
        height: 40,
      },
    ]);

    // Stationary should still be found in its grid
    const statCandidates = manager.getCandidateObstacles({ x: 100, y: 100 }, { x: 120, y: 120 }, 50);
    expect(statCandidates.map((c) => c.id)).toContain('stationary');
    expect(statCandidates.map((c) => c.id)).not.toContain('mover');

    // Mover should now be found at 2000, 2000
    const moverCandidates = manager.getCandidateObstacles({ x: 1980, y: 1980 }, { x: 2020, y: 2020 }, 50);
    expect(moverCandidates.map((c) => c.id)).toContain('mover');
  });

  it('stress test: routes edge efficiently in virtual scene with 200+ nodes', () => {
    const nodes: FlowNode[] = [];
    const count = 225; // 15 x 15 grid
    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        nodes.push({
          id: `node-${r}-${c}`,
          type: 'process',
          position: { x: c * 250, y: r * 250 },
          data: { label: `Node ${r}-${c}`, type: 'process' },
          width: 100,
          height: 60,
        });
      }
    }

    manager.updateNodes(nodes);
    expect(manager.getObstacles().length).toBe(count);

    // Measure candidate extraction and routing for a local edge
    const source = { x: 50, y: 50 };
    const target = { x: 260, y: 50 };

    const candidates = manager.getCandidateObstacles(source, target, 150);
    expect(candidates.length).toBeLessThan(20);
    expect(candidates.length).toBeGreaterThan(0);

    const t0 = performance.now();
    const route = manager.routeEdge({
      id: 'local-edge',
      source,
      target,
      sourcePosition: 'right',
      targetPosition: 'left',
    });
    const duration = performance.now() - t0;

    expect(duration).toBeLessThan(30); // Millisecond-level performance
    expect(route.path).toBeDefined();
    expect(route.waypoints).toBeDefined();
  });

  it('detects collinear horizontal, vertical, and diagonal overlaps and scales stroke width with cap', () => {
    const segMap = new Map([
      [
        'e1',
        [
          { index: 0, start: { x: 0, y: 100 }, end: { x: 200, y: 100 }, midpoint: { x: 100, y: 100 } },
          { index: 1, start: { x: 200, y: 100 }, end: { x: 200, y: 260 }, midpoint: { x: 200, y: 180 } },
        ],
      ],
      [
        'e2',
        [
          { index: 0, start: { x: 50, y: 100 }, end: { x: 150, y: 100 }, midpoint: { x: 100, y: 100 } },
        ],
      ],
      [
        'e3',
        [
          { index: 0, start: { x: 80, y: 100.4 }, end: { x: 180, y: 100.4 }, midpoint: { x: 130, y: 100.4 } },
          { index: 1, start: { x: 200, y: 140 }, end: { x: 200, y: 220 }, midpoint: { x: 200, y: 180 } },
        ],
      ],
      [
        'e-parallel-gap',
        [
          { index: 0, start: { x: 0, y: 108 }, end: { x: 200, y: 108 }, midpoint: { x: 100, y: 108 } },
        ],
      ],
      [
        'e-self-repeat',
        [
          { index: 0, start: { x: 0, y: 300 }, end: { x: 100, y: 300 }, midpoint: { x: 50, y: 300 } },
          { index: 1, start: { x: 20, y: 300 }, end: { x: 120, y: 300 }, midpoint: { x: 70, y: 300 } },
        ],
      ],
      [
        'd1',
        [
          { index: 0, start: { x: 0, y: 0 }, end: { x: 100, y: 100 }, midpoint: { x: 50, y: 50 } },
        ],
      ],
      [
        'd2',
        [
          { index: 0, start: { x: 20, y: 20 }, end: { x: 80, y: 80 }, midpoint: { x: 50, y: 50 } },
        ],
      ],
    ]);

    const overlaps = computeEdgeOverlaps(segMap);
    const seg2Way = overlaps.find((o) => Math.abs(o.start.x - 50) < 1 && Math.abs(o.end.x - 80) < 1);
    const seg3Way = overlaps.find((o) => Math.abs(o.start.x - 80) < 1 && Math.abs(o.end.x - 150) < 1);
    const segVert = overlaps.find((o) => Math.abs(o.start.x - 200) < 1 && Math.abs(o.start.y - 140) < 1);
    const segDiag = overlaps.find((o) => o.edgeIds.includes('d1') && o.edgeIds.includes('d2'));

    expect(seg2Way?.count).toBe(2);
    expect(seg3Way?.count).toBe(3);
    expect(segVert?.count).toBe(2);
    expect(segDiag?.count).toBe(2);
    expect(overlaps.some((o) => o.edgeIds.includes('e-self-repeat'))).toBe(false);
    expect(overlaps.some((o) => o.edgeIds.includes('e-parallel-gap'))).toBe(false);

    expect(computeOverlapStrokeWidth(1.5, 2)).toBe(2.9);
    expect(computeOverlapStrokeWidth(1.5, 3)).toBe(4.3);
    expect(computeOverlapStrokeWidth(1.5, 20)).toBe(10);
    expect(pickOverlapRepresentative(['e1', 'e2', 'e3'], new Set(['e3']))).toBe('e3');
    expect(pickOverlapRepresentative(['e1', 'e2', 'e3'])).toBe('e1');
  });

  it('tracks overlaps via EdgeRoutingManager and clears them on unregisterEdge and reset', async () => {
    let notified = 0;
    const unsub = manager.subscribeOverlaps(() => {
      notified++;
    });

    manager.registerEdgeSegments('edge-a', [
      { index: 0, start: { x: 10, y: 50 }, end: { x: 200, y: 50 }, midpoint: { x: 105, y: 50 } },
    ]);
    manager.registerEdgeSegments('edge-b', [
      { index: 0, start: { x: 60, y: 50 }, end: { x: 160, y: 50 }, midpoint: { x: 110, y: 50 } },
    ]);

    expect(manager.getOverlapsForEdge('edge-a')).toHaveLength(1);
    expect(manager.getOverlapsForEdge('edge-b')[0].count).toBe(2);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(notified).toBeGreaterThanOrEqual(1);

    manager.unregisterEdge('edge-b');
    expect(manager.getOverlapsForEdge('edge-a')).toHaveLength(0);

    manager.registerEdgeSegments('edge-c', [
      { index: 0, start: { x: 60, y: 50 }, end: { x: 160, y: 50 }, midpoint: { x: 110, y: 50 } },
    ]);
    expect(manager.getOverlapsForEdge('edge-a')).toHaveLength(1);

    manager.reset();
    expect(manager.getAllOverlaps()).toHaveLength(0);
    unsub();
  });

  it('normalizes misaligned manualWaypoints into strictly orthogonal segments', () => {
    const route = manager.routeEdge({
      id: 'misaligned-edge',
      source: { x: 568.3, y: 272.7 },
      target: { x: 740, y: 340 },
      sourcePosition: 'bottom',
      targetPosition: 'top',
      manualWaypoints: [
        { x: 545, y: 313 },
        { x: 740, y: 313 },
      ],
    });

    expect(route.segments.length).toBeGreaterThanOrEqual(2);
    for (const seg of route.segments) {
      const dx = Math.abs(seg.end.x - seg.start.x);
      const dy = Math.abs(seg.end.y - seg.start.y);
      expect(dx < 0.5 || dy < 0.5).toBe(true);
    }
  });
});

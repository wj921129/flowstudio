import { describe, it, expect, beforeEach } from 'vitest';
import { EdgeRoutingManager } from '../src/features/canvas/custom-edges/edge-routing-manager';
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
});

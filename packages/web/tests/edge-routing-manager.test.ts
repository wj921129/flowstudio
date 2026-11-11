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
});

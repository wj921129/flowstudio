import { describe, it, expect } from 'vitest';
import type { FlowNode } from '@flowstudio/shared';
import { EdgeRoutingManager } from '../src/features/canvas/custom-edges/edge-routing-manager';
import { isSegmentIntersectingBox } from '../src/features/canvas/custom-edges/obstacle-avoidance-router';

describe('Obstacle Avoidance & Bridge Jump End-to-End Suite', () => {
  it('handles 50+ nodes dense topology and avoids collision rate by >90%', () => {
    const manager = EdgeRoutingManager.getInstance();
    manager.clear();

    const nodes: FlowNode[] = [];
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 9; col++) {
        nodes.push({
          id: `node-${row}-${col}`,
          type: 'process',
          position: { x: col * 120 + 50, y: row * 100 + 50 },
          data: { label: `Node ${row}-${col}`, type: 'process' },
          width: 80,
          height: 40,
        });
      }
    }

    expect(nodes.length).toBe(54);
    manager.updateNodes(nodes);

    const source = { x: 130, y: 170 };
    const target = { x: 890, y: 170 };

    const route = manager.routeEdge({
      id: 'cross-edge',
      source,
      target,
      sourcePosition: 'right',
      targetPosition: 'left',
      sourceNodeId: 'node-1-0',
      targetNodeId: 'node-1-7',
    });

    expect(route.waypoints.length).toBeGreaterThanOrEqual(2);

    const fullPath = [source, ...route.waypoints, target];
    const obstacles = manager.getObstacles().filter(
      (o) => o.id !== 'node-1-0' && o.id !== 'node-1-7'
    );

    let collisions = 0;
    for (let i = 0; i < fullPath.length - 1; i++) {
      for (const obs of obstacles) {
        if (isSegmentIntersectingBox(fullPath[i], fullPath[i + 1], obs, 0)) {
          collisions++;
        }
      }
    }

    expect(collisions).toBe(0);
  });

  it('guarantees 100% micro-arc bridge jump on intersecting orthogonal edges', () => {
    const manager = EdgeRoutingManager.getInstance();
    manager.clear();

    manager.routeEdge({
      id: 'h1',
      source: { x: 50, y: 200 },
      target: { x: 400, y: 200 },
      sourcePosition: 'right',
      targetPosition: 'left',
    });

    manager.routeEdge({
      id: 'h2',
      source: { x: 50, y: 300 },
      target: { x: 400, y: 300 },
      sourcePosition: 'right',
      targetPosition: 'left',
    });

    const vRoute = manager.routeEdge({
      id: 'v1',
      source: { x: 200, y: 100 },
      target: { x: 200, y: 400 },
      sourcePosition: 'bottom',
      targetPosition: 'top',
    });

    const arcCount = (vRoute.path.match(/A 5 5 0 0 0/g) || []).length;
    expect(arcCount).toBe(2);
    expect(vRoute.path).toContain('L 200 195 A 5 5 0 0 0 200 205');
    expect(vRoute.path).toContain('L 200 295 A 5 5 0 0 0 200 305');
  });

  it('maintains high throughput in drag loop within RAF budget (<16ms)', () => {
    const manager = EdgeRoutingManager.getInstance();
    manager.clear();

    const nodes: FlowNode[] = [];
    for (let i = 0; i < 50; i++) {
      nodes.push({
        id: `node-${i}`,
        type: 'process',
        position: { x: (i % 10) * 120, y: Math.floor(i / 10) * 80 },
        data: { label: `N${i}`, type: 'process' },
        width: 80,
        height: 40,
      });
    }
    manager.updateNodes(nodes);

    const start = performance.now();
    for (let frame = 0; frame < 60; frame++) {
      manager.routeEdge({
        id: 'bench-edge',
        source: { x: 100, y: 100 + frame },
        target: { x: 500, y: 300 },
        sourcePosition: 'right',
        targetPosition: 'left',
      });
    }
    const elapsed = performance.now() - start;

    expect(elapsed / 60).toBeLessThan(16);
  });
});

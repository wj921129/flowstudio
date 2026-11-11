import { describe, it, expect } from 'vitest';
import {
  isSegmentIntersectingBox,
  isPointInsideObstacle,
  buildRoutingGrid,
  findObstacleAvoidingPath,
  findSafeLabelPosition,
  computeOptimalHandles,
  type ObstacleBox,
} from '../src/features/canvas/custom-edges/obstacle-avoidance-router';
import { buildWaypointPath } from '../src/features/canvas/custom-edges/waypoint-path-utils';

describe('obstacle-avoidance-router', () => {
  it('correctly detects segment intersecting obstacle box', () => {
    const box: ObstacleBox = { id: 'node1', x: 100, y: 100, width: 80, height: 60 };
    expect(isSegmentIntersectingBox({ x: 50, y: 120 }, { x: 250, y: 120 }, box, 4)).toBe(true);
    expect(isSegmentIntersectingBox({ x: 120, y: 50 }, { x: 120, y: 200 }, box, 4)).toBe(true);
    expect(isSegmentIntersectingBox({ x: 50, y: 50 }, { x: 250, y: 50 }, box, 4)).toBe(false);
    expect(isSegmentIntersectingBox({ x: 50, y: 120 }, { x: 80, y: 120 }, box, 4)).toBe(false);
  });

  it('correctly checks point inside obstacle', () => {
    const box: ObstacleBox = { id: 'node1', x: 100, y: 100, width: 80, height: 60 };
    expect(isPointInsideObstacle({ x: 120, y: 120 }, [box])).toBe(true);
    expect(isPointInsideObstacle({ x: 50, y: 50 }, [box])).toBe(false);
  });

  it('falls back to default orthogonal waypoints when no obstacles collide', () => {
    const source = { x: 50, y: 100 };
    const target = { x: 300, y: 200 };
    const boxAway: ObstacleBox = { id: 'node-far', x: 500, y: 500, width: 80, height: 60 };

    const waypoints = findObstacleAvoidingPath(source, target, 'right', 'left', [boxAway]);
    expect(waypoints.length).toBe(2);
    expect(waypoints[0].x).toBe(175);
    expect(waypoints[1].x).toBe(175);
  });

  it('routes around an obstacle blocking the direct orthogonal line', () => {
    const source = { x: 50, y: 100 };
    const target = { x: 400, y: 100 };
    const obstacle: ObstacleBox = { id: 'blocking-node', x: 180, y: 70, width: 80, height: 60 };

    const waypoints = findObstacleAvoidingPath(source, target, 'right', 'left', [obstacle], { padding: 10 });
    expect(waypoints.length).toBeGreaterThanOrEqual(2);

    const fullPath = [source, ...waypoints, target];
    for (let i = 0; i < fullPath.length - 1; i++) {
      expect(isSegmentIntersectingBox(fullPath[i], fullPath[i + 1], obstacle, 2)).toBe(false);
    }
  });

  it('optimally computes handles based on relative bounding box positions', () => {
    const nodeA: ObstacleBox = { id: 'a', x: 50, y: 100, width: 80, height: 40 };
    const nodeB: ObstacleBox = { id: 'b', x: 300, y: 100, width: 80, height: 40 };
    const handlesH = computeOptimalHandles(nodeA, nodeB);
    expect(handlesH.sourcePosition).toBe('right');
    expect(handlesH.targetPosition).toBe('left');

    const nodeC: ObstacleBox = { id: 'c', x: 50, y: 300, width: 80, height: 40 };
    const handlesV = computeOptimalHandles(nodeA, nodeC);
    expect(handlesV.sourcePosition).toBe('bottom');
    expect(handlesV.targetPosition).toBe('top');
  });

  it('places edge label away from obstacle collisions and corners', () => {
    const source = { x: 50, y: 100 };
    const target = { x: 350, y: 100 };
    const res = buildWaypointPath(source, target, []);
    const obstacle: ObstacleBox = { id: 'obs', x: 180, y: 90, width: 50, height: 30 };

    const safePos = findSafeLabelPosition(res.segments, [obstacle], { width: 40, height: 20 });
    const isOverlapping =
      safePos.x + 20 > obstacle.x &&
      safePos.x - 20 < obstacle.x + obstacle.width &&
      safePos.y + 10 > obstacle.y &&
      safePos.y - 10 < obstacle.y + obstacle.height;

    expect(isOverlapping).toBe(false);
  });
});

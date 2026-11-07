import { describe, it, expect } from 'vitest';
import {
  buildWaypointPath,
  deriveDefaultOrthogonalWaypoints,
} from '../src/features/canvas/custom-edges/waypoint-path-utils.js';

describe('waypoint-path-utils: Orthogonal Edge Waypoints and Routing', () => {
  it('builds orthogonal SVG path string from source, waypoints, and target', () => {
    const source = { x: 50, y: 100 };
    const target = { x: 400, y: 300 };
    const waypoints = [
      { x: 200, y: 100 },
      { x: 200, y: 300 },
    ];

    const result = buildWaypointPath(source, target, waypoints);

    expect(result.path).toBe('M 50 100 L 200 100 L 200 300 L 400 300');
    expect(result.segments.length).toBe(3);

    // 第一段：(50, 100) -> (200, 100)，中点为 (125, 100)
    expect(result.segments[0].midpoint).toEqual({ x: 125, y: 100 });
    // 第二段：(200, 100) -> (200, 300)，中点为 (200, 200)
    expect(result.segments[1].midpoint).toEqual({ x: 200, y: 200 });
    // 第三段：(200, 300) -> (400, 300)，中点为 (300, 300)
    expect(result.segments[2].midpoint).toEqual({ x: 300, y: 300 });

    // 标签应落在中间线段 (200, 200) 附近
    expect(result.labelPosition).toEqual({ x: 200, y: 200 });
  });

  it('derives default orthogonal waypoints between two arbitrary points', () => {
    const source = { x: 100, y: 50 };
    const target = { x: 300, y: 250 };

    const derived = deriveDefaultOrthogonalWaypoints(source, target);

    // 中间 X 轴为 200
    expect(derived.length).toBe(2);
    expect(derived[0]).toEqual({ x: 200, y: 50 });
    expect(derived[1]).toEqual({ x: 200, y: 250 });

    const pathRes = buildWaypointPath(source, target, derived);
    expect(pathRes.path).toBe('M 100 50 L 200 50 L 200 250 L 300 250');
  });

  it('handles empty waypoints list gracefully', () => {
    const source = { x: 0, y: 0 };
    const target = { x: 100, y: 100 };

    const result = buildWaypointPath(source, target, []);
    expect(result.path).toBe('M 0 0 L 100 100');
    expect(result.segments.length).toBe(1);
    expect(result.labelPosition).toEqual({ x: 50, y: 50 });
  });
});

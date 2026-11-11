import { describe, it, expect } from 'vitest';
import {
  extractHorizontalSegments,
  buildBridgeJumpPath,
  type HorizontalSegment,
} from '../src/features/canvas/custom-edges/bridge-jump-utils';
import { buildWaypointPath } from '../src/features/canvas/custom-edges/waypoint-path-utils';

describe('bridge-jump-utils', () => {
  it('extracts horizontal segments from path segments', () => {
    const res = buildWaypointPath({ x: 50, y: 100 }, { x: 300, y: 200 }, [
      { x: 150, y: 100 },
      { x: 150, y: 200 },
    ]);
    const hSegs = extractHorizontalSegments('edge1', res.segments);

    expect(hSegs.length).toBe(2);
    expect(hSegs[0]).toEqual({ edgeId: 'edge1', y: 100, minX: 50, maxX: 150 });
    expect(hSegs[1]).toEqual({ edgeId: 'edge1', y: 200, minX: 150, maxX: 300 });
  });

  it('draws smooth line when there are no intersections', () => {
    const res = buildWaypointPath({ x: 100, y: 50 }, { x: 100, y: 250 }, []);
    const path = buildBridgeJumpPath(res.segments, []);
    expect(path).toBe('M 100 50 L 100 250');
  });

  it('inserts micro-arc bridge jump when vertical segment crosses a horizontal line', () => {
    const res = buildWaypointPath({ x: 100, y: 50 }, { x: 100, y: 250 }, []);
    const otherHorizontal: HorizontalSegment[] = [
      { edgeId: 'edge-cross', y: 150, minX: 20, maxX: 200 },
    ];

    const path = buildBridgeJumpPath(res.segments, otherHorizontal, 5);
    expect(path).toBe('M 100 50 L 100 145 A 5 5 0 0 0 100 155 L 100 250');
  });

  it('handles upwards vertical line crossing horizontal line correctly', () => {
    const res = buildWaypointPath({ x: 100, y: 250 }, { x: 100, y: 50 }, []);
    const otherHorizontal: HorizontalSegment[] = [
      { edgeId: 'edge-cross', y: 150, minX: 20, maxX: 200 },
    ];

    const path = buildBridgeJumpPath(res.segments, otherHorizontal, 5);
    expect(path).toBe('M 100 250 L 100 155 A 5 5 0 0 0 100 145 L 100 50');
  });

  it('filters out redundant intersections when crossings are too close together', () => {
    const res = buildWaypointPath({ x: 100, y: 50 }, { x: 100, y: 250 }, []);
    const otherHorizontal: HorizontalSegment[] = [
      { edgeId: 'e1', y: 150, minX: 20, maxX: 200 },
      { edgeId: 'e2', y: 152, minX: 20, maxX: 200 },
    ];

    const path = buildBridgeJumpPath(res.segments, otherHorizontal, 5);
    expect(path).toBe('M 100 50 L 100 145 A 5 5 0 0 0 100 155 L 100 250');
  });
});

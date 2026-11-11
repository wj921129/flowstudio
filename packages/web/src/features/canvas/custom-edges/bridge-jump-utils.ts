import type { XYPosition } from '@flowstudio/shared';
import type { PathSegment } from './waypoint-path-utils';

export interface HorizontalSegment {
  edgeId: string;
  y: number;
  minX: number;
  maxX: number;
}

export function simplifyCollinearSegments(segments: PathSegment[]): PathSegment[] {
  const nonZero = segments.filter(
    (s) => Math.hypot(s.start.x - s.end.x, s.start.y - s.end.y) > 0.001
  );
  if (nonZero.length <= 1) return nonZero;

  const merged: PathSegment[] = [];
  let curr = { ...nonZero[0] };

  for (let i = 1; i < nonZero.length; i++) {
    const next = nonZero[i];
    const currH = Math.abs(curr.start.y - curr.end.y) < 0.001 && Math.abs(next.start.y - next.end.y) < 0.001 && Math.abs(curr.end.y - next.start.y) < 0.001;
    const currV = Math.abs(curr.start.x - curr.end.x) < 0.001 && Math.abs(next.start.x - next.end.x) < 0.001 && Math.abs(curr.end.x - next.start.x) < 0.001;

    if (currH || currV) {
      curr.end = next.end;
      curr.midpoint = {
        x: (curr.start.x + next.end.x) / 2,
        y: (curr.start.y + next.end.y) / 2,
      };
    } else {
      merged.push(curr);
      curr = { ...next };
    }
  }
  merged.push(curr);
  return merged;
}

export function extractHorizontalSegments(
  edgeId: string,
  segments: PathSegment[]
): HorizontalSegment[] {
  const simplified = simplifyCollinearSegments(segments);
  const result: HorizontalSegment[] = [];
  for (const s of simplified) {
    if (Math.abs(s.start.y - s.end.y) < 0.001 && Math.abs(s.start.x - s.end.x) > 2) {
      result.push({
        edgeId,
        y: s.start.y,
        minX: Math.min(s.start.x, s.end.x),
        maxX: Math.max(s.start.x, s.end.x),
      });
    }
  }
  return result;
}

export function buildBridgeJumpPath(
  segments: PathSegment[],
  otherHorizontalSegments: HorizontalSegment[],
  jumpRadius: number = 5
): string {
  if (segments.length === 0) return '';
  const simplified = simplifyCollinearSegments(segments);
  if (simplified.length === 0) return '';

  let path = `M ${simplified[0].start.x} ${simplified[0].start.y}`;

  for (const seg of simplified) {
    const isVertical = Math.abs(seg.start.x - seg.end.x) < 0.001;

    if (!isVertical) {
      path += ` L ${seg.end.x} ${seg.end.y}`;
      continue;
    }

    const vx = seg.start.x;
    const y1 = seg.start.y;
    const y2 = seg.end.y;
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    const goingDown = y2 > y1;

    const intersections: number[] = [];
    for (const hSeg of otherHorizontalSegments) {
      if (hSeg.minX + 3 < vx && vx < hSeg.maxX - 3) {
        if (minY + jumpRadius + 1 < hSeg.y && hSeg.y < maxY - jumpRadius - 1) {
          intersections.push(hSeg.y);
        }
      }
    }

    if (intersections.length === 0) {
      path += ` L ${seg.end.x} ${seg.end.y}`;
      continue;
    }

    if (goingDown) {
      intersections.sort((a, b) => a - b);
    } else {
      intersections.sort((a, b) => b - a);
    }

    const filtered: number[] = [];
    for (const iy of intersections) {
      if (
        filtered.length === 0 ||
        Math.abs(iy - filtered[filtered.length - 1]) > jumpRadius * 2 + 2
      ) {
        filtered.push(iy);
      }
    }

    for (const iy of filtered) {
      const approachY = goingDown ? iy - jumpRadius : iy + jumpRadius;
      const leaveY = goingDown ? iy + jumpRadius : iy - jumpRadius;
      path += ` L ${vx} ${approachY}`;
      path += ` A ${jumpRadius} ${jumpRadius} 0 0 0 ${vx} ${leaveY}`;
    }

    path += ` L ${vx} ${y2}`;
  }

  return path;
}

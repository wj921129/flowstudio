import type { XYPosition } from '@flowstudio/shared';
import type { PathSegment } from './waypoint-path-utils';
import { simplifyCollinearSegments } from './bridge-jump-utils';

export const OVERLAP_COORD_TOLERANCE = 1;
export const OVERLAP_MIN_LENGTH = 1;
export const OVERLAP_MAX_STROKE_WIDTH = 10;
export const OVERLAP_STEP_STROKE_WIDTH = 1.4;

export interface EdgeOverlapSegment {
  key: string;
  start: XYPosition;
  end: XYPosition;
  count: number;
  edgeIds: string[];
}

interface BucketEntry {
  edgeId: string;
  minT: number;
  maxT: number;
  coordSum: number;
  coordCount: number;
}

interface DiagonalBucket {
  ux: number;
  uy: number;
  nx: number;
  ny: number;
  entries: BucketEntry[];
}

function mergeEdgeIntervals(entries: BucketEntry[]): BucketEntry[] {
  const byEdge = new Map<string, BucketEntry[]>();
  for (const e of entries) {
    let list = byEdge.get(e.edgeId);
    if (!list) {
      list = [];
      byEdge.set(e.edgeId, list);
    }
    list.push(e);
  }

  const merged: BucketEntry[] = [];
  for (const [edgeId, list] of byEdge.entries()) {
    list.sort((a, b) => a.minT - b.minT);
    let cur = { ...list[0], edgeId };
    for (let i = 1; i < list.length; i++) {
      const next = list[i];
      if (next.minT <= cur.maxT + 0.5) {
        cur.maxT = Math.max(cur.maxT, next.maxT);
        cur.coordSum += next.coordSum;
        cur.coordCount += next.coordCount;
      } else {
        merged.push(cur);
        cur = { ...next, edgeId };
      }
    }
    merged.push(cur);
  }
  return merged;
}

function scanBucketIntervals(
  entries: BucketEntry[],
  makePoint: (t: number, avgCoord: number) => XYPosition,
  prefix: string
): EdgeOverlapSegment[] {
  const merged = mergeEdgeIntervals(entries);
  if (merged.length < 2) return [];

  const coordsSet = new Set<number>();
  for (const e of merged) {
    coordsSet.add(e.minT);
    coordsSet.add(e.maxT);
  }
  const coords = Array.from(coordsSet).sort((a, b) => a - b);
  if (coords.length < 2) return [];

  const rawPieces: Array<{
    minT: number;
    maxT: number;
    avgCoord: number;
    edgeIds: string[];
    edgeKey: string;
  }> = [];

  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    if (b - a <= OVERLAP_MIN_LENGTH) continue;
    const mid = (a + b) / 2;

    const covering: string[] = [];
    let coordSum = 0;
    let coordCount = 0;
    for (const e of merged) {
      if (e.minT <= mid && mid <= e.maxT) {
        covering.push(e.edgeId);
        coordSum += e.coordSum;
        coordCount += e.coordCount;
      }
    }
    if (covering.length < 2) continue;

    covering.sort();
    const edgeKey = covering.join(',');
    const avgCoord = coordCount > 0 ? coordSum / coordCount : 0;

    const prev = rawPieces[rawPieces.length - 1];
    if (prev && Math.abs(prev.maxT - a) <= 0.5 && prev.edgeKey === edgeKey) {
      prev.maxT = b;
      prev.avgCoord = (prev.avgCoord + avgCoord) / 2;
    } else {
      rawPieces.push({
        minT: a,
        maxT: b,
        avgCoord,
        edgeIds: covering,
        edgeKey,
      });
    }
  }

  return rawPieces.map((p) => {
    const start = makePoint(p.minT, p.avgCoord);
    const end = makePoint(p.maxT, p.avgCoord);
    return {
      key: `${prefix}:${Math.round(p.minT * 10)}:${Math.round(p.maxT * 10)}:${p.edgeKey}`,
      start,
      end,
      count: p.edgeIds.length,
      edgeIds: p.edgeIds,
    };
  });
}

export function computeEdgeOverlaps(
  edgeSegmentsMap: Map<string, PathSegment[]>
): EdgeOverlapSegment[] {
  const hBuckets = new Map<number, BucketEntry[]>();
  const vBuckets = new Map<number, BucketEntry[]>();
  const dBuckets = new Map<string, DiagonalBucket>();

  for (const [edgeId, rawSegments] of edgeSegmentsMap.entries()) {
    if (!rawSegments || rawSegments.length === 0) continue;
    const segments = simplifyCollinearSegments(rawSegments);
    for (const seg of segments) {
      const dx = seg.end.x - seg.start.x;
      const dy = seg.end.y - seg.start.y;
      const len = Math.hypot(dx, dy);
      if (len <= OVERLAP_MIN_LENGTH) continue;

      if (Math.abs(dy) <= 0.5) {
        const y = (seg.start.y + seg.end.y) / 2;
        const bucketKey = Math.round(y / OVERLAP_COORD_TOLERANCE);
        let list = hBuckets.get(bucketKey);
        if (!list) {
          list = [];
          hBuckets.set(bucketKey, list);
        }
        list.push({
          edgeId,
          minT: Math.min(seg.start.x, seg.end.x),
          maxT: Math.max(seg.start.x, seg.end.x),
          coordSum: y,
          coordCount: 1,
        });
      } else if (Math.abs(dx) <= 0.5) {
        const x = (seg.start.x + seg.end.x) / 2;
        const bucketKey = Math.round(x / OVERLAP_COORD_TOLERANCE);
        let list = vBuckets.get(bucketKey);
        if (!list) {
          list = [];
          vBuckets.set(bucketKey, list);
        }
        list.push({
          edgeId,
          minT: Math.min(seg.start.y, seg.end.y),
          maxT: Math.max(seg.start.y, seg.end.y),
          coordSum: x,
          coordCount: 1,
        });
      } else {
        let ux = dx / len;
        let uy = dy / len;
        if (ux < 0 || (Math.abs(ux) < 1e-6 && uy < 0)) {
          ux = -ux;
          uy = -uy;
        }
        const nx = -uy;
        const ny = ux;
        const angle = Math.atan2(uy, ux);
        const angleBucket = Math.round(angle * 100);
        const d = nx * seg.start.x + ny * seg.start.y;
        const distBucket = Math.round(d / OVERLAP_COORD_TOLERANCE);
        const bucketKey = `${angleBucket}:${distBucket}`;
        let bucket = dBuckets.get(bucketKey);
        if (!bucket) {
          bucket = { ux, uy, nx, ny, entries: [] };
          dBuckets.set(bucketKey, bucket);
        }
        const t1 = ux * seg.start.x + uy * seg.start.y;
        const t2 = ux * seg.end.x + uy * seg.end.y;
        const dMid = nx * ((seg.start.x + seg.end.x) / 2) + ny * ((seg.start.y + seg.end.y) / 2);
        bucket.entries.push({
          edgeId,
          minT: Math.min(t1, t2),
          maxT: Math.max(t1, t2),
          coordSum: dMid,
          coordCount: 1,
        });
      }
    }
  }

  const results: EdgeOverlapSegment[] = [];

  for (const [bKey, entries] of hBuckets.entries()) {
    results.push(
      ...scanBucketIntervals(entries, (t, y) => ({ x: t, y }), `h:${bKey}`)
    );
  }
  for (const [bKey, entries] of vBuckets.entries()) {
    results.push(
      ...scanBucketIntervals(entries, (t, x) => ({ x, y: t }), `v:${bKey}`)
    );
  }
  for (const [bKey, bucket] of dBuckets.entries()) {
    results.push(
      ...scanBucketIntervals(
        bucket.entries,
        (t, d) => ({
          x: bucket.ux * t + bucket.nx * d,
          y: bucket.uy * t + bucket.ny * d,
        }),
        `d:${bKey}`
      )
    );
  }

  return results;
}

export function computeOverlapStrokeWidth(baseWidth: number, count: number): number {
  if (count < 2) return baseWidth;
  return Math.min(
    OVERLAP_MAX_STROKE_WIDTH,
    Math.round((baseWidth + (count - 1) * OVERLAP_STEP_STROKE_WIDTH) * 10) / 10
  );
}

export function pickOverlapRepresentative(
  edgeIds: string[],
  priorityIds?: ReadonlySet<string>
): string {
  if (priorityIds && priorityIds.size > 0) {
    for (const id of edgeIds) {
      if (priorityIds.has(id)) return id;
    }
  }
  return edgeIds[0] ?? '';
}

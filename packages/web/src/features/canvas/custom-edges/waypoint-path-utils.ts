/**
 * @fileoverview 直角连线折点 (Waypoints) 几何计算工具
 * @description 支持多折拐点路径生成、段中点提取与折点更新
 */

import {
  getNodeRegistryEntry,
  projectPointToNodeBorder,
  formatBorderAnchorHandle,
  type BorderSide,
  type FlowNode,
  type XYPosition,
} from '@flowstudio/shared';

/**
 * 连线端点所依附的节点锚点方位（与 @xyflow/react 的 Position 枚举字面量一致）
 */
export type EdgeAnchorDirection = 'left' | 'right' | 'top' | 'bottom';

export interface PathSegment {
  index: number;
  start: XYPosition;
  end: XYPosition;
  midpoint: XYPosition;
}

/**
 * 根据源点、目标点及用户折点列表生成正交折线 SVG Path
 */
export function buildWaypointPath(
  source: XYPosition,
  target: XYPosition,
  waypoints?: XYPosition[]
): {
  path: string;
  labelPosition: XYPosition;
  segments: PathSegment[];
} {
  const points: XYPosition[] = [source, ...(waypoints || []), target];

  let pathString = `M ${points[0].x} ${points[0].y}`;
  const segments: PathSegment[] = [];

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    pathString += ` L ${curr.x} ${curr.y}`;
    segments.push({
      index: i - 1,
      start: prev,
      end: curr,
      midpoint: {
        x: (prev.x + curr.x) / 2,
        y: (prev.y + curr.y) / 2,
      },
    });
  }

  // 计算连线中点作为标签位置
  const midSegmentIndex = Math.floor(segments.length / 2);
  const midSegment = segments[midSegmentIndex] || segments[0];
  const labelPosition = midSegment ? midSegment.midpoint : { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 };

  return {
    path: pathString,
    labelPosition,
    segments,
  };
}

/**
 * 从默认起点和终点派生初始正交拐点
 *
 * 派生结果必须与自动走线 (getSmoothStepPath) 的拐点位置一致，否则用户点击"调折点"
 * 的瞬间线形会跳变；因此按两端锚点方位分三种情形构造：
 * 同横轴取 midX 双拐点、同纵轴取 midY 双拐点、横竖混合取单拐点。
 */
export function deriveDefaultOrthogonalWaypoints(
  source: XYPosition,
  target: XYPosition,
  sourcePosition?: EdgeAnchorDirection,
  targetPosition?: EdgeAnchorDirection
): XYPosition[] {
  const sourceHorizontal = sourcePosition === 'left' || sourcePosition === 'right';
  const sourceVertical = sourcePosition === 'top' || sourcePosition === 'bottom';
  const targetHorizontal = targetPosition === 'left' || targetPosition === 'right';
  const targetVertical = targetPosition === 'top' || targetPosition === 'bottom';

  if (sourceVertical && targetVertical) {
    const midY = (source.y + target.y) / 2;
    return [
      { x: source.x, y: midY },
      { x: target.x, y: midY },
    ];
  }

  if (sourceHorizontal && targetVertical) {
    return [{ x: target.x, y: source.y }];
  }

  if (sourceVertical && targetHorizontal) {
    return [{ x: source.x, y: target.y }];
  }

  const midX = (source.x + target.x) / 2;
  return [
    { x: midX, y: source.y },
    { x: midX, y: target.y },
  ];
}

export function getPointAtPolylineRatio(points: XYPosition[], ratio: number): XYPosition {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];
  const clamped = Math.max(0, Math.min(1, ratio));
  let total = 0;
  const lengths: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    lengths.push(len);
    total += len;
  }
  if (total <= 0) return points[0];
  let remain = total * clamped;
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i];
    if (remain <= len || i === lengths.length - 1) {
      const t = len > 0 ? remain / len : 0;
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
      };
    }
    remain -= len;
  }
  return points[points.length - 1];
}

export function projectPointOntoPolyline(
  points: XYPosition[],
  cursor: XYPosition
): { point: XYPosition; ratio: number } {
  if (points.length === 0) return { point: cursor, ratio: 0.5 };
  if (points.length === 1) return { point: points[0], ratio: 0.5 };
  let total = 0;
  const lengths: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    lengths.push(len);
    total += len;
  }
  if (total <= 0) return { point: points[0], ratio: 0.5 };

  let bestDistSq = Infinity;
  let bestPoint = points[0];
  let bestRatio = 0.5;
  let acc = 0;

  for (let i = 0; i < lengths.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = lengths[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq > 0 ? Math.max(0, Math.min(1, ((cursor.x - a.x) * dx + (cursor.y - a.y) * dy) / lenSq)) : 0;
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const distSq = (cursor.x - px) ** 2 + (cursor.y - py) ** 2;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestPoint = { x: px, y: py };
      bestRatio = (acc + len * t) / total;
    }
    acc += len;
  }

  return {
    point: bestPoint,
    ratio: Math.max(0.03, Math.min(0.97, Math.round(bestRatio * 1000) / 1000)),
  };
}

export type SegmentAxis = 'h' | 'v';

export const SEGMENT_MERGE_SNAP_THRESHOLD = 8;
export const MIN_ENDPOINT_STUB = 16;

export function getSegmentAxis(a: XYPosition, b: XYPosition): SegmentAxis | null {
  if (Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) >= 0.5) return 'h';
  if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) >= 0.5) return 'v';
  return null;
}

export function moveOrthogonalSegment(
  source: XYPosition,
  target: XYPosition,
  waypoints: XYPosition[],
  segIndex: number,
  offset: number,
  snapThreshold: number = SEGMENT_MERGE_SNAP_THRESHOLD,
  dragCursor?: XYPosition
): XYPosition[] {
  const pts = [source, ...waypoints, target].map((p) => ({ ...p }));
  const lastIndex = pts.length - 1;
  if (segIndex < 0 || segIndex >= lastIndex || offset === 0) {
    return waypoints.map((p) => ({ ...p }));
  }

  if (pts.length === 2 && segIndex === 0) {
    const axis = getSegmentAxis(source, target);
    if (axis === 'h') {
      const len = Math.abs(target.x - source.x);
      if (len < 2) return waypoints.map((p) => ({ ...p }));
      const stub = Math.min(MIN_ENDPOINT_STUB, Math.max(4, Math.floor(len / 4)));
      const dir = target.x >= source.x ? 1 : -1;
      const s1x = source.x + dir * stub;
      const t1x = target.x - dir * stub;
      const ny = source.y + offset;
      return [
        { x: s1x, y: source.y },
        { x: s1x, y: ny },
        { x: t1x, y: ny },
        { x: t1x, y: target.y },
      ];
    }
    if (axis === 'v') {
      const len = Math.abs(target.y - source.y);
      if (len < 2) return waypoints.map((p) => ({ ...p }));
      const stub = Math.min(MIN_ENDPOINT_STUB, Math.max(4, Math.floor(len / 4)));
      const dir = target.y >= source.y ? 1 : -1;
      const s1y = source.y + dir * stub;
      const t1y = target.y - dir * stub;
      const nx = source.x + offset;
      return [
        { x: source.x, y: s1y },
        { x: nx, y: s1y },
        { x: nx, y: t1y },
        { x: target.x, y: t1y },
      ];
    }
    const horizontalDominant = Math.abs(target.x - source.x) >= Math.abs(target.y - source.y);
    if (horizontalDominant) {
      const midX = (dragCursor?.x ?? (source.x + target.x) / 2) + offset;
      return [
        { x: midX, y: source.y },
        { x: midX, y: target.y },
      ];
    }
    const midY = (dragCursor?.y ?? (source.y + target.y) / 2) + offset;
    return [
      { x: source.x, y: midY },
      { x: target.x, y: midY },
    ];
  }

  if (segIndex === 0 && pts.length > 2) {
    const a = pts[0];
    const b = pts[1];
    const axis = getSegmentAxis(a, b);
    if (!axis) return waypoints.map((p) => ({ ...p }));
    const segLen = axis === 'h' ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
    const stub = Math.min(MIN_ENDPOINT_STUB, Math.max(4, Math.floor(segLen / 3)));
    const dir = axis === 'h' ? (b.x >= a.x ? 1 : -1) : (b.y >= a.y ? 1 : -1);
    let targetCoord = (axis === 'h' ? a.y : a.x) + offset;
    let snapped = false;
    if (snapThreshold > 0 && pts.length >= 4 && getSegmentAxis(pts[2], pts[3]) === axis) {
      const cand = axis === 'h' ? pts[2].y : pts[2].x;
      if (Math.abs(targetCoord - cand) <= snapThreshold) {
        targetCoord = cand;
        snapped = true;
      }
    }
    const nextWps =
      axis === 'h'
        ? [
            { x: a.x + dir * stub, y: a.y },
            { x: a.x + dir * stub, y: targetCoord },
            { x: b.x, y: targetCoord },
            ...pts.slice(2, lastIndex),
          ]
        : [
            { x: a.x, y: a.y + dir * stub },
            { x: targetCoord, y: a.y + dir * stub },
            { x: targetCoord, y: b.y },
            ...pts.slice(2, lastIndex),
          ];
    return snapped ? simplifyOrthogonalWaypoints(source, target, nextWps) : nextWps;
  }

  if (segIndex === lastIndex - 1 && pts.length > 2) {
    const a = pts[lastIndex - 1];
    const b = pts[lastIndex];
    const axis = getSegmentAxis(a, b);
    if (!axis) return waypoints.map((p) => ({ ...p }));
    const segLen = axis === 'h' ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
    const stub = Math.min(MIN_ENDPOINT_STUB, Math.max(4, Math.floor(segLen / 3)));
    const dir = axis === 'h' ? (a.x >= b.x ? 1 : -1) : (a.y >= b.y ? 1 : -1);
    let targetCoord = (axis === 'h' ? b.y : b.x) + offset;
    let snapped = false;
    if (snapThreshold > 0 && lastIndex - 3 >= 0 && getSegmentAxis(pts[lastIndex - 3], pts[lastIndex - 2]) === axis) {
      const cand = axis === 'h' ? pts[lastIndex - 2].y : pts[lastIndex - 2].x;
      if (Math.abs(targetCoord - cand) <= snapThreshold) {
        targetCoord = cand;
        snapped = true;
      }
    }
    const nextWps =
      axis === 'h'
        ? [
            ...pts.slice(1, lastIndex - 1),
            { x: a.x, y: targetCoord },
            { x: b.x + dir * stub, y: targetCoord },
            { x: b.x + dir * stub, y: b.y },
          ]
        : [
            ...pts.slice(1, lastIndex - 1),
            { x: targetCoord, y: a.y },
            { x: targetCoord, y: b.y + dir * stub },
            { x: b.x, y: b.y + dir * stub },
          ];
    return snapped ? simplifyOrthogonalWaypoints(source, target, nextWps) : nextWps;
  }

  const a = pts[segIndex];
  const b = pts[segIndex + 1];
  const axis = a && b ? getSegmentAxis(a, b) : null;
  if (!axis) return waypoints.map((p) => ({ ...p }));

  const currentCoord = axis === 'h' ? a.y : a.x;
  let targetCoord = currentCoord + offset;

  let snapped = false;
  if (snapThreshold > 0) {
    const candidates: number[] = [];
    if (segIndex - 2 >= 0 && getSegmentAxis(pts[segIndex - 2], pts[segIndex - 1]) === axis) {
      candidates.push(axis === 'h' ? pts[segIndex - 2].y : pts[segIndex - 2].x);
    }
    if (segIndex + 3 <= lastIndex && getSegmentAxis(pts[segIndex + 2], pts[segIndex + 3]) === axis) {
      candidates.push(axis === 'h' ? pts[segIndex + 2].y : pts[segIndex + 2].x);
    }
    let bestDist = snapThreshold;
    for (const cand of candidates) {
      const dist = Math.abs(targetCoord - cand);
      if (dist <= bestDist) {
        bestDist = dist;
        targetCoord = cand;
        snapped = true;
      }
    }
  }

  const applyCoord = (p: XYPosition): XYPosition =>
    axis === 'h' ? { x: p.x, y: targetCoord } : { x: targetCoord, y: p.y };
  pts[segIndex] = applyCoord(a);
  pts[segIndex + 1] = applyCoord(b);
  const next = pts.slice(1, lastIndex);
  return snapped ? simplifyOrthogonalWaypoints(source, target, next) : next;
}

export function simplifyOrthogonalWaypoints(
  source: XYPosition,
  target: XYPosition,
  waypoints: XYPosition[]
): XYPosition[] {
  const norm = (v: number) => Math.round(v * 100) / 100;
  const pts = [
    { x: norm(source.x), y: norm(source.y) },
    ...waypoints.map((p) => ({ x: norm(p.x), y: norm(p.y) })),
    { x: norm(target.x), y: norm(target.y) },
  ];
  const same = (a: number, b: number) => Math.abs(a - b) < 1;
  const out: XYPosition[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (i < pts.length - 1 && same(p.x, out[out.length - 1].x) && same(p.y, out[out.length - 1].y)) continue;
    while (out.length >= 2) {
      const prev = out[out.length - 1];
      const pp = out[out.length - 2];
      const dupPrev = same(p.x, prev.x) && same(p.y, prev.y);
      const colX = same(pp.x, prev.x) && same(prev.x, p.x);
      const colY = same(pp.y, prev.y) && same(prev.y, p.y);
      if (dupPrev || colX || colY) {
        out.pop();
      } else {
        break;
      }
    }
    if (i === pts.length - 1 || !same(p.x, out[out.length - 1].x) || !same(p.y, out[out.length - 1].y)) {
      out.push(p);
    }
  }
  return out.slice(1, -1);
}

export interface AdjustWaypointsOnNodeMoveParams {
  waypoints: XYPosition[];
  sourceDelta: XYPosition;
  targetDelta: XYPosition;
  sourceSide?: EdgeAnchorDirection;
  targetSide?: EdgeAnchorDirection;
  oldSource?: XYPosition;
  oldTarget?: XYPosition;
  newSource?: XYPosition;
  newTarget?: XYPosition;
  minStub?: number;
}

function sideToAxis(side?: EdgeAnchorDirection): SegmentAxis | null {
  if (side === 'left' || side === 'right') return 'h';
  if (side === 'top' || side === 'bottom') return 'v';
  return null;
}

function inferSegmentAxis(a: XYPosition, b: XYPosition): SegmentAxis | null {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dx < 0.5 && dy < 0.5) return null;
  if (dy <= dx) return 'h';
  return 'v';
}

export function adjustWaypointsOnNodeMove({
  waypoints,
  sourceDelta,
  targetDelta,
  sourceSide,
  targetSide,
  oldSource,
  oldTarget,
  newSource,
  newTarget,
  minStub = 16,
}: AdjustWaypointsOnNodeMoveParams): XYPosition[] {
  if (waypoints.length === 0) return [];
  const dxS = sourceDelta.x;
  const dyS = sourceDelta.y;
  const dxT = targetDelta.x;
  const dyT = targetDelta.y;
  if (Math.abs(dxS) < 1e-4 && Math.abs(dyS) < 1e-4 && Math.abs(dxT) < 1e-4 && Math.abs(dyT) < 1e-4) {
    return waypoints.map((p) => ({ ...p }));
  }

  if (Math.abs(dxS - dxT) < 1e-4 && Math.abs(dyS - dyT) < 1e-4) {
    return waypoints.map((p) => ({ x: p.x + dxS, y: p.y + dyS }));
  }

  const next = waypoints.map((p) => ({ ...p }));
  const last = next.length - 1;

  const firstAxis: SegmentAxis =
    sideToAxis(sourceSide) ??
    (oldSource ? inferSegmentAxis(oldSource, waypoints[0]) : null) ??
    (next.length >= 2 ? (inferSegmentAxis(waypoints[0], waypoints[1]) === 'h' ? 'v' : 'h') : null) ??
    (Math.abs(dxS) >= Math.abs(dyS) ? 'h' : 'v');

  const lastAxis: SegmentAxis =
    sideToAxis(targetSide) ??
    (oldTarget ? inferSegmentAxis(waypoints[last], oldTarget) : null) ??
    (next.length >= 2 ? (inferSegmentAxis(waypoints[last - 1], waypoints[last]) === 'h' ? 'v' : 'h') : null) ??
    (Math.abs(dxT) >= Math.abs(dyT) ? 'h' : 'v');

  if (next.length === 1 && firstAxis === lastAxis) {
    const p = next[0];
    if (firstAxis === 'h') {
      return Math.abs(dyS - dyT) > 1e-4
        ? [{ x: p.x, y: p.y + dyS }, { x: p.x, y: p.y + dyT }]
        : [{ x: p.x, y: p.y + dyS }];
    }
    return Math.abs(dxS - dxT) > 1e-4
      ? [{ x: p.x + dxS, y: p.y }, { x: p.x + dxT, y: p.y }]
      : [{ x: p.x + dxS, y: p.y }];
  }

  if (Math.abs(dxS) >= 1e-4 || Math.abs(dyS) >= 1e-4) {
    let prefixEnd = 0;
    const maxPrefix = next.length > 1 ? last - 1 : 0;
    while (prefixEnd < maxPrefix) {
      const segAxis = inferSegmentAxis(next[prefixEnd], next[prefixEnd + 1]);
      if (segAxis !== firstAxis) break;
      prefixEnd++;
    }
    if (firstAxis === 'h') {
      for (let i = 0; i <= prefixEnd; i++) next[i].y += dyS;
      if (newSource && prefixEnd + 1 <= last) {
        const segAfter = inferSegmentAxis(next[prefixEnd], next[prefixEnd + 1]);
        const segNext =
          prefixEnd + 2 <= last
            ? inferSegmentAxis(next[prefixEnd + 1], next[prefixEnd + 2])
            : newTarget
            ? inferSegmentAxis(next[prefixEnd + 1], newTarget)
            : null;
        if (segAfter === 'v' && (segNext === 'h' || (segNext === null && sideToAxis(targetSide) === 'h'))) {
          if (sourceSide === 'right' && dxS > 0 && next[prefixEnd].x < newSource.x + minStub) {
            const pushX = newSource.x + minStub;
            next[prefixEnd].x = pushX;
            next[prefixEnd + 1].x = pushX;
          } else if (sourceSide === 'left' && dxS < 0 && next[prefixEnd].x > newSource.x - minStub) {
            const pushX = newSource.x - minStub;
            next[prefixEnd].x = pushX;
            next[prefixEnd + 1].x = pushX;
          }
        }
      }
    } else {
      for (let i = 0; i <= prefixEnd; i++) next[i].x += dxS;
      if (newSource && prefixEnd + 1 <= last) {
        const segAfter = inferSegmentAxis(next[prefixEnd], next[prefixEnd + 1]);
        const segNext =
          prefixEnd + 2 <= last
            ? inferSegmentAxis(next[prefixEnd + 1], next[prefixEnd + 2])
            : newTarget
            ? inferSegmentAxis(next[prefixEnd + 1], newTarget)
            : null;
        if (segAfter === 'h' && (segNext === 'v' || (segNext === null && sideToAxis(targetSide) === 'v'))) {
          if (sourceSide === 'bottom' && dyS > 0 && next[prefixEnd].y < newSource.y + minStub) {
            const pushY = newSource.y + minStub;
            next[prefixEnd].y = pushY;
            next[prefixEnd + 1].y = pushY;
          } else if (sourceSide === 'top' && dyS < 0 && next[prefixEnd].y > newSource.y - minStub) {
            const pushY = newSource.y - minStub;
            next[prefixEnd].y = pushY;
            next[prefixEnd + 1].y = pushY;
          }
        }
      }
    }
  }

  if (Math.abs(dxT) >= 1e-4 || Math.abs(dyT) >= 1e-4) {
    let suffixStart = last;
    const minSuffix = next.length > 1 ? 1 : 0;
    while (suffixStart > minSuffix) {
      const segAxis = inferSegmentAxis(next[suffixStart - 1], next[suffixStart]);
      if (segAxis !== lastAxis) break;
      suffixStart--;
    }
    if (lastAxis === 'h') {
      for (let i = suffixStart; i <= last; i++) next[i].y += dyT;
      if (newTarget && suffixStart - 1 >= 0) {
        const segBefore = inferSegmentAxis(next[suffixStart - 1], next[suffixStart]);
        const segPrev =
          suffixStart - 2 >= 0
            ? inferSegmentAxis(next[suffixStart - 2], next[suffixStart - 1])
            : newSource
            ? inferSegmentAxis(newSource, next[suffixStart - 1])
            : null;
        if (segBefore === 'v' && (segPrev === 'h' || (segPrev === null && sideToAxis(sourceSide) === 'h'))) {
          if (targetSide === 'right' && dxT > 0 && next[suffixStart].x < newTarget.x + minStub) {
            const pushX = newTarget.x + minStub;
            next[suffixStart].x = pushX;
            next[suffixStart - 1].x = pushX;
          } else if (targetSide === 'left' && dxT < 0 && next[suffixStart].x > newTarget.x - minStub) {
            const pushX = newTarget.x - minStub;
            next[suffixStart].x = pushX;
            next[suffixStart - 1].x = pushX;
          }
        }
      }
    } else {
      for (let i = suffixStart; i <= last; i++) next[i].x += dxT;
      if (newTarget && suffixStart - 1 >= 0) {
        const segBefore = inferSegmentAxis(next[suffixStart - 1], next[suffixStart]);
        const segPrev =
          suffixStart - 2 >= 0
            ? inferSegmentAxis(next[suffixStart - 2], next[suffixStart - 1])
            : newSource
            ? inferSegmentAxis(newSource, next[suffixStart - 1])
            : null;
        if (segBefore === 'h' && (segPrev === 'v' || (segPrev === null && sideToAxis(sourceSide) === 'v'))) {
          if (targetSide === 'bottom' && dyT > 0 && next[suffixStart].y < newTarget.y + minStub) {
            const pushY = newTarget.y + minStub;
            next[suffixStart].y = pushY;
            next[suffixStart - 1].y = pushY;
          } else if (targetSide === 'top' && dyT < 0 && next[suffixStart].y > newTarget.y - minStub) {
            const pushY = newTarget.y - minStub;
            next[suffixStart].y = pushY;
            next[suffixStart - 1].y = pushY;
          }
        }
      }
    }
  }

  return next;
}

export interface ReconnectAnchorHit {
  nodeId: string;
  handleId: string;
  side: BorderSide;
  position: XYPosition;
}

export function inferAnchorDirection(from: XYPosition, to: XYPosition): EdgeAnchorDirection {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'bottom' : 'top';
}

function resolveNodeWorldRect(
  node: FlowNode,
  byId: Map<string, FlowNode>
): { x: number; y: number; width: number; height: number } {
  let x = node.position.x;
  let y = node.position.y;
  let curr = node.parentId ? byId.get(node.parentId) : undefined;
  const visited = new Set<string>([node.id]);
  while (curr && !visited.has(curr.id)) {
    visited.add(curr.id);
    x += curr.position.x;
    y += curr.position.y;
    curr = curr.parentId ? byId.get(curr.parentId) : undefined;
  }
  const styleWidth = typeof node.style?.width === 'number' ? node.style.width : undefined;
  const styleHeight = typeof node.style?.height === 'number' ? node.style.height : undefined;
  const entry = getNodeRegistryEntry(node.type);
  const width = node.width ?? styleWidth ?? entry?.defaultSize.width ?? 160;
  const height = node.height ?? styleHeight ?? entry?.defaultSize.height ?? 80;
  return { x, y, width, height };
}

export function findNearestNodeBorderAnchor(
  cursor: XYPosition,
  nodes: FlowNode[],
  excludeNodeId: string,
  options?: { snapMargin?: number; disableBorderSnap?: boolean }
): ReconnectAnchorHit | null {
  const snapMargin = options?.snapMargin ?? 24;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let best: { hit: ReconnectAnchorHit; score: number } | null = null;

  for (const node of nodes) {
    if (node.id === excludeNodeId || (node as { hidden?: boolean }).hidden) continue;
    const entry = getNodeRegistryEntry(node.type);
    if (!entry || entry.handles.length === 0) continue;

    const rect = resolveNodeWorldRect(node, byId);
    if (
      cursor.x < rect.x - snapMargin ||
      cursor.x > rect.x + rect.width + snapMargin ||
      cursor.y < rect.y - snapMargin ||
      cursor.y > rect.y + rect.height + snapMargin
    ) {
      continue;
    }

    const localX = cursor.x - rect.x;
    const localY = cursor.y - rect.y;
    const proj = projectPointToNodeBorder(localX, localY, rect.width, rect.height, {
      snapThresholdPx: 5,
      disableSnap: options?.disableBorderSnap,
      nodeType: node.type,
    });
    const worldPt = { x: rect.x + proj.x, y: rect.y + proj.y };
    const dist = Math.hypot(cursor.x - worldPt.x, cursor.y - worldPt.y);
    const inside = localX >= 0 && localX <= rect.width && localY >= 0 && localY <= rect.height;
    if (!inside && dist > snapMargin) continue;

    const score = inside ? dist * 0.5 : dist;
    if (!best || score < best.score) {
      best = {
        score,
        hit: {
          nodeId: node.id,
          handleId: formatBorderAnchorHandle(proj.side, proj.offset),
          side: proj.side,
          position: worldPt,
        },
      };
    }
  }

  return best ? best.hit : null;
}

export function ensureOrthogonalWaypoints(
  source: XYPosition,
  target: XYPosition,
  waypoints: XYPosition[],
  sourcePosition?: EdgeAnchorDirection,
  targetPosition?: EdgeAnchorDirection
): XYPosition[] {
  if (waypoints.length === 0) return [];
  const isOrtho = (a: XYPosition, b: XYPosition) =>
    Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5;
  const raw = [source, ...waypoints, target];
  let allOrtho = true;
  for (let i = 0; i < raw.length - 1; i++) {
    if (!isOrtho(raw[i], raw[i + 1])) {
      allOrtho = false;
      break;
    }
  }
  if (allOrtho) return waypoints;

  const next = waypoints.map((p) => ({ x: p.x, y: p.y }));
  const sAxis = sideToAxis(sourcePosition);
  const tAxis = sideToAxis(targetPosition);

  if (next.length === 1) {
    if (sAxis && tAxis && sAxis !== tAxis) {
      next[0] = sAxis === 'h' ? { x: target.x, y: source.y } : { x: source.x, y: target.y };
    }
  } else {
    if (!isOrtho(source, next[0])) {
      if (sAxis === 'v' && Math.abs(next[0].y - next[1].y) < 0.5) next[0].x = source.x;
      else if (sAxis === 'h' && Math.abs(next[0].x - next[1].x) < 0.5) next[0].y = source.y;
    }
    const last = next.length - 1;
    if (!isOrtho(next[last], target)) {
      if (tAxis === 'v' && Math.abs(next[last - 1].y - next[last].y) < 0.5) next[last].x = target.x;
      else if (tAxis === 'h' && Math.abs(next[last - 1].x - next[last].x) < 0.5) next[last].y = target.y;
    }
  }

  const pts = [source, ...next, target];
  const out: XYPosition[] = [pts[0]];
  let prevAxis: SegmentAxis | null = null;
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1];
    const curr = pts[i];
    if (isOrtho(prev, curr)) {
      out.push(curr);
      if (Math.hypot(curr.x - prev.x, curr.y - prev.y) >= 0.5) {
        prevAxis = Math.abs(curr.y - prev.y) < 0.5 ? 'h' : 'v';
      }
      continue;
    }
    const firstAxis: SegmentAxis =
      i === 1 && sAxis
        ? sAxis
        : i === pts.length - 1 && tAxis
        ? tAxis === 'h'
          ? 'v'
          : 'h'
        : prevAxis === 'h'
        ? 'v'
        : 'h';
    const corner = firstAxis === 'h' ? { x: curr.x, y: prev.y } : { x: prev.x, y: curr.y };
    out.push(corner, curr);
    prevAxis = firstAxis === 'h' ? 'v' : 'h';
  }

  const eps = 0.01;
  const samePt = (a: XYPosition, b: XYPosition) =>
    Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
  const cleaned: XYPosition[] = [out[0]];
  for (let i = 1; i < out.length; i++) {
    const p = out[i];
    if (i < out.length - 1 && samePt(p, cleaned[cleaned.length - 1])) continue;
    while (cleaned.length >= 2) {
      const prev = cleaned[cleaned.length - 1];
      const pp = cleaned[cleaned.length - 2];
      const dup = samePt(p, prev);
      const colX = Math.abs(pp.x - prev.x) < eps && Math.abs(prev.x - p.x) < eps;
      const colY = Math.abs(pp.y - prev.y) < eps && Math.abs(prev.y - p.y) < eps;
      if (dup || colX || colY) cleaned.pop();
      else break;
    }
    if (i === out.length - 1 || !samePt(p, cleaned[cleaned.length - 1])) {
      cleaned.push(p);
    }
  }
  return cleaned.slice(1, -1);
}

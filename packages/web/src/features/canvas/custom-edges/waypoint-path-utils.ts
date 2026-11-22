/**
 * @fileoverview 直角连线折点 (Waypoints) 几何计算工具
 * @description 支持多折拐点路径生成、段中点提取与折点更新
 */

import type { XYPosition } from '@flowstudio/shared';

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
  offset: number
): XYPosition[] {
  const pts = [source, ...waypoints, target].map((p) => ({ ...p }));
  const lastIndex = pts.length - 1;
  if (pts.length <= 2 || segIndex <= 0 || segIndex >= lastIndex - 1) {
    return waypoints.map((p) => ({ ...p }));
  }
  const a = pts[segIndex];
  const b = pts[segIndex + 1];
  const axis = a && b ? getSegmentAxis(a, b) : null;
  if (!axis || offset === 0) return waypoints.map((p) => ({ ...p }));
  const shift = (p: XYPosition): XYPosition =>
    axis === 'h' ? { x: p.x, y: p.y + offset } : { x: p.x + offset, y: p.y };
  pts[segIndex] = shift(a);
  pts[segIndex + 1] = shift(b);
  return pts.slice(1, lastIndex);
}

export function simplifyOrthogonalWaypoints(
  source: XYPosition,
  target: XYPosition,
  waypoints: XYPosition[]
): XYPosition[] {
  const pts = [source, ...waypoints.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })), target];
  const same = (a: number, b: number) => Math.abs(a - b) < 1;
  const out: XYPosition[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const prev = out[out.length - 1];
    if (i < pts.length - 1 && same(p.x, prev.x) && same(p.y, prev.y)) continue;
    if (out.length >= 2) {
      const pp = out[out.length - 2];
      if ((same(pp.x, prev.x) && same(prev.x, p.x)) || (same(pp.y, prev.y) && same(prev.y, p.y))) out.pop();
    }
    out.push(p);
  }
  return out.slice(1, -1);
}

/**
 * @fileoverview 直角连线折点 (Waypoints) 几何计算工具
 * @description 支持多折拐点路径生成、段中点提取与折点更新
 */

import type { XYPosition } from '@flowstudio/shared';

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
 * 从默认起点和终点派生一个初始的正交拐点
 */
export function deriveDefaultOrthogonalWaypoints(
  source: XYPosition,
  target: XYPosition
): XYPosition[] {
  const midX = (source.x + target.x) / 2;
  return [
    { x: midX, y: source.y },
    { x: midX, y: target.y },
  ];
}

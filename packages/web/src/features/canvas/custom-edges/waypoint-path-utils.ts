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

import type { XYPosition, Dimensions } from '@flowstudio/shared';
import type { EdgeAnchorDirection, PathSegment } from './waypoint-path-utils';
import { deriveDefaultOrthogonalWaypoints } from './waypoint-path-utils';

export interface ObstacleBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isLane?: boolean;
}

export interface RoutingOptions {
  padding?: number;
  sourceNodeId?: string;
  targetNodeId?: string;
  laneCorridorPenalty?: number;
}

interface GridVertex {
  x: number;
  y: number;
}

interface PriorityNode {
  vertex: GridVertex;
  g: number;
  f: number;
  dir: 'H' | 'V' | null;
  parent: PriorityNode | null;
}

export function isSegmentIntersectingBox(
  p1: XYPosition,
  p2: XYPosition,
  box: ObstacleBox,
  padding: number = 0
): boolean {
  const minX = box.x - padding;
  const maxX = box.x + box.width + padding;
  const minY = box.y - padding;
  const maxY = box.y + box.height + padding;

  if (Math.abs(p1.y - p2.y) < 0.001) {
    const segY = p1.y;
    if (segY < minY || segY > maxY) return false;
    const segMinX = Math.min(p1.x, p2.x);
    const segMaxX = Math.max(p1.x, p2.x);
    return Math.max(segMinX, minX) < Math.min(segMaxX, maxX);
  }

  if (Math.abs(p1.x - p2.x) < 0.001) {
    const segX = p1.x;
    if (segX < minX || segX > maxX) return false;
    const segMinY = Math.min(p1.y, p2.y);
    const segMaxY = Math.max(p1.y, p2.y);
    return Math.max(segMinY, minY) < Math.min(segMaxY, maxY);
  }

  return false;
}

export function isPointInsideObstacle(
  p: XYPosition,
  obstacles: ObstacleBox[],
  padding: number = 0
): boolean {
  for (const obs of obstacles) {
    if (obs.isLane) continue;
    if (
      p.x > obs.x - padding &&
      p.x < obs.x + obs.width + padding &&
      p.y > obs.y - padding &&
      p.y < obs.y + obs.height + padding
    ) {
      return true;
    }
  }
  return false;
}

export function checkPathCollidesWithObstacles(
  points: XYPosition[],
  obstacles: ObstacleBox[],
  padding: number = 6
): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    for (const obs of obstacles) {
      if (obs.isLane) continue;
      if (isSegmentIntersectingBox(p1, p2, obs, padding)) {
        return true;
      }
    }
  }
  return false;
}

export function buildRoutingGrid(
  source: XYPosition,
  target: XYPosition,
  obstacles: ObstacleBox[],
  padding: number = 16
): { xs: number[]; ys: number[] } {
  const xSet = new Set<number>([source.x, target.x, (source.x + target.x) / 2]);
  const ySet = new Set<number>([source.y, target.y, (source.y + target.y) / 2]);

  for (const obs of obstacles) {
    if (obs.isLane) continue;
    xSet.add(obs.x - padding);
    xSet.add(obs.x + obs.width + padding);
    ySet.add(obs.y - padding);
    ySet.add(obs.y + obs.height + padding);
  }

  const sortedXs = Array.from(xSet).sort((a, b) => a - b);
  const sortedYs = Array.from(ySet).sort((a, b) => a - b);

  const xs: number[] = [];
  for (const x of sortedXs) {
    if (xs.length === 0 || Math.abs(x - xs[xs.length - 1]) > 4) {
      xs.push(Math.round(x));
    }
  }

  const ys: number[] = [];
  for (const y of sortedYs) {
    if (ys.length === 0 || Math.abs(y - ys[ys.length - 1]) > 4) {
      ys.push(Math.round(y));
    }
  }

  return { xs, ys };
}

export function findObstacleAvoidingPath(
  source: XYPosition,
  target: XYPosition,
  sourcePosition?: EdgeAnchorDirection,
  targetPosition?: EdgeAnchorDirection,
  obstacles: ObstacleBox[] = [],
  options: RoutingOptions = {}
): XYPosition[] {
  const padding = options.padding ?? 14;
  const filteredObstacles = obstacles.filter(
    (o) => o.id !== options.sourceNodeId && o.id !== options.targetNodeId
  );

  const defaultWaypoints = deriveDefaultOrthogonalWaypoints(
    source,
    target,
    sourcePosition,
    targetPosition
  );
  const defaultPathPoints = [source, ...defaultWaypoints, target];

  if (
    filteredObstacles.length === 0 ||
    !checkPathCollidesWithObstacles(defaultPathPoints, filteredObstacles, 4)
  ) {
    return defaultWaypoints;
  }

  const { xs, ys } = buildRoutingGrid(source, target, filteredObstacles, padding);
  if (xs.length < 2 || ys.length < 2) return defaultWaypoints;

  const keyOf = (x: number, y: number) => `${x},${y}`;
  const startKey = keyOf(source.x, source.y);
  const targetKey = keyOf(target.x, target.y);

  const openList: PriorityNode[] = [
    {
      vertex: { x: source.x, y: source.y },
      g: 0,
      f: Math.abs(source.x - target.x) + Math.abs(source.y - target.y),
      dir: null,
      parent: null,
    },
  ];

  const closed = new Set<string>();
  const gScores = new Map<string, number>();
  gScores.set(startKey, 0);

  let bestNode: PriorityNode | null = null;
  const maxIterations = 600;
  let iterations = 0;

  while (openList.length > 0 && iterations++ < maxIterations) {
    let minIdx = 0;
    for (let i = 1; i < openList.length; i++) {
      if (openList[i].f < openList[minIdx].f) minIdx = i;
    }
    const current = openList.splice(minIdx, 1)[0];
    const currKey = keyOf(current.vertex.x, current.vertex.y);

    if (current.vertex.x === target.x && current.vertex.y === target.y) {
      bestNode = current;
      break;
    }

    if (closed.has(currKey)) continue;
    closed.add(currKey);

    const xi = xs.indexOf(current.vertex.x);
    const yi = ys.indexOf(current.vertex.y);

    const neighbors: { v: GridVertex; dir: 'H' | 'V' }[] = [];
    if (xi > 0) neighbors.push({ v: { x: xs[xi - 1], y: current.vertex.y }, dir: 'H' });
    if (xi < xs.length - 1) neighbors.push({ v: { x: xs[xi + 1], y: current.vertex.y }, dir: 'H' });
    if (yi > 0) neighbors.push({ v: { x: current.vertex.x, y: ys[yi - 1] }, dir: 'V' });
    if (yi < ys.length - 1) neighbors.push({ v: { x: current.vertex.x, y: ys[yi + 1] }, dir: 'V' });

    for (const { v: nextV, dir: nextDir } of neighbors) {
      const nextKey = keyOf(nextV.x, nextV.y);
      if (closed.has(nextKey)) continue;

      const isTarget = nextV.x === target.x && nextV.y === target.y;
      if (!isTarget && isPointInsideObstacle(nextV, filteredObstacles, 2)) continue;

      let blocked = false;
      for (const obs of filteredObstacles) {
        if (obs.isLane) continue;
        if (isSegmentIntersectingBox(current.vertex, nextV, obs, 4)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      const dist = Math.abs(current.vertex.x - nextV.x) + Math.abs(current.vertex.y - nextV.y);
      let turnPenalty = 0;
      if (current.dir && current.dir !== nextDir) {
        turnPenalty = 30;
      }

      let lanePenalty = 0;
      for (const obs of filteredObstacles) {
        if (!obs.isLane) continue;
        if (
          nextV.x > obs.x + 20 &&
          nextV.x < obs.x + obs.width - 20 &&
          nextV.y > obs.y + 20 &&
          nextV.y < obs.y + obs.height - 20
        ) {
          lanePenalty = options.laneCorridorPenalty ?? 25;
          break;
        }
      }

      const tentativeG = current.g + dist + turnPenalty + lanePenalty;
      const prevG = gScores.get(nextKey);
      if (prevG === undefined || tentativeG < prevG) {
        gScores.set(nextKey, tentativeG);
        const h = Math.abs(nextV.x - target.x) + Math.abs(nextV.y - target.y);
        openList.push({
          vertex: nextV,
          g: tentativeG,
          f: tentativeG + h,
          dir: nextDir,
          parent: current,
        });
      }
    }
  }

  if (!bestNode) return defaultWaypoints;

  const rawPath: XYPosition[] = [];
  let curr: PriorityNode | null = bestNode;
  while (curr) {
    rawPath.unshift(curr.vertex);
    curr = curr.parent;
  }

  const simplified: XYPosition[] = [rawPath[0]];
  for (let i = 1; i < rawPath.length - 1; i++) {
    const prev = simplified[simplified.length - 1];
    const mid = rawPath[i];
    const next = rawPath[i + 1];
    const isCollinearX = Math.abs(prev.x - mid.x) < 0.001 && Math.abs(mid.x - next.x) < 0.001;
    const isCollinearY = Math.abs(prev.y - mid.y) < 0.001 && Math.abs(mid.y - next.y) < 0.001;
    if (!isCollinearX && !isCollinearY) {
      simplified.push(mid);
    }
  }
  simplified.push(rawPath[rawPath.length - 1]);

  return simplified.slice(1, -1);
}

export function findSafeLabelPosition(
  segments: PathSegment[],
  obstacles: ObstacleBox[] = [],
  labelSize: Dimensions = { width: 64, height: 24 }
): XYPosition {
  if (segments.length === 0) return { x: 0, y: 0 };

  let bestPoint = segments[Math.floor(segments.length / 2)].midpoint;
  let bestScore = Infinity;

  const halfW = labelSize.width / 2;
  const halfH = labelSize.height / 2;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const length = Math.abs(seg.start.x - seg.end.x) + Math.abs(seg.start.y - seg.end.y);
    const candidates = [
      seg.midpoint,
      { x: seg.start.x * 0.3 + seg.end.x * 0.7, y: seg.start.y * 0.3 + seg.end.y * 0.7 },
      { x: seg.start.x * 0.7 + seg.end.x * 0.3, y: seg.start.y * 0.7 + seg.end.y * 0.3 },
    ];

    for (const cand of candidates) {
      let score = 0;
      if (length < labelSize.width) score += 200;

      const candBox: ObstacleBox = {
        id: 'label-cand',
        x: cand.x - halfW,
        y: cand.y - halfH,
        width: labelSize.width,
        height: labelSize.height,
      };

      for (const obs of obstacles) {
        if (obs.isLane) continue;
        if (
          candBox.x < obs.x + obs.width &&
          candBox.x + candBox.width > obs.x &&
          candBox.y < obs.y + obs.height &&
          candBox.y + candBox.height > obs.y
        ) {
          score += 1000;
        }
      }

      const distToStart = Math.hypot(cand.x - seg.start.x, cand.y - seg.start.y);
      const distToEnd = Math.hypot(cand.x - seg.end.x, cand.y - seg.end.y);
      if (distToStart < 15 || distToEnd < 15) score += 150;

      score -= length * 0.1;

      if (score < bestScore) {
        bestScore = score;
        bestPoint = cand;
      }
    }
  }

  return bestPoint;
}

export function computeOptimalHandles(
  sourceBox: ObstacleBox,
  targetBox: ObstacleBox
): {
  sourcePosition: EdgeAnchorDirection;
  targetPosition: EdgeAnchorDirection;
} {
  const scx = sourceBox.x + sourceBox.width / 2;
  const scy = sourceBox.y + sourceBox.height / 2;
  const tcx = targetBox.x + targetBox.width / 2;
  const tcy = targetBox.y + targetBox.height / 2;

  const dx = tcx - scx;
  const dy = tcy - scy;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { sourcePosition: 'right', targetPosition: 'left' }
      : { sourcePosition: 'left', targetPosition: 'right' };
  } else {
    return dy >= 0
      ? { sourcePosition: 'bottom', targetPosition: 'top' }
      : { sourcePosition: 'top', targetPosition: 'bottom' };
  }
}

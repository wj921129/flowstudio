import {
  type BorderSide,
  clampBorderOffset,
  formatBorderAnchorHandle,
  getBorderAnchorWorldPoint,
  parseBorderAnchorHandle,
} from './border-anchor.js';
import { getDefaultNodeSize } from './node-registry.js';
import type { FlowEdge, FlowEdgeData, FlowNode, FlowNodeType, XYPosition } from './types.js';

export interface NodeWorldBox {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DistributeEdgePortsOptions {
  fixedEdgeIds?: ReadonlySet<string>;
  lockedSourceEdgeIds?: ReadonlySet<string>;
  lockedTargetEdgeIds?: ReadonlySet<string>;
  obstacleEdges?: ReadonlyArray<Pick<FlowEdge, 'id' | 'source' | 'target' | 'sourceHandle' | 'targetHandle'>>;
}

export interface PickEdgePortsParams {
  sourceId: string;
  targetId: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface PickedEdgePorts {
  sourceHandle: string;
  targetHandle: string;
  sourceAuto: boolean;
  targetAuto: boolean;
}

const PORT_COLLISION_GAP = 0.08;
const FRIENDLY_OFFSETS = [0.25, 0.75, 1 / 3, 2 / 3, 0.2, 0.8, 0.15, 0.85] as const;

export function resolveNodeWorldBoxes(nodes: readonly FlowNode[]): Map<string, NodeWorldBox> {
  const byId = new Map<string, FlowNode>();
  for (const node of nodes) byId.set(node.id, node);
  const boxes = new Map<string, NodeWorldBox>();
  for (const node of nodes) {
    let x = node.position?.x ?? 0;
    let y = node.position?.y ?? 0;
    let curId = node.parentId;
    const visited = new Set<string>([node.id]);
    while (curId && !visited.has(curId)) {
      visited.add(curId);
      const parent = byId.get(curId);
      if (!parent) break;
      x += parent.position?.x ?? 0;
      y += parent.position?.y ?? 0;
      curId = parent.parentId;
    }
    const fallback = getDefaultNodeSize((node.type || 'process') as FlowNodeType);
    const width = typeof node.width === 'number' && node.width > 0 ? node.width : fallback.width;
    const height = typeof node.height === 'number' && node.height > 0 ? node.height : fallback.height;
    boxes.set(node.id, { id: node.id, type: node.type || 'process', x, y, width, height });
  }
  return boxes;
}

export function getSafeOffsetRange(nodeType: string | undefined, count: number): [number, number] {
  if (nodeType === 'decision') return count > 5 ? [0.12, 0.88] : [0.2, 0.8];
  if (nodeType === 'start-end' || nodeType === 'database') return count > 5 ? [0.1, 0.9] : [0.18, 0.82];
  return count > 5 ? [0.08, 0.92] : [0.15, 0.85];
}

export function hasExplicitBorderOffset(handleId?: string | null): boolean {
  if (!handleId || typeof handleId !== 'string' || !handleId.includes('@')) return false;
  return parseBorderAnchorHandle(handleId) !== null;
}

export function isAutoManagedPort(handle?: string | null, autoFingerprint?: string): boolean {
  if (!handle) return true;
  const parsed = parseBorderAnchorHandle(handle);
  if (!parsed) return true;
  if (Math.abs(parsed.offset - 0.5) < 0.002 && !handle.includes('@')) return true;
  if (autoFingerprint && handle === autoFingerprint) return true;
  return false;
}

export function inferBestSides(
  sourceBox: NodeWorldBox,
  targetBox: NodeWorldBox,
): { sourceSide: BorderSide; targetSide: BorderSide } {
  if (sourceBox.id === targetBox.id) return { sourceSide: 'right', targetSide: 'top' };
  const sx = sourceBox.x + sourceBox.width / 2;
  const sy = sourceBox.y + sourceBox.height / 2;
  const tx = targetBox.x + targetBox.width / 2;
  const ty = targetBox.y + targetBox.height / 2;
  const dx = tx - sx;
  const dy = ty - sy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { sourceSide: 'right', targetSide: 'left' } : { sourceSide: 'left', targetSide: 'right' };
  }
  return dy >= 0 ? { sourceSide: 'bottom', targetSide: 'top' } : { sourceSide: 'top', targetSide: 'bottom' };
}

export function alignWaypointsToAnchors(
  waypoints: readonly XYPosition[],
  sourceBox: NodeWorldBox,
  sourceHandle: string | undefined,
  targetBox: NodeWorldBox,
  targetHandle: string | undefined,
): XYPosition[] {
  if (waypoints.length === 0) return [];
  const next = waypoints.map((pt) => ({ x: pt.x, y: pt.y }));
  const inferred = inferBestSides(sourceBox, targetBox);
  const sPt = getBorderAnchorWorldPoint(sourceBox, sourceHandle, inferred.sourceSide, sourceBox.type);
  const tPt = getBorderAnchorWorldPoint(targetBox, targetHandle, inferred.targetSide, targetBox.type);
  if (sPt.side === 'left' || sPt.side === 'right') next[0] = { x: next[0].x, y: sPt.y };
  else next[0] = { x: sPt.x, y: next[0].y };
  if (next.length >= 2) {
    const last = next.length - 1;
    if (tPt.side === 'left' || tPt.side === 'right') next[last] = { x: next[last].x, y: tPt.y };
    else next[last] = { x: tPt.x, y: next[last].y };
  }
  return next;
}

function projectCounterpartIdeal(
  box: NodeWorldBox,
  otherBox: NodeWorldBox,
  side: BorderSide,
  min: number,
  max: number,
): number {
  const ox = otherBox.x + otherBox.width / 2;
  const oy = otherBox.y + otherBox.height / 2;
  const raw = side === 'top' || side === 'bottom' ? (ox - box.x) / box.width : (oy - box.y) / box.height;
  return Math.min(max, Math.max(min, clampBorderOffset(raw)));
}

function isConflict(candidate: number, occupied: readonly number[]): boolean {
  return occupied.some((v) => Math.abs(v - candidate) < PORT_COLLISION_GAP);
}

function findLargestGapMidpoint(occupied: readonly number[], min: number, max: number): number {
  const sorted = [...occupied]
    .filter((v) => v >= min - PORT_COLLISION_GAP && v <= max + PORT_COLLISION_GAP)
    .sort((a, b) => a - b);
  const edges = [min, ...sorted, max];
  let bestMid = (min + max) / 2;
  let bestSpan = -1;
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = Math.max(min, i === 0 ? min : edges[i] + PORT_COLLISION_GAP);
    const hi = Math.min(max, i === edges.length - 2 ? max : edges[i + 1] - PORT_COLLISION_GAP);
    const span = hi - lo;
    if (span > bestSpan) {
      bestSpan = span;
      bestMid = (lo + hi) / 2;
    }
  }
  if (bestSpan >= 0) return Math.min(max, Math.max(min, bestMid));
  let rawBest = (min + max) / 2;
  let rawSpan = -1;
  for (let i = 0; i < edges.length - 1; i++) {
    const span = edges[i + 1] - edges[i];
    if (span > rawSpan) {
      rawSpan = span;
      rawBest = (edges[i] + edges[i + 1]) / 2;
    }
  }
  return Math.min(max, Math.max(min, rawBest));
}

function pickNearestAvailableOffset(
  ideal: number,
  occupied: readonly number[],
  min: number,
  max: number,
): number {
  if (!isConflict(ideal, occupied)) return Math.min(max, Math.max(min, ideal));
  const sorted = [...occupied].sort((a, b) => a - b);
  const freeIntervals: Array<[number, number]> = [];
  let cursor = min;
  for (const occ of sorted) {
    const hi = Math.min(max, occ - PORT_COLLISION_GAP);
    if (hi >= cursor) freeIntervals.push([cursor, hi]);
    cursor = Math.max(cursor, occ + PORT_COLLISION_GAP);
  }
  if (cursor <= max) freeIntervals.push([cursor, max]);
  if (freeIntervals.length > 0) {
    let best = freeIntervals[0][0];
    let bestDist = Infinity;
    for (const [lo, hi] of freeIntervals) {
      const clamped = Math.min(hi, Math.max(lo, ideal));
      const dist = Math.abs(clamped - ideal);
      if (dist < bestDist) {
        bestDist = dist;
        best = clamped;
      }
    }
    return best;
  }
  return findLargestGapMidpoint(occupied, min, max);
}

interface BucketPort {
  edgeIdx: number;
  edgeId: string;
  isSource: boolean;
  otherId: string;
  fixedOffset?: number;
}

export function distributeEdgePorts(
  nodes: readonly FlowNode[],
  edges: readonly FlowEdge[],
  options?: DistributeEdgePortsOptions,
): FlowEdge[] {
  if (edges.length === 0) return [];
  const boxes = resolveNodeWorldBoxes(nodes);
  const fixedEdges = options?.fixedEdgeIds;
  const lockedSources = options?.lockedSourceEdgeIds;
  const lockedTargets = options?.lockedTargetEdgeIds;

  const resolvedEnds = edges.map((edge) => {
    const sBox = boxes.get(edge.source);
    const tBox = boxes.get(edge.target);
    const fallback = sBox && tBox ? inferBestSides(sBox, tBox) : { sourceSide: 'right' as BorderSide, targetSide: 'left' as BorderSide };
    const parsedSource = parseBorderAnchorHandle(edge.sourceHandle);
    const parsedTarget = parseBorderAnchorHandle(edge.targetHandle);
    const isFixedEdge = fixedEdges?.has(edge.id) ?? false;
    const sourceFixed = isFixedEdge || (lockedSources?.has(edge.id) ?? false);
    const targetFixed = isFixedEdge || (lockedTargets?.has(edge.id) ?? false);
    return {
      sourceSide: parsedSource?.side ?? fallback.sourceSide,
      targetSide: parsedTarget?.side ?? fallback.targetSide,
      sourceFixed,
      targetFixed,
      fixedSourceOffset: sourceFixed ? (parsedSource?.offset ?? 0.5) : undefined,
      fixedTargetOffset: targetFixed ? (parsedTarget?.offset ?? 0.5) : undefined,
    };
  });

  const buckets = new Map<string, BucketPort[]>();
  const pushPort = (nodeId: string, side: BorderSide, port: BucketPort) => {
    const key = `${nodeId}::${side}`;
    const list = buckets.get(key);
    if (list) list.push(port);
    else buckets.set(key, [port]);
  };

  edges.forEach((edge, idx) => {
    const end = resolvedEnds[idx];
    pushPort(edge.source, end.sourceSide, {
      edgeIdx: idx,
      edgeId: edge.id,
      isSource: true,
      otherId: edge.target,
      fixedOffset: end.fixedSourceOffset,
    });
    pushPort(edge.target, end.targetSide, {
      edgeIdx: idx,
      edgeId: edge.id,
      isSource: false,
      otherId: edge.source,
      fixedOffset: end.fixedTargetOffset,
    });
  });

  for (const obs of options?.obstacleEdges ?? []) {
    const sBox = boxes.get(obs.source);
    const tBox = boxes.get(obs.target);
    const fallback = sBox && tBox ? inferBestSides(sBox, tBox) : { sourceSide: 'right' as BorderSide, targetSide: 'left' as BorderSide };
    const ps = parseBorderAnchorHandle(obs.sourceHandle);
    const pt = parseBorderAnchorHandle(obs.targetHandle);
    pushPort(obs.source, ps?.side ?? fallback.sourceSide, {
      edgeIdx: -1,
      edgeId: obs.id,
      isSource: true,
      otherId: obs.target,
      fixedOffset: ps?.offset ?? 0.5,
    });
    pushPort(obs.target, pt?.side ?? fallback.targetSide, {
      edgeIdx: -1,
      edgeId: obs.id,
      isSource: false,
      otherId: obs.source,
      fixedOffset: pt?.offset ?? 0.5,
    });
  }

  const assignedSource = new Array<string | undefined>(edges.length);
  const assignedTarget = new Array<string | undefined>(edges.length);

  for (const [key, list] of buckets.entries()) {
    const sep = key.indexOf('::');
    const nodeId = key.slice(0, sep);
    const side = key.slice(sep + 2) as BorderSide;
    const nodeBox = boxes.get(nodeId);
    const nodeType = nodeBox?.type;

    list.sort((a, b) => {
      const boxA = boxes.get(a.otherId);
      const boxB = boxes.get(b.otherId);
      const coordA = boxA ? (side === 'top' || side === 'bottom' ? boxA.x + boxA.width / 2 : boxA.y + boxA.height / 2) : 0;
      const coordB = boxB ? (side === 'top' || side === 'bottom' ? boxB.x + boxB.width / 2 : boxB.y + boxB.height / 2) : 0;
      if (Math.abs(coordA - coordB) > 0.5) return coordA - coordB;
      return a.edgeId.localeCompare(b.edgeId);
    });

    const fixedPorts = list.filter((p) => p.fixedOffset !== undefined);
    const autoPorts = list.filter((p) => p.fixedOffset === undefined && p.edgeIdx >= 0);
    if (autoPorts.length === 0) continue;

    const total = list.length;
    const [min, max] = getSafeOffsetRange(nodeType, total);

    if (fixedPorts.length === 0) {
      const m = autoPorts.length;
      let offsets: number[];
      if (m === 1) offsets = [0.5];
      else if (m === 2) offsets = 1 / 3 >= min && 2 / 3 <= max ? [1 / 3, 2 / 3] : [min, max];
      else if (m === 3) offsets = 0.25 >= min && 0.75 <= max ? [0.25, 0.5, 0.75] : [min, 0.5, max];
      else offsets = autoPorts.map((_, i) => min + ((max - min) * i) / (m - 1));

      autoPorts.forEach((p, i) => {
        const handle = formatBorderAnchorHandle(side, offsets[i]);
        if (p.isSource) assignedSource[p.edgeIdx] = handle;
        else assignedTarget[p.edgeIdx] = handle;
      });
    } else {
      const occupied = fixedPorts.map((p) => p.fixedOffset!);
      const autoCount = autoPorts.length;
      autoPorts.forEach((p, idx) => {
        const rank = list.indexOf(p);
        const ideal =
          total === 1
            ? 0.5
            : autoCount === 1 && !isConflict(0.5, occupied)
            ? 0.5
            : min + ((max - min) * rank) / Math.max(1, total - 1);
        const picked = pickNearestAvailableOffset(ideal, occupied, min, max);
        occupied.push(picked);
        const handle = formatBorderAnchorHandle(side, picked);
        if (p.isSource) assignedSource[p.edgeIdx] = handle;
        else assignedTarget[p.edgeIdx] = handle;
      });
    }
  }

  return edges.map((edge, idx) => {
    const end = resolvedEnds[idx];
    const nextSource = end.sourceFixed ? edge.sourceHandle : (assignedSource[idx] ?? edge.sourceHandle);
    const nextTarget = end.targetFixed ? edge.targetHandle : (assignedTarget[idx] ?? edge.targetHandle);
    const sChanged = nextSource !== edge.sourceHandle;
    const tChanged = nextTarget !== edge.targetHandle;

    const prevData = edge.data ? { ...edge.data } : undefined;
    let nextData: FlowEdgeData | undefined = prevData;
    const setDataField = <K extends keyof FlowEdgeData>(k: K, v: FlowEdgeData[K]) => {
      if (!nextData) nextData = {};
      nextData[k] = v;
    };

    if (!end.sourceFixed && nextSource) setDataField('autoSourceHandle', nextSource);
    if (!end.targetFixed && nextTarget) setDataField('autoTargetHandle', nextTarget);

    if ((sChanged || tChanged) && prevData?.waypoints && prevData.waypoints.length > 0) {
      const sBox = boxes.get(edge.source);
      const tBox = boxes.get(edge.target);
      if (sBox && tBox) {
        setDataField('waypoints', alignWaypointsToAnchors(prevData.waypoints, sBox, nextSource, tBox, nextTarget));
      }
    }

    return {
      ...edge,
      ...(nextSource ? { sourceHandle: nextSource } : {}),
      ...(nextTarget ? { targetHandle: nextTarget } : {}),
      ...(nextData ? { data: nextData } : {}),
    };
  });
}

function collectOccupiedOffsets(
  edges: readonly FlowEdge[],
  boxes: ReadonlyMap<string, NodeWorldBox>,
  nodeId: string,
  side: BorderSide,
): number[] {
  const occupied: number[] = [];
  for (const edge of edges) {
    const sBox = boxes.get(edge.source);
    const tBox = boxes.get(edge.target);
    const fallback = sBox && tBox ? inferBestSides(sBox, tBox) : { sourceSide: 'right' as BorderSide, targetSide: 'left' as BorderSide };
    if (edge.source === nodeId) {
      const parsed = parseBorderAnchorHandle(edge.sourceHandle);
      const s = parsed?.side ?? fallback.sourceSide;
      if (s === side) occupied.push(parsed?.offset ?? 0.5);
    }
    if (edge.target === nodeId) {
      const parsed = parseBorderAnchorHandle(edge.targetHandle);
      const s = parsed?.side ?? fallback.targetSide;
      if (s === side) occupied.push(parsed?.offset ?? 0.5);
    }
  }
  return occupied;
}

function pickFreeOffsetOnSide(
  nodeBox: NodeWorldBox | undefined,
  otherBox: NodeWorldBox | undefined,
  side: BorderSide,
  occupied: readonly number[],
): string {
  if (!isConflict(0.5, occupied)) return side;
  const [min, max] = getSafeOffsetRange(nodeBox?.type, occupied.length + 1);
  const ideal = nodeBox && otherBox ? projectCounterpartIdeal(nodeBox, otherBox, side, min, max) : 0.5;
  const candidates = FRIENDLY_OFFSETS
    .filter((c) => c >= min && c <= max && !isConflict(c, occupied))
    .sort((a, b) => {
      const da = Math.abs(a - ideal);
      const db = Math.abs(b - ideal);
      if (Math.abs(da - db) > 0.001) return da - db;
      return Math.abs(a - 0.5) - Math.abs(b - 0.5);
    });
  if (candidates.length > 0) return formatBorderAnchorHandle(side, candidates[0]);
  return formatBorderAnchorHandle(side, findLargestGapMidpoint(occupied, min, max));
}

export function pickEdgePortsForConnect(
  nodes: readonly FlowNode[],
  existingEdges: readonly FlowEdge[],
  params: PickEdgePortsParams,
): PickedEdgePorts {
  const boxes = resolveNodeWorldBoxes(nodes);
  const sBox = boxes.get(params.sourceId);
  const tBox = boxes.get(params.targetId);
  const inferred = sBox && tBox ? inferBestSides(sBox, tBox) : { sourceSide: 'right' as BorderSide, targetSide: 'left' as BorderSide };

  let sourceHandle: string;
  let sourceAuto = false;
  const parsedSource = parseBorderAnchorHandle(params.sourceHandle);
  if (params.sourceHandle && params.sourceHandle.includes('@') && parsedSource) {
    sourceHandle = formatBorderAnchorHandle(parsedSource.side, parsedSource.offset);
  } else {
    sourceAuto = true;
    const sSide = parsedSource?.side ?? inferred.sourceSide;
    const occupied = collectOccupiedOffsets(existingEdges, boxes, params.sourceId, sSide);
    sourceHandle = pickFreeOffsetOnSide(sBox, tBox, sSide, occupied);
  }

  let targetHandle: string;
  let targetAuto = false;
  const parsedTarget = parseBorderAnchorHandle(params.targetHandle);
  if (params.targetHandle && params.targetHandle.includes('@') && parsedTarget) {
    targetHandle = formatBorderAnchorHandle(parsedTarget.side, parsedTarget.offset);
  } else {
    targetAuto = true;
    const tSide = parsedTarget?.side ?? inferred.targetSide;
    const occupied = collectOccupiedOffsets(existingEdges, boxes, params.targetId, tSide);
    if (params.sourceId === params.targetId && parseBorderAnchorHandle(sourceHandle)?.side === tSide) {
      occupied.push(parseBorderAnchorHandle(sourceHandle)?.offset ?? 0.5);
    }
    targetHandle = pickFreeOffsetOnSide(tBox, sBox, tSide, occupied);
  }

  return { sourceHandle, targetHandle, sourceAuto, targetAuto };
}

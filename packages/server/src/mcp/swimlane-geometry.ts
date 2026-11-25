import type * as Y from 'yjs';
import { getNodeRegistryEntry } from '@flowstudio/shared';
import { getNodeLockMode } from '../collaboration/entity-state.js';

export const DEFAULT_NODE_WIDTH = 160;
export const DEFAULT_NODE_HEIGHT = 80;
export const INSERT_GAP = 60;
export const LAYOUT_PADDING = 40;
export const LANE_HEADER_SIZE = 40;

export type LayoutPoint = { x: number; y: number };

export function getRegistrySize(type: string): { width: number; height: number } {
  const entry = getNodeRegistryEntry(type as never);
  return entry?.defaultSize ?? { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
}

export function getMapDimensions(map: Y.Map<unknown>): { width: number; height: number } {
  return {
    width: (map.get('width') as number) || DEFAULT_NODE_WIDTH,
    height: (map.get('height') as number) || DEFAULT_NODE_HEIGHT,
  };
}

export function collectLiveLockState(nodesMap: Y.Map<Y.Map<unknown>>) {
  const fullProtectedIds = new Set<string>();
  const containersWithLockedChild = new Set<string>();

  const markChain = (startId: string, target: Set<string>, includeSelf: boolean) => {
    let cursor: string | undefined = includeSelf
      ? startId
      : (nodesMap.get(startId)?.get('parentId') as string | undefined);
    const seen = new Set<string>(includeSelf ? [] : [startId]);
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      target.add(cursor);
      cursor = nodesMap.get(cursor)?.get('parentId') as string | undefined;
    }
  };

  nodesMap.forEach((nodeMap, id) => {
    const mode = getNodeLockMode(nodeMap);
    if (mode === 'full') markChain(id, fullProtectedIds, true);
    if (mode !== 'none') markChain(id, containersWithLockedChild, false);
  });

  const hasLockedAncestor = (id: string, extraBlocked?: Set<string>): boolean => {
    let cursor = nodesMap.get(id)?.get('parentId') as string | undefined;
    const seen = new Set<string>([id]);
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      if (extraBlocked?.has(cursor)) return true;
      if (getNodeLockMode(nodesMap.get(cursor)) !== 'none') return true;
      cursor = nodesMap.get(cursor)?.get('parentId') as string | undefined;
    }
    return false;
  };

  return { fullProtectedIds, containersWithLockedChild, hasLockedAncestor };
}

export interface SwimlaneChild {
  id: string;
  laneId: string;
  width: number;
  height: number;
}

export interface SwimlanePlacement {
  poolSize: { width: number; height: number };
  laneFrames: Map<string, { x: number; y: number; width: number; height: number }>;
  childPositions: Map<string, LayoutPoint>;
}

export function computeSwimlanePlacement(params: {
  horizontal: boolean;
  laneIds: string[];
  children: SwimlaneChild[];
  globalPositions: Map<string, LayoutPoint>;
  fixedFrames?: Map<string, { x: number; y: number; width: number; height: number }>;
}): SwimlanePlacement {
  const laneChildren = new Map<string, Array<SwimlaneChild & { pos: LayoutPoint }>>();
  for (const laneId of params.laneIds) laneChildren.set(laneId, []);
  for (const child of params.children) {
    const pos = params.globalPositions.get(child.id);
    const bucket = laneChildren.get(child.laneId);
    if (!pos || !bucket) continue;
    bucket.push({ ...child, pos });
  }

  let globalMinX = Infinity;
  let globalMaxX = -Infinity;
  let globalMinY = Infinity;
  let globalMaxY = -Infinity;
  for (const bucket of laneChildren.values()) {
    for (const item of bucket) {
      globalMinX = Math.min(globalMinX, item.pos.x);
      globalMaxX = Math.max(globalMaxX, item.pos.x + item.width);
      globalMinY = Math.min(globalMinY, item.pos.y);
      globalMaxY = Math.max(globalMaxY, item.pos.y + item.height);
    }
  }
  if (globalMinX === Infinity) {
    globalMinX = 0;
    globalMaxX = 800;
    globalMinY = 0;
    globalMaxY = 400;
  }

  const laneFrames: SwimlanePlacement['laneFrames'] = new Map();
  const childPositions: SwimlanePlacement['childPositions'] = new Map();

  let offset = params.horizontal ? LANE_HEADER_SIZE : 0;
  let crossExtent = params.horizontal ? 800 : 480;

  for (const laneId of params.laneIds) {
    const items = laneChildren.get(laneId)!;
    let innerMinX = Infinity;
    let innerMaxX = -Infinity;
    let innerMinY = Infinity;
    let innerMaxY = -Infinity;
    for (const item of items) {
      innerMinX = Math.min(innerMinX, item.pos.x);
      innerMaxX = Math.max(innerMaxX, item.pos.x + item.width);
      innerMinY = Math.min(innerMinY, item.pos.y);
      innerMaxY = Math.max(innerMaxY, item.pos.y + item.height);
    }

    const fixed = params.fixedFrames?.get(laneId);
    if (fixed) {
      laneFrames.set(laneId, { ...fixed });
      if (params.horizontal) {
        offset = Math.max(offset, fixed.y + fixed.height);
        crossExtent = Math.max(crossExtent, fixed.width);
      } else {
        offset = Math.max(offset, fixed.x + fixed.width);
        crossExtent = Math.max(crossExtent, fixed.height);
      }
      continue;
    }

    let width: number;
    let height: number;
    let x: number;
    let y: number;
    if (params.horizontal) {
      width = Math.max(800, globalMaxX - globalMinX + LAYOUT_PADDING * 2);
      height = Math.max(200, items.length > 0 ? innerMaxY - innerMinY + LAYOUT_PADDING * 2 : 0);
      x = 0;
      y = offset;
      offset += height;
      crossExtent = Math.max(crossExtent, width);
    } else {
      height = Math.max(480, globalMaxY - globalMinY + 60 + LAYOUT_PADDING);
      width = Math.max(240, items.length > 0 ? innerMaxX - innerMinX + LAYOUT_PADDING * 2 : 0);
      x = offset;
      y = LANE_HEADER_SIZE;
      offset += width;
      crossExtent = Math.max(crossExtent, height);
    }
    laneFrames.set(laneId, { x, y, width, height });

    for (const item of items) {
      const localX = params.horizontal
        ? Math.max(LAYOUT_PADDING, item.pos.x - globalMinX + LAYOUT_PADDING)
        : Math.max(LAYOUT_PADDING, item.pos.x - innerMinX + LAYOUT_PADDING);
      const localY = params.horizontal
        ? Math.max(LAYOUT_PADDING, item.pos.y - innerMinY + LAYOUT_PADDING)
        : Math.max(60, item.pos.y - globalMinY + 60);
      childPositions.set(item.id, { x: localX, y: localY });
    }
  }

  return {
    poolSize: params.horizontal
      ? { width: Math.max(800, crossExtent), height: offset }
      : { width: Math.max(240, offset), height: LANE_HEADER_SIZE + Math.max(480, crossExtent) },
    laneFrames,
    childPositions,
  };
}

export function orderLaneIds(
  laneOrder: string[] | undefined,
  lanes: Array<{ id: string; position: LayoutPoint }>,
  horizontal: boolean,
): string[] {
  const existing = new Set(lanes.map((lane) => lane.id));
  const ordered = (laneOrder ?? []).filter((id) => existing.has(id));
  const orderedSet = new Set(ordered);
  const rest = lanes
    .filter((lane) => !orderedSet.has(lane.id))
    .sort((a, b) =>
      horizontal ? a.position.y - b.position.y : a.position.x - b.position.x,
    )
    .map((lane) => lane.id);
  return [...ordered, ...rest];
}

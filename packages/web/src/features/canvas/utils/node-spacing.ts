import type { FlowNode } from '@flowstudio/shared';
import { getNodeDimensions } from './group-calculator';
import { isNodeLocked } from './node-lock-manager';

export const NODE_SPACING_MIN_SCALE = 0.5;
export const NODE_SPACING_MAX_SCALE = 2.5;
export const NODE_SPACING_STEP = 0.05;
export const NODE_SPACING_MIN_GAP = 16;
export const NODE_SPACING_MAX_GAP = 320;

export interface AxisIntervalItem {
  id: string;
  start: number;
  size: number;
}

interface AxisCluster {
  start: number;
  end: number;
  items: AxisIntervalItem[];
}

export function clampSpacingScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  const clamped = Math.max(NODE_SPACING_MIN_SCALE, Math.min(NODE_SPACING_MAX_SCALE, scale));
  return Math.round(clamped * 100) / 100;
}

export function scaleAxisIntervals(
  items: AxisIntervalItem[],
  scale: number
): Map<string, number> {
  const result = new Map<string, number>();
  for (const item of items) result.set(item.id, item.start);
  if (items.length < 2) return result;

  const sorted = [...items].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  const clusters: AxisCluster[] = [];

  for (const item of sorted) {
    const end = item.start + item.size;
    const last = clusters[clusters.length - 1];
    if (!last || item.start >= last.end - 1) {
      clusters.push({ start: item.start, end, items: [item] });
    } else {
      last.end = Math.max(last.end, end);
      last.items.push(item);
    }
  }

  if (clusters.length < 2) return result;

  const origMin = clusters[0].start;
  const origMax = clusters[clusters.length - 1].end;
  const origCenter = (origMin + origMax) / 2;

  const newStarts: number[] = [0];
  let cursor = clusters[0].end - clusters[0].start;

  for (let i = 1; i < clusters.length; i++) {
    const prev = clusters[i - 1];
    const curr = clusters[i];
    const origGap = Math.max(0, curr.start - prev.end);
    const nextGap =
      scale >= 1
        ? Math.min(
            NODE_SPACING_MAX_GAP,
            Math.max(origGap, origGap === 0 ? (scale - 1) * 24 : origGap * scale)
          )
        : Math.max(Math.min(origGap, NODE_SPACING_MIN_GAP), origGap * scale);
    cursor += nextGap;
    newStarts.push(cursor);
    cursor += curr.end - curr.start;
  }

  const shift = origCenter - cursor / 2;
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    const baseNewStart = shift + newStarts[i];
    for (const item of cluster.items) {
      result.set(item.id, Math.round(baseNewStart + (item.start - cluster.start)));
    }
  }

  return result;
}

function collectLockedSets(nodes: FlowNode[]): {
  lockedNodeIds: Set<string>;
  lockedContainers: Set<string>;
} {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const lockedNodeIds = new Set<string>();
  const lockedContainers = new Set<string>();

  for (const n of nodes) {
    if (isNodeLocked(n, 'position')) {
      lockedNodeIds.add(n.id);
    }
  }

  for (const n of nodes) {
    if (n.parentId && lockedNodeIds.has(n.id)) {
      let curr: string | undefined = n.parentId;
      const visited = new Set<string>([n.id]);
      while (curr && !visited.has(curr)) {
        visited.add(curr);
        lockedContainers.add(curr);
        curr = nodeById.get(curr)?.parentId;
      }
    }
  }

  return { lockedNodeIds, lockedContainers };
}

function isFixedNode(
  id: string,
  lockedNodeIds: Set<string>,
  lockedContainers: Set<string>
): boolean {
  return lockedNodeIds.has(id) || lockedContainers.has(id);
}

export function applyDiagramSpacingScale(
  baseNodes: FlowNode[],
  rawScale: number
): { nodes: FlowNode[]; clampedScale: number } {
  const clampedScale = clampSpacingScale(rawScale);
  if (baseNodes.length === 0 || clampedScale === 1) {
    return { nodes: baseNodes, clampedScale };
  }

  const { lockedNodeIds, lockedContainers } = collectLockedSets(baseNodes);
  const nextById = new Map<string, FlowNode>(
    baseNodes.map((n) => [
      n.id,
      {
        ...n,
        position: { ...n.position },
        ...(n.style ? { style: { ...n.style } } : {}),
      },
    ])
  );

  for (const node of baseNodes) {
    if (node.type !== 'group' || isFixedNode(node.id, lockedNodeIds, lockedContainers)) continue;
    const children = baseNodes.filter((n) => n.parentId === node.id);
    if (children.length === 0) continue;

    const xMap = scaleAxisIntervals(
      children.map((c) => ({ id: c.id, start: c.position.x, size: getNodeDimensions(c).width })),
      clampedScale
    );
    const yMap = scaleAxisIntervals(
      children.map((c) => ({ id: c.id, start: c.position.y, size: getNodeDimensions(c).height })),
      clampedScale
    );

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of children) {
      const dim = getNodeDimensions(c);
      const nx = xMap.get(c.id) ?? c.position.x;
      const ny = yMap.get(c.id) ?? c.position.y;
      minX = Math.min(minX, nx);
      minY = Math.min(minY, ny);
      maxX = Math.max(maxX, nx + dim.width);
      maxY = Math.max(maxY, ny + dim.height);
    }

    const pad = 20;
    const topPad = node.data?.isFrame ? 36 : 20;
    const newW = Math.max(80, Math.round(maxX - minX + pad * 2));
    const newH = Math.max(60, Math.round(maxY - minY + topPad + pad));
    const oldDim = getNodeDimensions(node);
    const centerX = node.position.x + oldDim.width / 2;
    const centerY = node.position.y + oldDim.height / 2;

    const groupDraft = nextById.get(node.id)!;
    groupDraft.position = {
      x: Math.round(centerX - newW / 2),
      y: Math.round(centerY - newH / 2),
    };
    groupDraft.width = newW;
    groupDraft.height = newH;
    groupDraft.style = { ...(groupDraft.style || {}), width: newW, height: newH };

    for (const c of children) {
      const childDraft = nextById.get(c.id)!;
      childDraft.position = {
        x: Math.round((xMap.get(c.id) ?? c.position.x) - minX + pad),
        y: Math.round((yMap.get(c.id) ?? c.position.y) - minY + topPad),
      };
    }
  }

  for (const pool of baseNodes) {
    if (pool.type !== 'pool' || isFixedNode(pool.id, lockedNodeIds, lockedContainers)) continue;
    const lanes = baseNodes.filter((n) => n.parentId === pool.id && n.type === 'lane');
    if (lanes.length === 0) continue;

    const isHorizontal = (pool.data?.orientation ?? 'horizontal') === 'horizontal';
    const headerSize = typeof pool.data?.headerSize === 'number' ? pool.data.headerSize : 40;
    const laneSet = new Set(lanes.map((l) => l.id));
    const poolChildren = baseNodes.filter((n) => n.parentId && laneSet.has(n.parentId));

    if (isHorizontal) {
      const xMap = scaleAxisIntervals(
        poolChildren.map((c) => ({ id: c.id, start: c.position.x, size: getNodeDimensions(c).width })),
        clampedScale
      );
      let minChildX = Infinity;
      let maxChildRight = -Infinity;
      for (const c of poolChildren) {
        const nx = xMap.get(c.id) ?? c.position.x;
        minChildX = Math.min(minChildX, nx);
        maxChildRight = Math.max(maxChildRight, nx + getNodeDimensions(c).width);
      }

      const leftMargin = 64;
      const rightPad = 40;
      const vPad = 32;
      const shiftX = Number.isFinite(minChildX) ? leftMargin - minChildX : 0;
      const origPoolW = getNodeDimensions(pool).width;
      const neededPoolW = Number.isFinite(maxChildRight)
        ? Math.round(maxChildRight - minChildX + leftMargin + rightPad)
        : origPoolW;
      const poolW =
        clampedScale >= 1 ? Math.max(origPoolW, neededPoolW) : Math.max(480, neededPoolW);

      const orderedLanes = [...lanes].sort((a, b) => a.position.y - b.position.y);
      let offsetY = headerSize;
      for (const lane of orderedLanes) {
        const laneChildren = poolChildren.filter((c) => c.parentId === lane.id);
        const yMap = scaleAxisIntervals(
          laneChildren.map((c) => ({ id: c.id, start: c.position.y, size: getNodeDimensions(c).height })),
          clampedScale
        );
        let minY = Infinity;
        let maxY = -Infinity;
        for (const c of laneChildren) {
          const ny = yMap.get(c.id) ?? c.position.y;
          minY = Math.min(minY, ny);
          maxY = Math.max(maxY, ny + getNodeDimensions(c).height);
        }
        const origLaneH = getNodeDimensions(lane).height;
        const neededLaneH =
          laneChildren.length > 0
            ? Math.max(120, Math.round(maxY - minY + vPad * 2))
            : origLaneH;
        const laneH = clampedScale >= 1 ? Math.max(origLaneH, neededLaneH) : neededLaneH;

        const laneDraft = nextById.get(lane.id)!;
        laneDraft.position = { x: 0, y: offsetY };
        laneDraft.width = poolW;
        laneDraft.height = laneH;
        laneDraft.style = { ...(laneDraft.style || {}), width: poolW, height: laneH };
        offsetY += laneH;

        for (const c of laneChildren) {
          const childDraft = nextById.get(c.id)!;
          childDraft.position = {
            x: Math.round((xMap.get(c.id) ?? c.position.x) + shiftX),
            y: Math.round((yMap.get(c.id) ?? c.position.y) - minY + vPad),
          };
        }
      }

      const poolDraft = nextById.get(pool.id)!;
      poolDraft.width = poolW;
      poolDraft.height = offsetY;
      poolDraft.style = { ...(poolDraft.style || {}), width: poolW, height: offsetY };
    } else {
      const yMap = scaleAxisIntervals(
        poolChildren.map((c) => ({ id: c.id, start: c.position.y, size: getNodeDimensions(c).height })),
        clampedScale
      );
      let minChildY = Infinity;
      let maxChildBottom = -Infinity;
      for (const c of poolChildren) {
        const ny = yMap.get(c.id) ?? c.position.y;
        minChildY = Math.min(minChildY, ny);
        maxChildBottom = Math.max(maxChildBottom, ny + getNodeDimensions(c).height);
      }

      const topMargin = 60;
      const bottomPad = 40;
      const hPad = 32;
      const shiftY = Number.isFinite(minChildY) ? topMargin - minChildY : 0;
      const origLaneH = getNodeDimensions(pool).height - headerSize;
      const neededLaneH = Number.isFinite(maxChildBottom)
        ? Math.round(maxChildBottom - minChildY + topMargin + bottomPad)
        : origLaneH;
      const laneH =
        clampedScale >= 1 ? Math.max(origLaneH, neededLaneH) : Math.max(320, neededLaneH);

      const orderedLanes = [...lanes].sort((a, b) => a.position.x - b.position.x);
      let offsetX = 0;
      for (const lane of orderedLanes) {
        const laneChildren = poolChildren.filter((c) => c.parentId === lane.id);
        const xMap = scaleAxisIntervals(
          laneChildren.map((c) => ({ id: c.id, start: c.position.x, size: getNodeDimensions(c).width })),
          clampedScale
        );
        let minX = Infinity;
        let maxX = -Infinity;
        for (const c of laneChildren) {
          const nx = xMap.get(c.id) ?? c.position.x;
          minX = Math.min(minX, nx);
          maxX = Math.max(maxX, nx + getNodeDimensions(c).width);
        }
        const origLaneW = getNodeDimensions(lane).width;
        const neededLaneW =
          laneChildren.length > 0
            ? Math.max(180, Math.round(maxX - minX + hPad * 2))
            : origLaneW;
        const laneW = clampedScale >= 1 ? Math.max(origLaneW, neededLaneW) : neededLaneW;

        const laneDraft = nextById.get(lane.id)!;
        laneDraft.position = { x: offsetX, y: headerSize };
        laneDraft.width = laneW;
        laneDraft.height = laneH;
        laneDraft.style = { ...(laneDraft.style || {}), width: laneW, height: laneH };
        offsetX += laneW;

        for (const c of laneChildren) {
          const childDraft = nextById.get(c.id)!;
          childDraft.position = {
            x: Math.round((xMap.get(c.id) ?? c.position.x) - minX + hPad),
            y: Math.round((yMap.get(c.id) ?? c.position.y) + shiftY),
          };
        }
      }

      const poolW = Math.max(240, offsetX);
      const poolH = headerSize + laneH;
      const poolDraft = nextById.get(pool.id)!;
      poolDraft.width = poolW;
      poolDraft.height = poolH;
      poolDraft.style = { ...(poolDraft.style || {}), width: poolW, height: poolH };
    }
  }

  const topLevelMovable = baseNodes
    .filter((n) => !n.parentId && !isFixedNode(n.id, lockedNodeIds, lockedContainers))
    .map((n) => nextById.get(n.id)!);

  if (topLevelMovable.length >= 2) {
    const topXMap = scaleAxisIntervals(
      topLevelMovable.map((n) => ({
        id: n.id,
        start: n.position.x,
        size: getNodeDimensions(n).width,
      })),
      clampedScale
    );
    const topYMap = scaleAxisIntervals(
      topLevelMovable.map((n) => ({
        id: n.id,
        start: n.position.y,
        size: getNodeDimensions(n).height,
      })),
      clampedScale
    );

    for (const n of topLevelMovable) {
      n.position = {
        x: topXMap.get(n.id) ?? n.position.x,
        y: topYMap.get(n.id) ?? n.position.y,
      };
    }
  }

  return {
    nodes: baseNodes.map((n) => nextById.get(n.id)!),
    clampedScale,
  };
}

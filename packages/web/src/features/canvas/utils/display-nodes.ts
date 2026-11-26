import type { FlowNode } from '@flowstudio/shared';
import type { PathSpotlightResult } from './path-spotlight';
import { isNodeLocked } from './node-lock-manager';

export const POOL_Z_INDEX = -2000;
export const LANE_Z_INDEX = -1500;

export function getSwimlaneBaseZIndex(type: FlowNode['type']): number | undefined {
  if (type === 'pool') return POOL_Z_INDEX;
  if (type === 'lane') return LANE_Z_INDEX;
  return undefined;
}

export interface DisplayNodeCacheEntry {
  raw: FlowNode;
  draggable: false | undefined;
  zIndex: number | undefined;
  hasSpotlightDim: boolean;
  isHighlighted: boolean;
  derived: FlowNode;
}

export interface DeriveDisplayNodesOptions {
  hasSpotlightDim: boolean;
  spotlightResult: PathSpotlightResult | null;
  isReadOnly: boolean;
}

function sortNodesByHierarchy(nodes: FlowNode[], nodeById: Map<string, FlowNode>): FlowNode[] {
  const depthCache = new Map<string, number>();
  const getDepth = (node: FlowNode): number => {
    const cached = depthCache.get(node.id);
    if (cached !== undefined) return cached;
    let depth = 0;
    const visited = new Set<string>([node.id]);
    let curr: FlowNode | undefined = node;
    while (curr?.parentId && !visited.has(curr.parentId)) {
      visited.add(curr.parentId);
      const parent = nodeById.get(curr.parentId);
      if (!parent) break;
      depth++;
      curr = parent;
    }
    depthCache.set(node.id, depth);
    return depth;
  };
  return [...nodes].sort((a, b) => getDepth(a) - getDepth(b));
}

export function deriveDisplayNodes(
  nodes: FlowNode[],
  options: DeriveDisplayNodesOptions,
  cache?: Map<string, DisplayNodeCacheEntry>
): FlowNode[] {
  const { hasSpotlightDim, spotlightResult, isReadOnly } = options;

  const nodeById = new Map<string, FlowNode>();
  const lockedNodeIds = new Set<string>();
  const unresolvedParentIds: string[] = [];
  let hasSwimlaneZAdjust = false;

  for (const n of nodes) {
    nodeById.set(n.id, n);
    if (isNodeLocked(n, 'position')) {
      lockedNodeIds.add(n.id);
    }
    if (n.parentId && !nodeById.has(n.parentId)) {
      unresolvedParentIds.push(n.parentId);
    }
    const baseZ = getSwimlaneBaseZIndex(n.type);
    if (baseZ !== undefined && (n.zIndex !== baseZ || n.style?.zIndex !== undefined)) {
      hasSwimlaneZAdjust = true;
    }
  }

  const needsTopologicalSort = unresolvedParentIds.some((pid) => nodeById.has(pid));

  const lockedContainers = new Set<string>();
  if (lockedNodeIds.size > 0) {
    for (const n of nodes) {
      if (n.parentId && lockedNodeIds.has(n.id)) {
        const visited = new Set<string>([n.id]);
        let curr: string | undefined = n.parentId;
        while (curr && !visited.has(curr)) {
          visited.add(curr);
          lockedContainers.add(curr);
          curr = nodeById.get(curr)?.parentId;
        }
      }
    }
  }

  const hasAnyLocked = lockedNodeIds.size > 0 || lockedContainers.size > 0;
  if (!hasSpotlightDim && !hasAnyLocked && !isReadOnly && !hasSwimlaneZAdjust && !needsTopologicalSort) {
    cache?.clear();
    return nodes;
  }

  const orderedNodes = needsTopologicalSort ? sortNodesByHierarchy(nodes, nodeById) : nodes;
  const nextCache = cache ? new Map<string, DisplayNodeCacheEntry>() : null;
  const result = orderedNodes.map((node) => {
    const isLockedFromDrag = isReadOnly || lockedNodeIds.has(node.id) || lockedContainers.has(node.id);
    const draggable: false | undefined = isLockedFromDrag ? false : undefined;
    const baseZ = getSwimlaneBaseZIndex(node.type);
    const targetZ = baseZ ?? node.zIndex;
    const hasStyleZOverride = baseZ !== undefined && node.style?.zIndex !== undefined;
    const isHighlighted =
      hasSpotlightDim && spotlightResult
        ? spotlightResult.nodeIds.has(node.id) || spotlightResult.laneIds.has(node.id)
        : true;

    if (!hasSpotlightDim && draggable === node.draggable && targetZ === node.zIndex && !hasStyleZOverride) {
      return node;
    }

    const cached = cache?.get(node.id);
    if (
      cached &&
      cached.raw === node &&
      cached.draggable === draggable &&
      cached.zIndex === targetZ &&
      cached.hasSpotlightDim === hasSpotlightDim &&
      cached.isHighlighted === isHighlighted
    ) {
      nextCache?.set(node.id, cached);
      return cached.derived;
    }

    let nextStyle = node.style;
    if (hasStyleZOverride && node.style) {
      const { zIndex: _omitted, ...restStyle } = node.style;
      nextStyle = restStyle;
    }
    if (hasSpotlightDim) {
      nextStyle = {
        ...nextStyle,
        opacity: isHighlighted ? 1 : 0.15,
        filter: isHighlighted ? undefined : 'grayscale(80%)',
        transition: 'opacity 0.2s ease, filter 0.2s ease',
      };
    }

    const derived: FlowNode = {
      ...node,
      draggable,
      ...(targetZ !== undefined ? { zIndex: targetZ } : {}),
      style: nextStyle,
    };

    nextCache?.set(node.id, {
      raw: node,
      draggable,
      zIndex: targetZ,
      hasSpotlightDim,
      isHighlighted,
      derived,
    });
    return derived;
  });

  if (cache && nextCache) {
    cache.clear();
    for (const [k, v] of nextCache) cache.set(k, v);
  }
  return result;
}

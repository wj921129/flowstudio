import type { FlowNode } from '@flowstudio/shared';
import type { PathSpotlightResult } from './path-spotlight';
import { isNodeLocked } from './node-lock-manager';

export interface DisplayNodeCacheEntry {
  raw: FlowNode;
  draggable: false | undefined;
  hasSpotlightDim: boolean;
  isHighlighted: boolean;
  derived: FlowNode;
}

export interface DeriveDisplayNodesOptions {
  hasSpotlightDim: boolean;
  spotlightResult: PathSpotlightResult | null;
  isReadOnly: boolean;
}

export function deriveDisplayNodes(
  nodes: FlowNode[],
  options: DeriveDisplayNodesOptions,
  cache?: Map<string, DisplayNodeCacheEntry>
): FlowNode[] {
  const { hasSpotlightDim, spotlightResult, isReadOnly } = options;

  const nodeById = new Map<string, FlowNode>();
  const lockedNodeIds = new Set<string>();
  for (const n of nodes) {
    nodeById.set(n.id, n);
    if (isNodeLocked(n, 'position')) {
      lockedNodeIds.add(n.id);
    }
  }

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
  if (!hasSpotlightDim && !hasAnyLocked && !isReadOnly) {
    cache?.clear();
    return nodes;
  }

  const nextCache = cache ? new Map<string, DisplayNodeCacheEntry>() : null;
  const result = nodes.map((node) => {
    const isLockedFromDrag = isReadOnly || lockedNodeIds.has(node.id) || lockedContainers.has(node.id);
    const draggable: false | undefined = isLockedFromDrag ? false : undefined;
    const isHighlighted =
      hasSpotlightDim && spotlightResult
        ? spotlightResult.nodeIds.has(node.id) || spotlightResult.laneIds.has(node.id)
        : true;

    if (!hasSpotlightDim && draggable === node.draggable) {
      return node;
    }

    const cached = cache?.get(node.id);
    if (
      cached &&
      cached.raw === node &&
      cached.draggable === draggable &&
      cached.hasSpotlightDim === hasSpotlightDim &&
      cached.isHighlighted === isHighlighted
    ) {
      nextCache?.set(node.id, cached);
      return cached.derived;
    }

    const derived: FlowNode = {
      ...node,
      draggable,
      style: hasSpotlightDim
        ? {
            ...node.style,
            opacity: isHighlighted ? 1 : 0.15,
            filter: isHighlighted ? undefined : 'grayscale(80%)',
            transition: 'opacity 0.2s ease, filter 0.2s ease',
          }
        : node.style,
    };

    nextCache?.set(node.id, {
      raw: node,
      draggable,
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

import type { FlowNode, XYPosition, Dimensions } from '@flowstudio/shared';
import {
  findObstacleAvoidingPath,
  findSafeLabelPosition,
  type ObstacleBox,
} from './obstacle-avoidance-router';
import {
  buildWaypointPath,
  type EdgeAnchorDirection,
  type PathSegment,
} from './waypoint-path-utils';
import {
  extractHorizontalSegments,
  buildBridgeJumpPath,
  type HorizontalSegment,
} from './bridge-jump-utils';
import {
  computeEdgeOverlaps,
  type EdgeOverlapSegment,
} from './edge-overlap-utils';

export interface RouteEdgeParams {
  id: string;
  source: XYPosition;
  target: XYPosition;
  sourcePosition?: EdgeAnchorDirection;
  targetPosition?: EdgeAnchorDirection;
  sourceNodeId?: string;
  targetNodeId?: string;
  manualWaypoints?: XYPosition[];
  label?: string;
  labelSize?: Dimensions;
}

export interface ComputedEdgeRoute {
  path: string;
  waypoints: XYPosition[];
  labelPosition: XYPosition;
  segments: PathSegment[];
}

export class EdgeRoutingManager {
  private static instance: EdgeRoutingManager;
  private readonly cellSize = 250;
  private obstaclesMap = new Map<string, ObstacleBox>();
  private gridBuckets = new Map<string, Set<string>>();
  private nodeCellKeys = new Map<string, string[]>();
  private nodePositions = new Map<string, string>();
  private nodeParentMap = new Map<string, string | undefined>();
  private obstaclesVersion = 0;
  private edgeHorizontalSegments = new Map<string, HorizontalSegment[]>();
  private edgeSegmentsMap = new Map<string, PathSegment[]>();
  private edgeSegmentSignatures = new Map<string, string>();
  private overlapCache: EdgeOverlapSegment[] | null = null;
  private overlapByEdgeCache = new Map<string, EdgeOverlapSegment[]>();
  private overlapVersion = 0;
  private overlapListeners = new Set<() => void>();
  private overlapNotifyScheduled = false;
  private routeCache = new Map<string, ComputedEdgeRoute>();
  private rafScheduled = false;
  private pendingCallbacks = new Set<() => void>();

  static getInstance(): EdgeRoutingManager {
    if (!EdgeRoutingManager.instance) {
      EdgeRoutingManager.instance = new EdgeRoutingManager();
    }
    return EdgeRoutingManager.instance;
  }

  private getCellKeysForBox(x: number, y: number, width: number, height: number): string[] {
    const minCx = Math.floor(x / this.cellSize);
    const maxCx = Math.floor((x + Math.max(0, width)) / this.cellSize);
    const minCy = Math.floor(y / this.cellSize);
    const maxCy = Math.floor((y + Math.max(0, height)) / this.cellSize);
    const keys: string[] = [];
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        keys.push(`${cx}:${cy}`);
      }
    }
    return keys;
  }

  updateNodes(nodes: FlowNode[]): void {
    const nodeMap = new Map<string, FlowNode>();
    for (const n of nodes) nodeMap.set(n.id, n);

    const currentNodeIds = new Set<string>();
    let changed = false;

    for (const node of nodes) {
      currentNodeIds.add(node.id);
      this.nodeParentMap.set(node.id, node.parentId);

      let wx = node.position.x;
      let wy = node.position.y;
      let curr = node.parentId ? nodeMap.get(node.parentId) : undefined;
      const visited = new Set<string>();
      while (curr && !visited.has(curr.id)) {
        visited.add(curr.id);
        wx += curr.position.x;
        wy += curr.position.y;
        curr = curr.parentId ? nodeMap.get(curr.parentId) : undefined;
      }

      const w = node.width ?? 120;
      const h = node.height ?? 60;
      const posKey = `${wx},${wy},${w},${h},${node.parentId ?? ''}`;

      if (this.nodePositions.get(node.id) === posKey) continue;

      changed = true;
      const oldKeys = this.nodeCellKeys.get(node.id);
      if (oldKeys) {
        for (const k of oldKeys) {
          const bucket = this.gridBuckets.get(k);
          if (bucket) {
            bucket.delete(node.id);
            if (bucket.size === 0) this.gridBuckets.delete(k);
          }
        }
      }

      const newKeys = this.getCellKeysForBox(wx, wy, w, h);
      for (const k of newKeys) {
        let bucket = this.gridBuckets.get(k);
        if (!bucket) {
          bucket = new Set<string>();
          this.gridBuckets.set(k, bucket);
        }
        bucket.add(node.id);
      }

      this.nodeCellKeys.set(node.id, newKeys);
      this.nodePositions.set(node.id, posKey);
      this.obstaclesMap.set(node.id, {
        id: node.id,
        x: wx,
        y: wy,
        width: w,
        height: h,
        isLane: node.type === 'lane' || node.type === 'pool' || node.type === 'group',
      });
    }

    for (const oldId of Array.from(this.nodePositions.keys())) {
      if (!currentNodeIds.has(oldId)) {
        changed = true;
        const oldKeys = this.nodeCellKeys.get(oldId);
        if (oldKeys) {
          for (const k of oldKeys) {
            const bucket = this.gridBuckets.get(k);
            if (bucket) {
              bucket.delete(oldId);
              if (bucket.size === 0) this.gridBuckets.delete(k);
            }
          }
        }
        this.nodeCellKeys.delete(oldId);
        this.obstaclesMap.delete(oldId);
        this.nodePositions.delete(oldId);
        this.nodeParentMap.delete(oldId);
      }
    }

    if (!changed) return;
    this.obstaclesVersion++;
    this.routeCache.clear();
  }

  getObstacles(): ObstacleBox[] {
    return Array.from(this.obstaclesMap.values());
  }

  getCandidateObstacles(
    source: XYPosition,
    target: XYPosition,
    margin = 240,
    extraIncludeIds?: Set<string>
  ): ObstacleBox[] {
    const minX = Math.min(source.x, target.x) - margin;
    const maxX = Math.max(source.x, target.x) + margin;
    const minY = Math.min(source.y, target.y) - margin;
    const maxY = Math.max(source.y, target.y) + margin;

    const minCx = Math.floor(minX / this.cellSize);
    const maxCx = Math.floor(maxX / this.cellSize);
    const minCy = Math.floor(minY / this.cellSize);
    const maxCy = Math.floor(maxY / this.cellSize);

    const matchedIds = new Set<string>();
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.gridBuckets.get(`${cx}:${cy}`);
        if (bucket) {
          for (const id of bucket) matchedIds.add(id);
        }
      }
    }

    if (extraIncludeIds) {
      for (const id of extraIncludeIds) {
        if (this.obstaclesMap.has(id)) matchedIds.add(id);
      }
    }

    const result: ObstacleBox[] = [];
    for (const id of matchedIds) {
      const box = this.obstaclesMap.get(id);
      if (box) result.push(box);
    }
    return result;
  }

  getOtherHorizontalSegments(excludeEdgeId: string): HorizontalSegment[] {
    const list: HorizontalSegment[] = [];
    for (const [id, segs] of this.edgeHorizontalSegments.entries()) {
      if (id !== excludeEdgeId) {
        for (const s of segs) list.push(s);
      }
    }
    return list;
  }

  private scheduleOverlapNotify(): void {
    if (this.overlapNotifyScheduled) return;
    this.overlapNotifyScheduled = true;
    this.scheduleRaf(() => {
      this.overlapNotifyScheduled = false;
      this.overlapVersion++;
      for (const listener of this.overlapListeners) listener();
    });
  }

  private invalidateOverlaps(): void {
    this.overlapCache = null;
    this.overlapByEdgeCache.clear();
    if (this.overlapListeners.size > 0) {
      this.scheduleOverlapNotify();
    } else {
      this.overlapVersion++;
    }
  }

  registerEdgeSegments(edgeId: string, segments: PathSegment[]): void {
    const hSegs = extractHorizontalSegments(edgeId, segments);
    this.edgeHorizontalSegments.set(edgeId, hSegs);
    const sig = segments
      .map((s) => `${Math.round(s.start.x * 10)},${Math.round(s.start.y * 10)}->${Math.round(s.end.x * 10)},${Math.round(s.end.y * 10)}`)
      .join('|');
    if (this.edgeSegmentSignatures.get(edgeId) === sig) return;
    this.edgeSegmentSignatures.set(edgeId, sig);
    this.edgeSegmentsMap.set(edgeId, segments);
    this.invalidateOverlaps();
  }

  unregisterEdge(edgeId: string): void {
    this.edgeHorizontalSegments.delete(edgeId);
    this.routeCache.delete(edgeId);
    if (this.edgeSegmentsMap.has(edgeId)) {
      this.edgeSegmentsMap.delete(edgeId);
      this.edgeSegmentSignatures.delete(edgeId);
      this.invalidateOverlaps();
    }
  }

  getOverlapVersion(): number {
    return this.overlapVersion;
  }

  subscribeOverlaps(listener: () => void): () => void {
    this.overlapListeners.add(listener);
    return () => {
      this.overlapListeners.delete(listener);
    };
  }

  getAllOverlaps(): EdgeOverlapSegment[] {
    if (!this.overlapCache) {
      const all = computeEdgeOverlaps(this.edgeSegmentsMap);
      this.overlapCache = all;
      this.overlapByEdgeCache.clear();
      for (const seg of all) {
        for (const eid of seg.edgeIds) {
          let list = this.overlapByEdgeCache.get(eid);
          if (!list) {
            list = [];
            this.overlapByEdgeCache.set(eid, list);
          }
          list.push(seg);
        }
      }
    }
    return this.overlapCache;
  }

  getOverlapsForEdge(edgeId: string): EdgeOverlapSegment[] {
    this.getAllOverlaps();
    return this.overlapByEdgeCache.get(edgeId) ?? [];
  }

  routeEdge(params: RouteEdgeParams): ComputedEdgeRoute {
    const {
      id,
      source,
      target,
      sourcePosition,
      targetPosition,
      sourceNodeId,
      targetNodeId,
      manualWaypoints,
      label,
      labelSize,
    } = params;

    const manualKey = manualWaypoints ? JSON.stringify(manualWaypoints) : '';
    const cacheKey = `${id}:${source.x},${source.y}:${target.x},${target.y}:${sourcePosition}:${targetPosition}:${manualKey}:${this.obstaclesVersion}`;

    const cached = this.routeCache.get(cacheKey);
    if (cached) return cached;

    const extraIds = new Set<string>();
    const selfContainerIds = new Set<string>();
    const collectAncestors = (nid?: string) => {
      let cur = nid ? this.nodeParentMap.get(nid) : undefined;
      const seen = new Set<string>();
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        selfContainerIds.add(cur);
        cur = this.nodeParentMap.get(cur);
      }
    };
    if (sourceNodeId) {
      extraIds.add(sourceNodeId);
      collectAncestors(sourceNodeId);
    }
    if (targetNodeId) {
      extraIds.add(targetNodeId);
      collectAncestors(targetNodeId);
    }
    const candidateObstacles = this.getCandidateObstacles(source, target, 240, extraIds);

    let waypoints: XYPosition[];
    if (manualWaypoints && manualWaypoints.length > 0) {
      waypoints = manualWaypoints;
    } else {
      waypoints = findObstacleAvoidingPath(
        source,
        target,
        sourcePosition,
        targetPosition,
        candidateObstacles,
        { sourceNodeId, targetNodeId, selfContainerIds, padding: 14 }
      );
    }

    const { segments, labelPosition: defaultLabelPos } = buildWaypointPath(source, target, waypoints);

    this.registerEdgeSegments(id, segments);

    const otherHSegs = this.getOtherHorizontalSegments(id);
    const bridgePath = buildBridgeJumpPath(segments, otherHSegs, 5);

    let finalLabelPos = defaultLabelPos;
    if (label) {
      finalLabelPos = findSafeLabelPosition(segments, candidateObstacles, labelSize);
    }

    const result: ComputedEdgeRoute = {
      path: bridgePath,
      waypoints,
      labelPosition: finalLabelPos,
      segments,
    };

    this.routeCache.set(cacheKey, result);
    return result;
  }

  scheduleRaf(callback: () => void): void {
    this.pendingCallbacks.add(callback);
    if (this.rafScheduled) return;

    this.rafScheduled = true;
    const runner = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (fn: () => void) => setTimeout(fn, 16);

    runner(() => {
      this.rafScheduled = false;
      const callbacks = Array.from(this.pendingCallbacks);
      this.pendingCallbacks.clear();
      for (const cb of callbacks) cb();
    });
  }

  reset(): void {
    this.obstaclesMap.clear();
    this.gridBuckets.clear();
    this.nodeCellKeys.clear();
    this.nodePositions.clear();
    this.nodeParentMap.clear();
    this.edgeHorizontalSegments.clear();
    this.edgeSegmentsMap.clear();
    this.edgeSegmentSignatures.clear();
    this.overlapCache = null;
    this.overlapByEdgeCache.clear();
    this.overlapNotifyScheduled = false;
    this.overlapVersion = 0;
    this.routeCache.clear();
    this.pendingCallbacks.clear();
    this.rafScheduled = false;
    this.obstaclesVersion = 0;
  }

  clear(): void {
    this.reset();
  }
}

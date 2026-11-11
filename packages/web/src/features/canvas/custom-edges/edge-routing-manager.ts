import type { FlowNode, XYPosition, Dimensions } from '@flowstudio/shared';
import {
  findObstacleAvoidingPath,
  findSafeLabelPosition,
  type ObstacleBox,
} from './obstacle-avoidance-router';
import {
  buildWaypointPath,
  deriveDefaultOrthogonalWaypoints,
  type EdgeAnchorDirection,
  type PathSegment,
} from './waypoint-path-utils';
import {
  extractHorizontalSegments,
  buildBridgeJumpPath,
  type HorizontalSegment,
} from './bridge-jump-utils';

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
  private obstacles: ObstacleBox[] = [];
  private obstaclesVersion = 0;
  private nodePositions = new Map<string, string>();
  private edgeHorizontalSegments = new Map<string, HorizontalSegment[]>();
  private routeCache = new Map<string, ComputedEdgeRoute>();
  private rafScheduled = false;
  private pendingCallbacks = new Set<() => void>();

  static getInstance(): EdgeRoutingManager {
    if (!EdgeRoutingManager.instance) {
      EdgeRoutingManager.instance = new EdgeRoutingManager();
    }
    return EdgeRoutingManager.instance;
  }

  updateNodes(nodes: FlowNode[]): void {
    const nodeMap = new Map<string, FlowNode>();
    for (const n of nodes) nodeMap.set(n.id, n);

    let changed = false;
    if (this.nodePositions.size !== nodes.length) {
      changed = true;
    } else {
      for (const n of nodes) {
        const key = `${n.position.x},${n.position.y},${n.width},${n.height},${n.parentId ?? ''}`;
        if (this.nodePositions.get(n.id) !== key) {
          changed = true;
          break;
        }
      }
    }

    if (!changed) return;

    this.nodePositions.clear();
    const nextObstacles: ObstacleBox[] = [];

    for (const node of nodes) {
      const posKey = `${node.position.x},${node.position.y},${node.width},${node.height},${node.parentId ?? ''}`;
      this.nodePositions.set(node.id, posKey);

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
      const isLane = node.type === 'lane' || node.type === 'pool' || node.type === 'group';

      nextObstacles.push({
        id: node.id,
        x: wx,
        y: wy,
        width: w,
        height: h,
        isLane,
      });
    }

    this.obstacles = nextObstacles;
    this.obstaclesVersion++;
    this.routeCache.clear();
  }

  getObstacles(): ObstacleBox[] {
    return this.obstacles;
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

  registerEdgeSegments(edgeId: string, segments: PathSegment[]): void {
    const hSegs = extractHorizontalSegments(edgeId, segments);
    this.edgeHorizontalSegments.set(edgeId, hSegs);
  }

  unregisterEdge(edgeId: string): void {
    this.edgeHorizontalSegments.delete(edgeId);
    this.routeCache.delete(edgeId);
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

    let waypoints: XYPosition[];
    if (manualWaypoints && manualWaypoints.length > 0) {
      waypoints = manualWaypoints;
    } else {
      waypoints = findObstacleAvoidingPath(
        source,
        target,
        sourcePosition,
        targetPosition,
        this.obstacles,
        { sourceNodeId, targetNodeId, padding: 14 }
      );
    }

    const { segments, labelPosition: defaultLabelPos } = buildWaypointPath(source, target, waypoints);

    this.registerEdgeSegments(id, segments);

    const otherHSegs = this.getOtherHorizontalSegments(id);
    const bridgePath = buildBridgeJumpPath(segments, otherHSegs, 5);

    let finalLabelPos = defaultLabelPos;
    if (label) {
      finalLabelPos = findSafeLabelPosition(segments, this.obstacles, labelSize);
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

  clear(): void {
    this.obstacles = [];
    this.obstaclesVersion = 0;
    this.nodePositions.clear();
    this.edgeHorizontalSegments.clear();
    this.routeCache.clear();
    this.pendingCallbacks.clear();
    this.rafScheduled = false;
  }
}

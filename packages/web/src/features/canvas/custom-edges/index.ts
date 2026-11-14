import type { EdgeTypes } from '@xyflow/react';
import { OrthogonalEdge } from './orthogonal-edge';
export { EdgeRoutingManager } from './edge-routing-manager';
export { findObstacleAvoidingPath, findSafeLabelPosition, computeOptimalHandles } from './obstacle-avoidance-router';
export { buildBridgeJumpPath, extractHorizontalSegments } from './bridge-jump-utils';
export { buildWaypointPath, deriveDefaultOrthogonalWaypoints } from './waypoint-path-utils';

export const edgeTypes: EdgeTypes = {
  orthogonal: OrthogonalEdge,
  smoothstep: OrthogonalEdge,
  straight: OrthogonalEdge,
};

export { OrthogonalEdge };

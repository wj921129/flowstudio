import type { EdgeTypes } from '@xyflow/react';
import { OrthogonalEdge, FlowDotEdgeIdsContext } from './orthogonal-edge';
export { EdgeRoutingManager } from './edge-routing-manager';
export { findObstacleAvoidingPath, findSafeLabelPosition, computeOptimalHandles } from './obstacle-avoidance-router';
export { buildBridgeJumpPath, extractHorizontalSegments } from './bridge-jump-utils';
export { buildWaypointPath, deriveDefaultOrthogonalWaypoints } from './waypoint-path-utils';
export {
  computeEdgeOverlaps,
  computeOverlapStrokeWidth,
  pickOverlapRepresentative,
  type EdgeOverlapSegment,
} from './edge-overlap-utils';

export const edgeTypes: EdgeTypes = {
  orthogonal: OrthogonalEdge,
  smoothstep: OrthogonalEdge,
  straight: OrthogonalEdge,
};

export { OrthogonalEdge, FlowDotEdgeIdsContext };

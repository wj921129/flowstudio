import type { EdgeStrokeStyle, FlowNodeType } from '../types.js';

export type Paradigm = 'circuit-flow' | 'timeline-annotated' | 'swimlane' | 'tiered-dag' | 'tree';
export type SwimlaneOrientation = 'horizontal' | 'vertical';
export type SpecEdgeRouting = 'orthogonal' | 'straight';
export type SpecRole = 'main' | 'branch' | 'annotation';
export type SpecEdgeKind = 'next' | 'branch' | 'loop' | 'jump' | 'annotate' | 'tree';

export interface SpecNode {
  id: string;
  label: string;
  type?: FlowNodeType;
  role?: SpecRole;
  laneId?: string;
  attachTo?: string;
  description?: string;
  earlyExit?: boolean;
}

export interface SpecEdge {
  from: string;
  to: string;
  kind?: SpecEdgeKind;
  label?: string;
  strokeStyle?: EdgeStrokeStyle;
  routingType?: SpecEdgeRouting;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface DiagramSpec {
  paradigm: Paradigm;
  orientation?: SwimlaneOrientation;
  edgeRouting?: SpecEdgeRouting;
  title?: string;
  lanes?: Array<{ id: string; label: string }>;
  nodes: SpecNode[];
  edges: SpecEdge[];
}

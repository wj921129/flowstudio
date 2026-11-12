import type { FlowNodeType } from '../types.js';

export type Paradigm = 'vertical-flow' | 'timeline-annotated' | 'swimlane' | 'tiered-dag' | 'tree';
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
}

export interface SpecEdge {
  from: string;
  to: string;
  kind?: SpecEdgeKind;
  label?: string;
}

export interface DiagramSpec {
  paradigm: Paradigm;
  title?: string;
  lanes?: Array<{ id: string; label: string }>;
  nodes: SpecNode[];
  edges: SpecEdge[];
}
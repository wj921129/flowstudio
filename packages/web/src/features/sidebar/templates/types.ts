import type { FlowNodeType } from '@flowstudio/shared';

export type TemplateCategory = 'flowchart' | 'swimlane' | 'topology' | 'org-chart';

export interface TemplateNode {
  id: string;
  type: FlowNodeType;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  parentId?: string;
  data: {
    label: string;
    type: FlowNodeType;
    parentId?: string;
    isFrame?: boolean;
    headerColor?: string;
    laneTitle?: string;
    style?: Record<string, unknown>;
    description?: string;
    [key: string]: unknown;
  };
}

export interface TemplateEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: string;
  data?: {
    label?: string;
    routingType?: 'orthogonal' | 'bezier' | 'straight';
    [key: string]: unknown;
  };
}

export interface DiagramTemplate {
  id: string;
  title: string;
  category: TemplateCategory;
  description: string;
  nodes: TemplateNode[];
  edges: TemplateEdge[];
}

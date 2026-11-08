import type { FlowNode, FlowEdge } from '@flowstudio/shared';

export type CollaborationConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface DiagramBridgeState {
  nodes: FlowNode[];
  edges: FlowEdge[];
  title: string;
  themeId?: string;
}

import type { FlowEdge, FlowNode, XYPosition } from '../types.js';

export interface RenderFixed {
  position: XYPosition;
  width: number;
  height: number;
}

export interface RenderOptions {
  idPrefix?: string;
  origin?: XYPosition;
  fixed?: Map<string, RenderFixed>;
  laneSizes?: Map<string, { width: number; height: number }>;
  poolPosition?: XYPosition;
  obstacles?: Map<string, RenderFixed>;
}

export interface RenderContext {
  idPrefix: string;
  origin: XYPosition;
  fixed: Map<string, RenderFixed>;
  laneSizes: Map<string, { width: number; height: number }>;
  poolPosition?: XYPosition;
  obstacles: Map<string, RenderFixed>;
}

export interface RenderResult {
  nodes: FlowNode[];
  edges: FlowEdge[];
  warnings: string[];
}
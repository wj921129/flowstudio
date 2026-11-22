import type { FlowNode } from '@flowstudio/shared';
import { getNodeWorldPosition } from './split-insert-manager';
import { getNodeDimensions } from './group-calculator';

export type CanvasTranslateExtent = [[number, number], [number, number]];

export const CANVAS_BASE_EXTENT: CanvasTranslateExtent = [
  [-4000, -4000],
  [6000, 6000],
];

export const CANVAS_EXTENT_PADDING = 2000;

export interface MiniMapRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MiniMapViewBoxLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function computeCanvasTranslateExtent(nodes: FlowNode[]): CanvasTranslateExtent {
  let minX = CANVAS_BASE_EXTENT[0][0];
  let minY = CANVAS_BASE_EXTENT[0][1];
  let maxX = CANVAS_BASE_EXTENT[1][0];
  let maxY = CANVAS_BASE_EXTENT[1][1];

  if (nodes.length === 0) {
    return [
      [minX, minY],
      [maxX, maxY],
    ];
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const node of nodes) {
    const pos = getNodeWorldPosition(node, byId);
    const { width, height } = getNodeDimensions(node);
    minX = Math.min(minX, pos.x - CANVAS_EXTENT_PADDING);
    minY = Math.min(minY, pos.y - CANVAS_EXTENT_PADDING);
    maxX = Math.max(maxX, pos.x + width + CANVAS_EXTENT_PADDING);
    maxY = Math.max(maxY, pos.y + height + CANVAS_EXTENT_PADDING);
  }

  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

export function resolveMiniMapFlowPosition(
  clientX: number,
  clientY: number,
  rect: MiniMapRectLike,
  viewBox: MiniMapViewBoxLike,
  extent?: CanvasTranslateExtent
): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0 || viewBox.width <= 0 || viewBox.height <= 0) {
    return {
      x: viewBox.x + viewBox.width / 2,
      y: viewBox.y + viewBox.height / 2,
    };
  }

  const scale = Math.min(rect.width / viewBox.width, rect.height / viewBox.height);
  const offsetX = (rect.width - viewBox.width * scale) / 2;
  const offsetY = (rect.height - viewBox.height * scale) / 2;

  let x = viewBox.x + (clientX - rect.left - offsetX) / scale;
  let y = viewBox.y + (clientY - rect.top - offsetY) / scale;

  if (extent) {
    x = Math.max(extent[0][0], Math.min(extent[1][0], x));
    y = Math.max(extent[0][1], Math.min(extent[1][1], y));
  }

  return { x, y };
}

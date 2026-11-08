/**
 * @fileoverview 图元拖拽智能对齐吸附与参考线计算
 * @description 在世界坐标系下比较拖拽集合与其他图元的边线/中心线，给出位移修正量与参考线段
 */

import type { FlowNode, FlowNodeType, XYPosition } from '@flowstudio/shared';
import { getNodeDimensions } from './group-calculator';

/**
 * 世界坐标系下的轴对齐包围盒
 */
export interface AlignBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 对齐参考线：vertical 为 x = position 的竖线，horizontal 为 y = position 的横线
 */
export interface AlignGuide {
  axis: 'vertical' | 'horizontal';
  position: number;
  start: number;
  end: number;
}

/**
 * 吸附结果：offset 为需要叠加到本次拖拽位移上的世界坐标修正量
 */
export interface AlignmentSnapResult {
  offset: XYPosition;
  guides: AlignGuide[];
}

/**
 * 吸附后的拖拽节点落点 (节点自身坐标系，与 React Flow position change 对齐) 与参考线
 */
export interface DragAlignmentOutcome {
  positions: Map<string, XYPosition>;
  guides: AlignGuide[];
}

/** 参考线感应半径 (屏幕像素)，按缩放反算为世界坐标阈值 */
const ALIGN_SENSITIVITY_PX = 8;

/** 世界坐标感应半径下限：避免高缩放比例下轻微靠近就强行吸附 */
const MIN_THRESHOLD = 4;

/** 世界坐标感应半径上限：避免低缩放比例下吸附跨过大半个画布 */
const MAX_THRESHOLD = 20;

/**
 * 容器类图元不作为吸附目标：其边线横跨整条泳道，会盖过邻近图元的对齐线索
 */
const CONTAINER_NODE_TYPES: ReadonlySet<FlowNodeType> = new Set<FlowNodeType>([
  'pool',
  'lane',
  'group',
]);

/**
 * 将屏幕像素感应半径换算为当前缩放下的世界坐标阈值
 */
export function resolveSnapThreshold(zoom: number): number {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, ALIGN_SENSITIVITY_PX / safeZoom));
}

/**
 * 竖直线候选：左边、右边、水平中心（边线优先于中心线参与择优）
 */
function verticalAnchors(box: AlignBox): number[] {
  return [box.x, box.x + box.width, box.x + box.width / 2];
}

/**
 * 水平线候选：上边、下边、垂直中心
 */
function horizontalAnchors(box: AlignBox): number[] {
  return [box.y, box.y + box.height, box.y + box.height / 2];
}

/**
 * 在两组候选线中寻找阈值内位移最小的一组，位移相等时保留先出现的候选
 */
function findBestDelta(
  draggedLines: number[],
  targetLines: number[],
  limit: number
): { delta: number; position: number } | null {
  let best: { delta: number; position: number } | null = null;

  for (const draggedLine of draggedLines) {
    for (const targetLine of targetLines) {
      const delta = targetLine - draggedLine;
      const absDelta = Math.abs(delta);
      if (absDelta >= limit) continue;
      if (best && absDelta >= Math.abs(best.delta)) continue;
      best = { delta, position: targetLine };
    }
  }

  return best;
}

/**
 * 计算拖拽包围盒相对其他图元的对齐吸附量与参考线
 * @param dragged 拖拽集合的世界坐标包围盒
 * @param targets 可作为对齐目标的图元包围盒
 * @param threshold 世界坐标感应半径
 */
export function computeAlignmentSnap(
  dragged: AlignBox,
  targets: AlignBox[],
  threshold: number
): AlignmentSnapResult {
  const guides: AlignGuide[] = [];
  let offsetX = 0;
  let offsetY = 0;

  let bestX: { delta: number; position: number; start: number; end: number } | null = null;
  for (const target of targets) {
    // 纵向投影不相交则不构成竖向对齐线索，否则会把图元从很远处磁吸过来
    if (target.y >= dragged.y + dragged.height || dragged.y >= target.y + target.height) continue;

    const found = findBestDelta(
      verticalAnchors(dragged),
      verticalAnchors(target),
      bestX ? Math.abs(bestX.delta) : threshold
    );
    if (found) {
      bestX = {
        ...found,
        start: Math.min(dragged.y, target.y),
        end: Math.max(dragged.y + dragged.height, target.y + target.height),
      };
    }
  }

  if (bestX) {
    offsetX = bestX.delta;
    guides.push({ axis: 'vertical', position: bestX.position, start: bestX.start, end: bestX.end });
  }

  const shifted: AlignBox = { ...dragged, x: dragged.x + offsetX };

  let bestY: { delta: number; position: number; start: number; end: number } | null = null;
  for (const target of targets) {
    if (target.x >= shifted.x + shifted.width || shifted.x >= target.x + target.width) continue;

    const found = findBestDelta(
      horizontalAnchors(shifted),
      horizontalAnchors(target),
      bestY ? Math.abs(bestY.delta) : threshold
    );
    if (found) {
      bestY = {
        ...found,
        start: Math.min(shifted.x, target.x),
        end: Math.max(shifted.x + shifted.width, target.x + target.width),
      };
    }
  }

  if (bestY) {
    offsetY = bestY.delta;
    guides.push({ axis: 'horizontal', position: bestY.position, start: bestY.start, end: bestY.end });
  }

  return { offset: { x: offsetX, y: offsetY }, guides };
}

/**
 * 创建带缓存的节点世界坐标解析器，规避父子链上的重复查找
 */
function makeWorldOriginResolver(byId: Map<string, FlowNode>) {
  const cache = new Map<string, XYPosition>();

  const resolve = (node: FlowNode, path: Set<string>): XYPosition => {
    const cached = cache.get(node.id);
    if (cached) return cached;
    // 防循环引用：链上已出现过的节点直接按自身坐标处理
    if (path.has(node.id)) return { x: node.position.x, y: node.position.y };

    path.add(node.id);
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    const origin = parent ? resolve(parent, path) : { x: 0, y: 0 };
    path.delete(node.id);

    const world = { x: node.position.x + origin.x, y: node.position.y + origin.y };
    cache.set(node.id, world);
    return world;
  };

  return (node: FlowNode): XYPosition => resolve(node, new Set<string>());
}

/**
 * 判定图元是否为被拖拽容器的子孙：其位置随容器一起移动，不能作为静态对齐目标
 */
function isDescendantOfDragged(
  node: FlowNode,
  draggedIds: ReadonlySet<string>,
  byId: Map<string, FlowNode>
): boolean {
  const visited = new Set<string>();
  let parentId = node.parentId;

  while (parentId && !visited.has(parentId)) {
    if (draggedIds.has(parentId)) return true;
    visited.add(parentId);
    parentId = byId.get(parentId)?.parentId;
  }

  return false;
}

/**
 * 解析拖拽集合的世界坐标：容器与子节点同批拖拽时，子节点依赖容器的新落点
 */
function resolveDraggedWorldPositions(
  nodes: FlowNode[],
  byId: Map<string, FlowNode>,
  draggedPositions: Map<string, XYPosition>
): Map<string, XYPosition> {
  const originOf = makeWorldOriginResolver(byId);
  const world = new Map<string, XYPosition>();
  let pending = Array.from(draggedPositions.keys());

  while (pending.length > 0) {
    const deferred: string[] = [];

    for (const id of pending) {
      const node = byId.get(id);
      const local = draggedPositions.get(id)!;
      if (!node) {
        world.set(id, local);
        continue;
      }

      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (parent && draggedPositions.has(parent.id) && !world.has(parent.id)) {
        deferred.push(id);
        continue;
      }

      const parentOrigin = parent ? originOf(parent) : { x: 0, y: 0 };
      world.set(id, { x: local.x + parentOrigin.x, y: local.y + parentOrigin.y });
    }

    if (deferred.length === pending.length) {
      for (const id of deferred) world.set(id, draggedPositions.get(id)!);
      break;
    }

    pending = deferred;
  }

  return world;
}

/**
 * 对一批拖拽中的落点执行智能对齐
 * @param nodes 当前全量节点
 * @param draggedPositions 本次变更给出的落点 (节点自身坐标系)
 * @param threshold 世界坐标感应半径
 */
export function computeDragAlignment(
  nodes: FlowNode[],
  draggedPositions: Map<string, XYPosition>,
  threshold: number
): DragAlignmentOutcome {
  if (draggedPositions.size === 0) {
    return { positions: draggedPositions, guides: [] };
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const draggedIds = new Set(draggedPositions.keys());
  const worldPositions = resolveDraggedWorldPositions(nodes, byId, draggedPositions);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const [id, world] of worldPositions) {
    const node = byId.get(id);
    if (!node) continue;
    const { width, height } = getNodeDimensions(node);
    minX = Math.min(minX, world.x);
    minY = Math.min(minY, world.y);
    maxX = Math.max(maxX, world.x + width);
    maxY = Math.max(maxY, world.y + height);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { positions: draggedPositions, guides: [] };
  }

  const draggedBox: AlignBox = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  const originOf = makeWorldOriginResolver(byId);

  const targets: AlignBox[] = [];
  for (const node of nodes) {
    if (draggedIds.has(node.id)) continue;
    if (CONTAINER_NODE_TYPES.has(node.type)) continue;
    if (isDescendantOfDragged(node, draggedIds, byId)) continue;

    const origin = originOf(node);
    const { width, height } = getNodeDimensions(node);
    targets.push({ x: origin.x, y: origin.y, width, height });
  }

  const { offset, guides } = computeAlignmentSnap(draggedBox, targets, threshold);

  if (offset.x === 0 && offset.y === 0) {
    return { positions: draggedPositions, guides };
  }

  const positions = new Map<string, XYPosition>();
  for (const [id, local] of draggedPositions) {
    positions.set(id, { x: local.x + offset.x, y: local.y + offset.y });
  }

  return { positions, guides };
}

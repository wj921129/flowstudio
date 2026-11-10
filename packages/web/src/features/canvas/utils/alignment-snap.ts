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

/** 参考线感应半径 (屏幕像素)，按缩放反算为世界坐标阈值。极窄像素吸附：基准 5px */
export const ALIGN_SENSITIVITY_PX = 5;

/** 世界坐标感应半径下限：避免高缩放比例下过大距离吸附 */
export const MIN_THRESHOLD = 4;

/** 世界坐标感应半径上限：避免极低缩放比例下吸附跨过大半个画布 */
export const MAX_THRESHOLD = 10;

/** 最大对齐距离 (px)：超过此物理间距的图元不产生吸附，避免画布远端杂散干扰 */
export const MAX_ALIGN_DISTANCE = 1500;

/**
 * 容器类图元不作为吸附目标：其边线横跨整条泳道，会盖过邻近图元的对齐线索
 */
const CONTAINER_NODE_TYPES: ReadonlySet<FlowNodeType> = new Set<FlowNodeType>([
  'pool',
  'lane',
  'group',
]);

/**
 * 将屏幕像素感应半径换算为当前缩放下的世界坐标阈值（极窄吸附控制在 4~5px 黄金区间）
 */
export function resolveSnapThreshold(zoom: number): number {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, ALIGN_SENSITIVITY_PX / safeZoom));
}

/**
 * 竖直线候选：左边线/左四角/左Handle、右边线/右四角/右Handle、水平中心/上下Handle
 */
function verticalAnchors(box: AlignBox): number[] {
  return [box.x, box.x + box.width, box.x + box.width / 2];
}

/**
 * 水平线候选：上边线/上四角/上Handle、下边线/下四角/下Handle、垂直中心/左右Handle
 */
function horizontalAnchors(box: AlignBox): number[] {
  return [box.y, box.y + box.height, box.y + box.height / 2];
}

/**
 * 计算两个包围盒之间的物理间隔距离 (px)
 */
function getBoxDistance(a: AlignBox, b: AlignBox): number {
  const dx = Math.max(0, Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width)));
  const dy = Math.max(0, Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height)));
  return Math.hypot(dx, dy);
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
      if (absDelta > limit) continue;
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
 * @param threshold 世界坐标感应半径（极窄像素 4~5px）
 */
export function computeAlignmentSnap(
  dragged: AlignBox,
  targets: AlignBox[],
  threshold: number
): AlignmentSnapResult {
  const guides: AlignGuide[] = [];
  let offsetX = 0;
  let offsetY = 0;

  // 按物理空间距离升序排序，确保视觉临近图元优先吸附，杜绝远端孤立图元抢夺对齐线
  const sortedTargets = [...targets].sort(
    (a, b) => getBoxDistance(dragged, a) - getBoxDistance(dragged, b)
  );

  let bestX: { delta: number; position: number; start: number; end: number } | null = null;
  for (const target of sortedTargets) {
    // 纵向间隔距离过大（> 1500px）时跳过，避免全画布无节制杂散吸附
    const dy = Math.max(0, Math.max(target.y - (dragged.y + dragged.height), dragged.y - (target.y + target.height)));
    if (dy > MAX_ALIGN_DISTANCE) continue;

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
    let start = bestX.start;
    let end = bestX.end;
    // 若有其他图元也落在同一竖直参考线上，将参考线延伸贯穿所有对齐图元
    for (const target of targets) {
      const anchors = verticalAnchors(target);
      if (anchors.some((a) => Math.abs(a - bestX!.position) < 0.1)) {
        start = Math.min(start, target.y);
        end = Math.max(end, target.y + target.height);
      }
    }
    guides.push({ axis: 'vertical', position: bestX.position, start, end });
  }

  const shifted: AlignBox = { ...dragged, x: dragged.x + offsetX };

  let bestY: { delta: number; position: number; start: number; end: number } | null = null;
  for (const target of sortedTargets) {
    // 横向间隔距离过大（> 1500px）时跳过
    const dx = Math.max(0, Math.max(target.x - (shifted.x + shifted.width), shifted.x - (target.x + target.width)));
    if (dx > MAX_ALIGN_DISTANCE) continue;

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
    let start = bestY.start;
    let end = bestY.end;
    // 若有其他图元也落在同一水平参考线上，将参考线延伸贯穿所有对齐图元
    for (const target of targets) {
      const anchors = horizontalAnchors(target);
      if (anchors.some((a) => Math.abs(a - bestY!.position) < 0.1)) {
        start = Math.min(start, target.x);
        end = Math.max(end, target.x + target.width);
      }
    }
    guides.push({ axis: 'horizontal', position: bestY.position, start, end });
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

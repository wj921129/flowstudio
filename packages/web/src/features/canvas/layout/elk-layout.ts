/**
 * @fileoverview FlowStudio 自动排版引擎 (基于 elkjs)
 * @description 支持普通流程图分层排版 (layered) 与泳道感知分区排版 (partitioning)
 */

import ELK from 'elkjs/lib/elk.bundled.js';
import type { FlowNode, FlowEdge, XYPosition } from '@flowstudio/shared';

export interface LayoutOptions {
  /** 排版主方向：RIGHT (横向从左往右) | DOWN (纵向从上往下) */
  direction?: 'RIGHT' | 'DOWN';
  /** 节点同层间距 */
  nodeSpacing?: number;
  /** 节点跨层间距 */
  layerSpacing?: number;
  /** 泳道或池内边距 */
  padding?: number;
}

const defaultOptions: Required<LayoutOptions> = {
  direction: 'RIGHT',
  nodeSpacing: 60,
  layerSpacing: 80,
  padding: 40,
};

const elkInstance = new ELK();

/**
 * 执行整图或局部自动排版
 */
export async function layoutDiagram(
  nodes: FlowNode[],
  edges: FlowEdge[],
  options?: LayoutOptions
): Promise<{ nodes: FlowNode[]; edges: FlowEdge[] }> {
  if (!nodes || nodes.length === 0) {
    return { nodes: [], edges: edges ?? [] };
  }

  const opts = { ...defaultOptions, ...options };
  const hasPoolOrLane = nodes.some((n) => n.type === 'pool' || n.type === 'lane');

  if (hasPoolOrLane) {
    return layoutSwimlaneDiagram(nodes, edges, opts);
  }

  return layoutStandardFlowchart(nodes, edges, opts);
}

/**
 * 标准流程图分层排版 (Layered)
 */
async function layoutStandardFlowchart(
  nodes: FlowNode[],
  edges: FlowEdge[],
  opts: Required<LayoutOptions>
): Promise<{ nodes: FlowNode[]; edges: FlowEdge[] }> {
  try {
    const elkChildren = nodes.map((node) => {
      const w = node.width ?? (node.style?.width as number) ?? 160;
      const h = node.height ?? (node.style?.height as number) ?? 80;
      return {
        id: node.id,
        width: typeof w === 'number' ? w : 160,
        height: typeof h === 'number' ? h : 80,
      };
    });

    const elkEdges = edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    }));

    const elkGraph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': opts.direction,
        'elk.spacing.nodeNode': String(opts.nodeSpacing),
        'elk.layered.spacing.nodeNodeBetweenLayers': String(opts.layerSpacing),
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      },
      children: elkChildren,
      edges: elkEdges,
    };

    const result = await elkInstance.layout(elkGraph);

    const positionMap = new Map<string, { x: number; y: number }>();
    if (result.children) {
      for (const c of result.children) {
        positionMap.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });
      }
    }

    const waypointsMap = new Map<string, XYPosition[]>();
    if (result.edges) {
      for (const e of result.edges) {
        const sections = (e as any).sections;
        if (sections && Array.isArray(sections) && sections.length > 0) {
          const bendPoints: XYPosition[] = [];
          for (const s of sections) {
            if (s.bendPoints && Array.isArray(s.bendPoints)) {
              for (const bp of s.bendPoints) {
                bendPoints.push({ x: bp.x, y: bp.y });
              }
            }
          }
          if (bendPoints.length > 0) {
            waypointsMap.set(e.id, bendPoints);
          }
        }
      }
    }

    const nextNodes = nodes.map((node) => {
      // 锚定锁防护：position 坐标锁定或 full 完全锁定节点固定原坐标不动
      if (node.data?.lockMode === 'position' || node.data?.lockMode === 'full') {
        return node;
      }
      const pos = positionMap.get(node.id);
      if (!pos) return node;
      return {
        ...node,
        position: { x: pos.x, y: pos.y },
      };
    });

    const nextEdges = edges.map((edge) => {
      const wp = waypointsMap.get(edge.id);
      if (!wp || wp.length === 0) return edge;
      return {
        ...edge,
        data: {
          ...(edge.data || {}),
          waypoints: wp,
        },
      };
    });

    return { nodes: nextNodes, edges: nextEdges };
  } catch (error) {
    console.error('[elk-layout] Standard layout failed, returning original graph:', error);
    return { nodes, edges };
  }
}

/**
 * 泳道图排版：泳道感知分区 (Partitioning) 与层次化排版
 */
async function layoutSwimlaneDiagram(
  nodes: FlowNode[],
  edges: FlowEdge[],
  opts: Required<LayoutOptions>
): Promise<{ nodes: FlowNode[]; edges: FlowEdge[] }> {
  try {
    const pools = nodes.filter((n) => n.type === 'pool');
    const lanes = nodes.filter((n) => n.type === 'lane');

    if (pools.length === 0 || lanes.length === 0) {
      return layoutStandardFlowchart(nodes, edges, opts);
    }

    const primaryPool = pools[0];
    const isHorizontal = (primaryPool.data?.orientation ?? 'horizontal') === 'horizontal';
    const headerSize = primaryPool.data?.headerSize ?? 40;

    // 建立泳道索引与子节点映射
    const laneMap = new Map<string, FlowNode>();
    const laneIndexMap = new Map<string, number>();
    lanes.forEach((lane, idx) => {
      laneMap.set(lane.id, lane);
      laneIndexMap.set(lane.id, idx);
    });

    // 收集属于泳道的业务子节点
    const laneChildren = nodes.filter((n) => n.parentId && laneMap.has(n.parentId));

    // 先对所有业务节点统一运行一次分层排版，获得全局依赖拓扑（保证跨泳道依赖先后顺序 X 坐标正向对齐）
    const globalLayout = await layoutStandardFlowchart(laneChildren, edges, {
      ...opts,
      direction: isHorizontal ? 'RIGHT' : 'DOWN',
    });

    const globalPosMap = new Map<string, { x: number; y: number }>();
    globalLayout.nodes.forEach((n) => {
      globalPosMap.set(n.id, n.position);
    });

    // 计算各泳道高度与子节点内部局部坐标
    const padding = 40;
    const laneBounds = new Map<string, { minX: number; maxX: number; minY: number; maxY: number; count: number }>();
    lanes.forEach((lane) => {
      laneBounds.set(lane.id, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, count: 0 });
    });

    for (const child of laneChildren) {
      const pos = globalPosMap.get(child.id) ?? child.position;
      const w = child.width ?? (child.style?.width as number) ?? 160;
      const h = child.height ?? (child.style?.height as number) ?? 80;
      const b = laneBounds.get(child.parentId!);
      if (b) {
        b.minX = Math.min(b.minX, pos.x);
        b.maxX = Math.max(b.maxX, pos.x + w);
        b.minY = Math.min(b.minY, pos.y);
        b.maxY = Math.max(b.maxY, pos.y + h);
        b.count += 1;
      }
    }

    // 计算全局横向最小 X，作为统一的左对齐偏移
    let globalMinX = Infinity;
    let globalMaxX = -Infinity;
    let globalMinY = Infinity;
    let globalMaxY = -Infinity;

    laneBounds.forEach((b) => {
      if (b.count > 0) {
        globalMinX = Math.min(globalMinX, b.minX);
        globalMaxX = Math.max(globalMaxX, b.maxX);
        globalMinY = Math.min(globalMinY, b.minY);
        globalMaxY = Math.max(globalMaxY, b.maxY);
      }
    });

    if (globalMinX === Infinity) globalMinX = 0;
    if (globalMaxX === -Infinity) globalMaxX = 700;
    if (globalMinY === Infinity) globalMinY = 0;
    if (globalMaxY === -Infinity) globalMaxY = 400;

    let currentOffset = headerSize;
    const laneLayoutInfos = new Map<string, { x: number; y: number; width: number; height: number; innerMinY: number; innerMinX: number }>();

    for (const lane of lanes) {
      const b = laneBounds.get(lane.id)!;
      let laneW = isHorizontal ? Math.max(750, globalMaxX - globalMinX + padding * 2) : 220;
      let laneH = isHorizontal ? 200 : Math.max(600, globalMaxY - globalMinY + padding * 2);

      if (b.count > 0) {
        if (isHorizontal) {
          const contentH = b.maxY - b.minY + padding * 2;
          laneH = Math.max(laneH, contentH);
        } else {
          const contentW = b.maxX - b.minX + padding * 2;
          laneW = Math.max(laneW, contentW);
        }
      }

      const laneX = isHorizontal ? 0 : currentOffset;
      const laneY = isHorizontal ? currentOffset : 0;

      laneLayoutInfos.set(lane.id, {
        x: laneX,
        y: laneY,
        width: laneW,
        height: laneH,
        innerMinY: b.count > 0 ? b.minY : 0,
        innerMinX: b.count > 0 ? b.minX : 0,
      });

      currentOffset += isHorizontal ? laneH : laneW;
    }

    const totalPoolWidth = isHorizontal
      ? Math.max(800, globalMaxX - globalMinX + padding * 2)
      : currentOffset;
    const totalPoolHeight = isHorizontal
      ? currentOffset
      : Math.max(600, globalMaxY - globalMinY + padding * 2);

    // 重新组装所有节点
    const nextNodes = nodes.map((node) => {
      // 1. Pool
      if (node.id === primaryPool.id) {
        return {
          ...node,
          width: totalPoolWidth,
          height: totalPoolHeight,
          style: {
            ...(node.style || {}),
            width: totalPoolWidth,
            height: totalPoolHeight,
          },
        };
      }

      // 2. Lane
      const laneInfo = laneLayoutInfos.get(node.id);
      if (laneInfo) {
        const laneW = isHorizontal ? totalPoolWidth : laneInfo.width;
        const laneH = isHorizontal ? laneInfo.height : totalPoolHeight;
        return {
          ...node,
          position: { x: laneInfo.x, y: laneInfo.y },
          width: laneW,
          height: laneH,
          style: {
            ...(node.style || {}),
            width: laneW,
            height: laneH,
          },
        };
      }

      // 3. 泳道内的子节点 (转换回对应泳道容器内的局部相对坐标)
      if (node.parentId && laneLayoutInfos.has(node.parentId)) {
        // 锚定锁防护：锁定的子节点固定原有局部坐标
        if (node.data?.lockMode === 'position' || node.data?.lockMode === 'full') {
          return node;
        }
        const laneInfo = laneLayoutInfos.get(node.parentId)!;
        const globalPos = globalPosMap.get(node.id) ?? node.position;

        const localX = isHorizontal
          ? globalPos.x - globalMinX + padding
          : globalPos.x - laneInfo.innerMinX + padding;
        const localY = isHorizontal
          ? globalPos.y - laneInfo.innerMinY + padding
          : globalPos.y - globalMinY + padding;

        return {
          ...node,
          position: { x: Math.max(padding, localX), y: Math.max(padding, localY) },
        };
      }

      // 4. 其他浮动节点保持原样
      return node;
    });

    return { nodes: nextNodes, edges };
  } catch (error) {
    console.error('[elk-layout] Swimlane layout failed, returning original graph:', error);
    return { nodes, edges };
  }
}

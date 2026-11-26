import type * as Y from 'yjs';
import {
  analyzeGraphTopology,
  type BorderSide,
  type FlowEdge,
  type FlowNode,
  inferBestSides,
  parseBorderAnchorHandle,
  resolveNodeWorldBoxes,
} from '@flowstudio/shared';
import { getMapDimensions } from './swimlane-geometry.js';

export function inspectDiagramSemantics(
  nodesMap: Y.Map<Y.Map<unknown>>,
  edgesMap: Y.Map<Y.Map<unknown>>,
  metaMap?: Y.Map<unknown>,
): string[] {
  const warnings: string[] = [];
  const containerOrNoteTypes = new Set(['pool', 'lane', 'comment', 'group']);
  const businessNodes: Array<{ id: string; type: string; label: string; parentId?: string }> = [];
  const labelById = new Map<string, string>();
  const flowNodes: FlowNode[] = [];
  const flowEdges: FlowEdge[] = [];
  let hasLane = false;
  let poolOrientation: string | undefined;

  nodesMap.forEach((nodeMap, id) => {
    const type = (nodeMap.get('type') as string) || 'process';
    if (type === 'lane') hasLane = true;
    const data = (nodeMap.get('data') as Record<string, unknown>) || {};
    if (type === 'pool' && typeof data.orientation === 'string') {
      poolOrientation = data.orientation;
    }
    const label = ((data.label as string) || id).trim();
    const parentId = nodeMap.get('parentId') as string | undefined;
    labelById.set(id, label);
    flowNodes.push({
      id,
      type: type as FlowNode['type'],
      position: (nodeMap.get('position') as FlowNode['position']) || { x: 0, y: 0 },
      parentId,
      width: nodeMap.get('width') as number | undefined,
      height: nodeMap.get('height') as number | undefined,
      data: data as FlowNode['data'],
    });
    if (containerOrNoteTypes.has(type)) return;
    businessNodes.push({ id, type, label, parentId });
  });

  if (businessNodes.length === 0) return warnings;

  const connectedIds = new Set<string>();
  const outEdgesBySource = new Map<string, Array<{ label: string }>>();
  edgesMap.forEach((edgeMap, id) => {
    const source = edgeMap.get('source') as string;
    const target = edgeMap.get('target') as string;
    const sourceHandle = edgeMap.get('sourceHandle') as string | undefined;
    const targetHandle = edgeMap.get('targetHandle') as string | undefined;
    const data = (edgeMap.get('data') as Record<string, unknown>) || {};
    const label = typeof data.label === 'string' ? data.label.trim() : '';
    if (source && target) {
      flowEdges.push({ id, source, target, sourceHandle, targetHandle, data: data as FlowEdge['data'] });
    }
    if (source) {
      connectedIds.add(source);
      const list = outEdgesBySource.get(source) ?? [];
      list.push({ label });
      outEdgesBySource.set(source, list);
    }
    if (target) connectedIds.add(target);
  });

  if (businessNodes.length >= 2) {
    const isolated = businessNodes.filter((n) => !connectedIds.has(n.id)).map((n) => `${n.label}(${n.id})`);
    if (isolated.length > 0) {
      warnings.push(`检测到孤立节点: ${isolated.slice(0, 5).join('、')}${isolated.length > 5 ? ` 等 ${isolated.length} 个` : ''}，建议通过 connect 接入主链路`);
    }
  }

  for (const n of businessNodes) {
    if (n.type !== 'decision') continue;
    const outEdges = outEdgesBySource.get(n.id) ?? [];
    if (outEdges.length >= 2) {
      const missingCount = outEdges.filter((e) => !e.label).length;
      if (missingCount > 0) {
        warnings.push(`判断节点 ${n.label}(${n.id}) 有 ${missingCount} 条分支连线缺少条件标签，建议补充是/否等分支说明`);
      }
    }
  }

  if (hasLane) {
    const unlaned = businessNodes.filter((n) => !n.parentId).map((n) => `${n.label}(${n.id})`);
    if (unlaned.length > 0) {
      warnings.push(`泳道图中存在未归属泳道的游离节点: ${unlaned.slice(0, 5).join('、')}${unlaned.length > 5 ? ` 等 ${unlaned.length} 个` : ''}，建议通过 move_to_lane 归属泳道`);
    }
  }

  const boxes = resolveNodeWorldBoxes(flowNodes);
  const portBuckets = new Map<string, number[]>();
  const addPort = (nodeId: string, side: BorderSide, offset: number) => {
    const key = `${nodeId}::${side}`;
    const bucket = portBuckets.get(key);
    if (bucket) bucket.push(offset);
    else portBuckets.set(key, [offset]);
  };
  for (const edge of flowEdges) {
    const sBox = boxes.get(edge.source);
    const tBox = boxes.get(edge.target);
    const fallback = sBox && tBox ? inferBestSides(sBox, tBox) : { sourceSide: 'right' as BorderSide, targetSide: 'left' as BorderSide };
    const ps = parseBorderAnchorHandle(edge.sourceHandle);
    const pt = parseBorderAnchorHandle(edge.targetHandle);
    addPort(edge.source, ps?.side ?? fallback.sourceSide, ps?.offset ?? 0.5);
    addPort(edge.target, pt?.side ?? fallback.targetSide, pt?.offset ?? 0.5);
  }
  const overlappedPorts: string[] = [];
  for (const [key, offsets] of portBuckets.entries()) {
    if (offsets.length < 2) continue;
    const sorted = [...offsets].sort((a, b) => a - b);
    let hasOverlap = false;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] < 0.03) {
        hasOverlap = true;
        break;
      }
    }
    if (hasOverlap) {
      const sep = key.indexOf('::');
      const nodeId = key.slice(0, sep);
      const side = key.slice(sep + 2);
      overlappedPorts.push(`${labelById.get(nodeId) ?? nodeId}(${nodeId}) 的 ${side} 侧`);
    }
  }
  if (overlappedPorts.length > 0) {
    warnings.push(
      `检测到同点连线重叠: ${overlappedPorts.slice(0, 5).join('、')}${overlappedPorts.length > 5 ? ` 等 ${overlappedPorts.length} 处` : ''}，建议通过 update_edge 错开锚点或执行 auto_layout`,
    );
  }

  const overlapPairs: string[] = [];
  const bizBoxes = businessNodes
    .map((n) => ({ ...n, box: boxes.get(n.id)! }))
    .filter((item) => Boolean(item.box));
  for (let i = 0; i < bizBoxes.length; i++) {
    for (let j = i + 1; j < bizBoxes.length; j++) {
      const a = bizBoxes[i].box;
      const b = bizBoxes[j].box;
      const ix = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (ix > 0 && iy > 0 && ix * iy > 4) {
        overlapPairs.push(`${bizBoxes[i].label}(${bizBoxes[i].id}) 与 ${bizBoxes[j].label}(${bizBoxes[j].id})`);
      }
    }
  }
  if (overlapPairs.length > 0) {
    warnings.push(`检测到业务节点物理重叠: ${overlapPairs.slice(0, 3).join('、')}${overlapPairs.length > 3 ? ` 等 ${overlapPairs.length} 处` : ''}，建议执行 auto_layout 重新排布`);
  }

  const laneOutOfBounds: string[] = [];
  nodesMap.forEach((nodeMap, id) => {
    const type = nodeMap.get('type') as string;
    if (type === 'pool' || type === 'lane') return;
    const parentId = nodeMap.get('parentId') as string | undefined;
    if (!parentId) return;
    const parentMap = nodesMap.get(parentId);
    if (!parentMap || parentMap.get('type') !== 'lane') return;
    const pos = (nodeMap.get('position') as { x: number; y: number } | undefined) ?? { x: 0, y: 0 };
    const childDim = getMapDimensions(nodeMap);
    const laneDim = getMapDimensions(parentMap);
    if (pos.x < -2 || pos.y < -2 || pos.x + childDim.width > laneDim.width + 2 || pos.y + childDim.height > laneDim.height + 2) {
      laneOutOfBounds.push(`${labelById.get(id) ?? id}(${id})`);
    }
  });
  if (laneOutOfBounds.length > 0) {
    warnings.push(`检测到泳道子节点越界: ${laneOutOfBounds.slice(0, 5).join('、')} 超出所属泳道范围，建议执行 auto_layout 扩容对齐`);
  }

  const metaOri = metaMap?.get('orientation') as string | undefined;
  const paradigm = metaMap?.get('paradigm') as string | undefined;
  const isHorizontal =
    hasLane
      ? (poolOrientation ?? metaOri ?? 'horizontal') !== 'vertical'
      : metaOri === 'horizontal';
  const bizSet = new Set(businessNodes.map((n) => n.id));
  const reverseEdges: string[] = [];
  for (const edge of flowEdges) {
    const kind = edge.data?.kind;
    if (kind === 'loop' || kind === 'annotate') continue;
    if (!bizSet.has(edge.source) || !bizSet.has(edge.target)) continue;
    const sBox = boxes.get(edge.source);
    const tBox = boxes.get(edge.target);
    if (!sBox || !tBox) continue;
    const sc = isHorizontal ? sBox.x + sBox.width / 2 : sBox.y + sBox.height / 2;
    const tc = isHorizontal ? tBox.x + tBox.width / 2 : tBox.y + tBox.height / 2;
    if (tc < sc - 40) {
      reverseEdges.push(`${labelById.get(edge.source) ?? edge.source}->${labelById.get(edge.target) ?? edge.target}`);
    }
  }
  if (reverseEdges.length > 0) {
    warnings.push(`检测到正向连线逆流倒退(${isHorizontal ? '右→左' : '下→上'}): ${reverseEdges.slice(0, 3).join('、')}，若为回退请标 kind="loop" 或执行 auto_layout`);
  }

  const negNodes: string[] = [];
  flowNodes.forEach((n) => {
    if (n.type === 'pool' || n.type === 'lane') return;
    const wb = boxes.get(n.id);
    if (wb && (wb.x < 0 || wb.y < 0)) negNodes.push(`${labelById.get(n.id) ?? n.id}(${n.id})`);
  });
  if (negNodes.length > 0) {
    warnings.push(`检测到节点飞入负坐标区: ${negNodes.slice(0, 4).join('、')}，建议执行 auto_layout 归一化至画布正区间`);
  }

  const topo = analyzeGraphTopology(
    businessNodes.map((n) => ({ id: n.id, type: n.type, label: n.label })),
    flowEdges.map((e) => ({ from: e.source, to: e.target, kind: typeof e.data?.kind === 'string' ? e.data.kind : undefined })),
  );
  const nonTrivialComps = topo.components.filter((c) => c.nodeIds.length >= 2);
  if (nonTrivialComps.length >= 2) {
    warnings.push(`检测到 ${nonTrivialComps.length} 组互不连通的业务链路（存在断链），请确认是否缺少主线连接`);
  }

  return warnings;
}

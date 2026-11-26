import { ANNOT_GAP, BRANCH_GAP, LOOP_SIDE, MAIN_GAP, REG_LANE_STEP } from './constants.js';
import { analyzeGraphTopology } from './topology.js';
import type { RenderFixed } from './types.js';
import type { XYPosition } from '../types.js';

export interface CircuitLayoutInputNode {
  id: string;
  width: number;
  height: number;
  type?: string;
  label?: string;
  role?: string;
  attachTo?: string;
  earlyExit?: boolean;
  fixed?: RenderFixed;
}

export interface CircuitLayoutInputEdge {
  from: string;
  to: string;
  kind?: string;
  label?: string;
}

export interface CircuitLayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CircuitEdgePlan {
  sourceHandle: 'top' | 'right' | 'bottom' | 'left';
  targetHandle: 'top' | 'right' | 'bottom' | 'left';
  routingType: 'orthogonal' | 'straight';
  waypoints?: XYPosition[];
}

export interface CircuitLayoutResult {
  positions: Map<string, CircuitLayoutBox>;
  edgePlans: Map<string, CircuitEdgePlan>;
  backEdgeKeys: Set<string>;
  warnings: string[];
}

interface LayoutBox {
  width: number;
  height: number;
  axisOffset: number;
  placements: Map<string, CircuitLayoutBox>;
}

const NORMAL_EXIT_RE = /成功|完成|归档|结束|通过|放行|提交|ok|success|done|complete|finish|pass/i;
const EARLY_EXIT_RE = /失败|异常|驳回|报错|拒绝|拦截|超时|非法|跳过|缺口|终止|熔断|降级|限额|退出|不通过|未授权|不足|throw|error|fail|reject|abort|denied|invalid/i;
const V_EXIT = '__V_EXIT__';

function flipSide(side: 'top' | 'right' | 'bottom' | 'left'): 'top' | 'right' | 'bottom' | 'left' {
  if (side === 'top') return 'left';
  if (side === 'bottom') return 'right';
  if (side === 'left') return 'top';
  return 'bottom';
}

function boxesOverlap(a: CircuitLayoutBox, b: CircuitLayoutBox, gap = 0): boolean {
  return a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;
}

function translateBox(box: LayoutBox, dx: number, dy: number): Map<string, CircuitLayoutBox> {
  const out = new Map<string, CircuitLayoutBox>();
  for (const [id, p] of box.placements) {
    out.set(id, { x: p.x + dx, y: p.y + dy, width: p.width, height: p.height });
  }
  return out;
}

function mergeBoxPlacements(target: Map<string, CircuitLayoutBox>, box: LayoutBox, dx: number, dy: number): void {
  for (const [id, p] of box.placements) {
    target.set(id, { x: p.x + dx, y: p.y + dy, width: p.width, height: p.height });
  }
}

function normalizeBox(placements: Map<string, CircuitLayoutBox>, rawAxis: number): LayoutBox {
  if (placements.size === 0) return { width: 0, height: 0, axisOffset: 0, placements };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of placements.values()) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x + p.width);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y + p.height);
  }
  const shifted = new Map<string, CircuitLayoutBox>();
  for (const [id, p] of placements) {
    shifted.set(id, { x: p.x - minX, y: p.y - minY, width: p.width, height: p.height });
  }
  return {
    width: maxX - minX,
    height: maxY - minY,
    axisOffset: rawAxis - minX,
    placements: shifted,
  };
}

function canReachWithout(
  adj: Map<string, Array<{ to: string; kind: string }>>,
  from: string,
  target: string,
  skipKind: string,
): boolean {
  const seen = new Set<string>([from]);
  const stack: string[] = [];
  for (const e of adj.get(from) ?? []) {
    if (e.to === target && e.kind === skipKind) continue;
    if (e.to === target) return true;
    seen.add(e.to);
    stack.push(e.to);
  }
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const e of adj.get(cur) ?? []) {
      if (e.to === target) return true;
      if (!seen.has(e.to)) {
        seen.add(e.to);
        stack.push(e.to);
      }
    }
  }
  return false;
}

function computeIpdom(
  subset: ReadonlySet<string>,
  adj: ReadonlyMap<string, string[]>,
  exitNodes: readonly string[],
): Map<string, string> {
  const preds = new Map<string, string[]>();
  for (const id of subset) preds.set(id, [...(adj.get(id) ?? [])].filter((t) => subset.has(t)));
  preds.set(V_EXIT, []);
  for (const t of exitNodes) {
    if (subset.has(t)) preds.get(t)!.push(V_EXIT);
  }
  const revAdj = new Map<string, string[]>();
  for (const id of [V_EXIT, ...subset]) revAdj.set(id, []);
  for (const [u, succs] of preds) {
    for (const v of succs) revAdj.get(v)?.push(u);
  }

  const postorder: string[] = [];
  const visited = new Set<string>();
  const dfs = (u: string) => {
    visited.add(u);
    for (const v of revAdj.get(u) ?? []) {
      if (!visited.has(v)) dfs(v);
    }
    postorder.push(u);
  };
  dfs(V_EXIT);

  const poNum = new Map<string, number>();
  postorder.forEach((id, idx) => poNum.set(id, idx));
  const idom = new Map<string, string>();
  idom.set(V_EXIT, V_EXIT);

  const intersect = (b1: string, b2: string): string => {
    let f1 = b1;
    let f2 = b2;
    while (f1 !== f2) {
      while ((poNum.get(f1) ?? -1) < (poNum.get(f2) ?? -1)) {
        const next = idom.get(f1);
        if (!next || next === f1) return V_EXIT;
        f1 = next;
      }
      while ((poNum.get(f2) ?? -1) < (poNum.get(f1) ?? -1)) {
        const next = idom.get(f2);
        if (!next || next === f2) return V_EXIT;
        f2 = next;
      }
    }
    return f1;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = postorder.length - 2; i >= 0; i--) {
      const b = postorder[i];
      const succs = (preds.get(b) ?? []).filter((p) => idom.has(p));
      if (succs.length === 0) continue;
      let newIdom = succs[0];
      for (let j = 1; j < succs.length; j++) {
        newIdom = intersect(succs[j], newIdom);
      }
      if (idom.get(b) !== newIdom) {
        idom.set(b, newIdom);
        changed = true;
      }
    }
  }
  return idom;
}

export function layoutCircuitFlowGraph(
  nodes: readonly CircuitLayoutInputNode[],
  edges: readonly CircuitLayoutInputEdge[],
  opts?: {
    direction?: 'DOWN' | 'RIGHT';
    edgeRouting?: 'orthogonal' | 'straight';
    origin?: XYPosition;
    mainGap?: number;
    sideGap?: number;
    annotGap?: number;
  },
): CircuitLayoutResult {
  const isRight = opts?.direction === 'RIGHT';
  const routingMode = opts?.edgeRouting ?? 'orthogonal';
  const rawOrigin = opts?.origin ?? { x: 50, y: 50 };
  const origin = isRight ? { x: rawOrigin.y, y: rawOrigin.x } : rawOrigin;
  const mainGap = opts?.mainGap ?? MAIN_GAP;
  const sideGap = opts?.sideGap ?? Math.max(56, BRANCH_GAP - 20);
  const annotGap = opts?.annotGap ?? BRANCH_GAP;

  const logicalNodes: CircuitLayoutInputNode[] = nodes.map((n) => ({
    ...n,
    width: isRight ? n.height : n.width,
    height: isRight ? n.width : n.height,
    fixed: n.fixed
      ? {
          position: isRight ? { x: n.fixed.position.y, y: n.fixed.position.x } : { ...n.fixed.position },
          width: isRight ? n.fixed.height : n.fixed.width,
          height: isRight ? n.fixed.width : n.fixed.height,
        }
      : undefined,
  }));

  const topo = analyzeGraphTopology(logicalNodes, edges);
  const warnings: string[] = [];
  if (topo.backEdgeKeys.size > 0) {
    warnings.push(`circuit-flow 检测到 ${topo.backEdgeKeys.size} 条未标 loop 的暗环，已破环并保留回归边`);
  }

  const nodeById = new Map(logicalNodes.map((n) => [n.id, n]));
  const bypassEdgeKeys = new Set<string>();
  for (const e of topo.rawForwardEdges) {
    const key = `${e.from}|${e.to}|${e.kind}`;
    if (topo.backEdgeKeys.has(key)) continue;
    if (e.kind === 'jump' && canReachWithout(topo.adj, e.from, e.to, 'jump')) {
      bypassEdgeKeys.add(key);
    }
  }

  const cfAdj = new Map<string, string[]>();
  const cfParents = new Map<string, string[]>();
  const cfEdgeKind = new Map<string, string>();
  for (const n of topo.bizNodes) {
    cfAdj.set(n.id, []);
    cfParents.set(n.id, []);
  }
  const seenCf = new Set<string>();
  for (const e of topo.rawForwardEdges) {
    const key = `${e.from}|${e.to}|${e.kind}`;
    if (topo.backEdgeKeys.has(key) || bypassEdgeKeys.has(key)) continue;
    const pair = `${e.from}->${e.to}`;
    if (seenCf.has(pair)) continue;
    seenCf.add(pair);
    cfAdj.get(e.from)!.push(e.to);
    cfParents.get(e.to)!.push(e.from);
    cfEdgeKind.set(pair, e.kind);
  }

  const backSourceIds = new Set<string>();
  for (const e of topo.explicitLoopEdges) backSourceIds.add(e.from);
  for (const key of topo.backEdgeKeys) {
    const [from] = key.split('|');
    if (from) backSourceIds.add(from);
  }

  const compResults: Array<Map<string, CircuitLayoutBox>> = [];
  const globalPlaced = new Set<string>();

  for (const comp of topo.components) {
    const compSet = new Set(comp.nodeIds);
    const leaves = comp.nodeIds.filter((id) => (cfAdj.get(id)?.length ?? 0) === 0);
    const normalTerminals: string[] = [];
    const loopTails = new Set<string>();
    const earlyExits = new Set<string>();

    for (const id of leaves) {
      const n = nodeById.get(id)!;
      if (backSourceIds.has(id)) {
        loopTails.add(id);
      } else if (n.earlyExit === true) {
        earlyExits.add(id);
      } else {
        const label = n.label ?? '';
        const incPairs = (cfParents.get(id) ?? []).map((p) => cfEdgeKind.get(`${p}->${id}`));
        const allBranch = incPairs.length > 0 && incPairs.every((k) => k === 'branch');
        const isNormalLabel = NORMAL_EXIT_RE.test(label) && !EARLY_EXIT_RE.test(label);
        if (n.earlyExit !== false && !isNormalLabel && (EARLY_EXIT_RE.test(label) || /\breturn\b/i.test(label) || allBranch)) {
          earlyExits.add(id);
        } else {
          normalTerminals.push(id);
        }
      }
    }

    const nonBranchReachable = new Set<string>();
    const mainRoots = comp.nodeIds.filter((id) => (cfParents.get(id)?.length ?? 0) === 0);
    const nbQ = [...mainRoots];
    for (const r of nbQ) nonBranchReachable.add(r);
    for (let i = 0; i < nbQ.length; i++) {
      const cur = nbQ[i];
      for (const next of cfAdj.get(cur) ?? []) {
        if (cfEdgeKind.get(`${cur}->${next}`) === 'branch') continue;
        if (!nonBranchReachable.has(next)) {
          nonBranchReachable.add(next);
          nbQ.push(next);
        }
      }
    }
    const nonLoopLeaves = leaves.filter((id) => !loopTails.has(id));
    const trunkFallbackLeaves = nonLoopLeaves.filter((id) => nonBranchReachable.has(id) && nodeById.get(id)?.earlyExit !== true);
    const effectiveExits =
      normalTerminals.length > 0
        ? normalTerminals
        : trunkFallbackLeaves.length > 0
        ? trunkFallbackLeaves
        : nonLoopLeaves.length > 0
        ? nonLoopLeaves
        : leaves;

    const reachesExit = new Set<string>();
    const revQ = [...effectiveExits];
    for (const id of revQ) reachesExit.add(id);
    for (let i = 0; i < revQ.length; i++) {
      const cur = revQ[i];
      for (const p of cfParents.get(cur) ?? []) {
        if (compSet.has(p) && !reachesExit.has(p)) {
          reachesExit.add(p);
          revQ.push(p);
        }
      }
    }

    const mainIpdom = computeIpdom(reachesExit, cfAdj, effectiveExits);
    const sideLeaves = leaves.filter((id) => !reachesExit.has(id));
    const sideSet = new Set(comp.nodeIds.filter((id) => !reachesExit.has(id)));
    const sideIpdom = sideSet.size > 0 ? computeIpdom(sideSet, cfAdj, sideLeaves) : new Map<string, string>();

    const collectReachableBefore = (startId: string, stopId: string | null): Set<string> => {
      const visited = new Set<string>();
      if (startId === stopId || globalPlaced.has(startId)) return visited;
      const stack = [startId];
      visited.add(startId);
      while (stack.length > 0) {
        const cur = stack.pop()!;
        for (const next of cfAdj.get(cur) ?? []) {
          if (next === stopId || globalPlaced.has(next)) continue;
          if (!visited.has(next)) {
            visited.add(next);
            stack.push(next);
          }
        }
      }
      return visited;
    };

    const isReachableWithin = (from: string, target: string, stopId: string | null): boolean => {
      if (from === target) return true;
      const seen = new Set<string>([from]);
      const stack = [from];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        for (const next of cfAdj.get(cur) ?? []) {
          if (next === target) return true;
          if (next === stopId || globalPlaced.has(next) || seen.has(next)) continue;
          seen.add(next);
          stack.push(next);
        }
      }
      return false;
    };

    const buildBox = (startId: string, stopId: string | null): LayoutBox => {
      const placements = new Map<string, CircuitLayoutBox>();
      const axis = 0;
      let curY = 0;
      let sideRightBottom = -Infinity;
      let sideRightX = 0;
      let curId: string | null = startId;

      const placeSingle = (id: string, cx: number, y: number): CircuitLayoutBox => {
        const s = nodeById.get(id)!;
        const box = { x: cx - s.width / 2, y, width: s.width, height: s.height };
        placements.set(id, box);
        globalPlaced.add(id);
        return box;
      };

      let guard = 0;
      while (curId && curId !== stopId && !globalPlaced.has(curId) && guard++ < 500) {
        const curKey: string = curId;
        const uNode = nodeById.get(curKey)!;
        const uBox = placeSingle(curKey, axis, curY);
        const succs: string[] = (cfAdj.get(curKey) ?? []).filter((t) => !globalPlaced.has(t) || t === stopId);

        if (succs.length === 0) break;

        if (succs.length === 1) {
          const next = succs[0];
          if (next === stopId) break;
          const nextParents = (cfParents.get(next) ?? []).filter((p) => !globalPlaced.has(p));
          if (nextParents.length > 0) break;
          curY = uBox.y + uBox.height + mainGap;
          curId = next;
          continue;
        }

        const rawIp: string | undefined = reachesExit.has(curKey) ? mainIpdom.get(curKey) : sideIpdom.get(curKey);
        let mergeId: string | null =
          rawIp && rawIp !== V_EXIT && rawIp !== curKey && !globalPlaced.has(rawIp) ? rawIp : null;
        if (mergeId && stopId && mergeId !== stopId && !isReachableWithin(mergeId, stopId, null)) {
          mergeId = stopId;
        }
        if (!mergeId && stopId && succs.some((t) => t === stopId || isReachableWithin(t, stopId, null))) {
          mergeId = stopId;
        }

        const uReachesExit = reachesExit.has(curKey);
        const directToMerge: string[] = succs.filter((t) => t === mergeId);
        const sideTargets: string[] = succs.filter((t) => t !== mergeId && uReachesExit && !reachesExit.has(t));
        const mainTargets: string[] = succs.filter((t) => t !== mergeId && !(uReachesExit && !reachesExit.has(t)));
        const branchStartY = uBox.y + uBox.height + mainGap;

        if (mainTargets.length + directToMerge.length === 1 && sideTargets.length >= 1) {
          const continuation: string = mainTargets[0] ?? directToMerge[0];
          const sideBoxes: LayoutBox[] = sideTargets.map((st) => buildBox(st, null)).filter((b) => b.placements.size > 0);
          if (continuation === stopId && directToMerge.length === 1) {
            let sx = Math.max(uBox.x + uBox.width + sideGap, curY < sideRightBottom + mainGap ? sideRightX + sideGap : -Infinity);
            let maxSideBottom = uBox.y + uBox.height;
            for (const sb of sideBoxes) {
              mergeBoxPlacements(placements, sb, sx, branchStartY);
              sx += sb.width + sideGap;
              maxSideBottom = Math.max(maxSideBottom, branchStartY + sb.height);
            }
            sideRightBottom = Math.max(sideRightBottom, maxSideBottom);
            if (sideBoxes.length > 0) sideRightX = Math.max(sideRightX, sx - sideGap);
            break;
          }
          if (directToMerge.length === 1 || !mergeId || mergeId === stopId || (cfAdj.get(continuation)?.length ?? 0) === 0) {
            let sx = Math.max(uBox.x + uBox.width + sideGap, curY < sideRightBottom + mainGap ? sideRightX + sideGap : -Infinity);
            let maxSideBottom = uBox.y + uBox.height;
            for (const sb of sideBoxes) {
              mergeBoxPlacements(placements, sb, sx, branchStartY);
              sx += sb.width + sideGap;
              maxSideBottom = Math.max(maxSideBottom, branchStartY + sb.height);
            }
            sideRightBottom = Math.max(sideRightBottom, maxSideBottom);
            if (sideBoxes.length > 0) sideRightX = Math.max(sideRightX, sx - sideGap);
            curY = branchStartY;
            curId = continuation;
            continue;
          }
          const mb = buildBox(continuation, mergeId);
          const mbShift = mb.placements.has(continuation)
            ? axis - (mb.placements.get(continuation)!.x + mb.placements.get(continuation)!.width / 2)
            : axis - mb.axisOffset;
          const mainEndX = Math.max(uBox.x + uBox.width, mb.placements.size > 0 ? mbShift + mb.width : axis);
          mergeBoxPlacements(placements, mb, mbShift, branchStartY);
          const maxContBottom = Math.max(uBox.y + uBox.height, branchStartY + mb.height);
          let sx = Math.max(mainEndX + sideGap, curY < sideRightBottom + mainGap ? sideRightX + sideGap : -Infinity);
          let maxSideBottom = maxContBottom;
          for (const sb of sideBoxes) {
            mergeBoxPlacements(placements, sb, sx, branchStartY);
            sx += sb.width + sideGap;
            maxSideBottom = Math.max(maxSideBottom, branchStartY + sb.height);
          }
          sideRightBottom = Math.max(sideRightBottom, maxSideBottom);
          if (sideBoxes.length > 0) sideRightX = Math.max(sideRightX, sx - sideGap);
          if (!globalPlaced.has(mergeId)) {
            curY = maxContBottom + mainGap;
            curId = mergeId;
            continue;
          }
          break;
        }

        if (mainTargets.length === 1 && directToMerge.length >= 1 && sideTargets.length === 0) {
          const optBox = buildBox(mainTargets[0], mergeId);
          const optRight = optBox.placements.size > 0 ? Math.max(...[...optBox.placements.values()].map((p) => p.x + p.width)) : 0;
          const optX = Math.max(uBox.x + uBox.width + sideGap, axis + 80);
          mergeBoxPlacements(placements, optBox, optX, branchStartY);
          sideRightX = Math.max(sideRightX, optX + optRight);
          sideRightBottom = Math.max(sideRightBottom, branchStartY + optBox.height);
          if (mergeId && mergeId !== stopId && !globalPlaced.has(mergeId)) {
            curY = Math.max(uBox.y + uBox.height, branchStartY + optBox.height) + mainGap;
            curId = mergeId;
            continue;
          }
          break;
        }

        type BranchItem =
          | { kind: 'single'; target: string; box: LayoutBox }
          | { kind: 'group'; targets: string[]; box: LayoutBox };

        const reachByBranch = new Map<string, Set<string>>();
        for (const bt of mainTargets) {
          reachByBranch.set(bt, collectReachableBefore(bt, mergeId));
        }

        const sharedCount = new Map<string, string[]>();
        for (const bt of mainTargets) {
          for (const nid of reachByBranch.get(bt)!) {
            const owners = sharedCount.get(nid) ?? [];
            owners.push(bt);
            sharedCount.set(nid, owners);
          }
        }

        const partialShared = [...sharedCount.entries()]
          .filter(([, owners]) => owners.length >= 2 && owners.length < mainTargets.length)
          .sort((a, b) => (topo.layerOf.get(a[0]) ?? 0) - (topo.layerOf.get(b[0]) ?? 0));

        const items: BranchItem[] = [];
        const groupedTargets = new Set<string>();
        for (const [sharedNode, owners] of partialShared) {
          if (owners.some((o) => groupedTargets.has(o)) || globalPlaced.has(sharedNode)) continue;
          const subBoxes = owners.map((o) => buildBox(o, sharedNode));
          const subTotalW = subBoxes.reduce((s, b) => s + b.width, 0) + sideGap * Math.max(0, subBoxes.length - 1);
          const subPlacements = new Map<string, CircuitLayoutBox>();
          let bx = 0;
          let subMaxH = 0;
          for (const sb of subBoxes) {
            mergeBoxPlacements(subPlacements, sb, bx, 0);
            bx += sb.width + sideGap;
            subMaxH = Math.max(subMaxH, sb.height);
          }
          const tailBox = buildBox(sharedNode, mergeId);
          const tailY = subMaxH + mainGap;
          const tailDx = subTotalW / 2 - tailBox.axisOffset;
          mergeBoxPlacements(subPlacements, tailBox, tailDx, tailY);
          const groupBox = normalizeBox(subPlacements, subTotalW / 2);
          items.push({ kind: 'group', targets: owners, box: groupBox });
          for (const o of owners) groupedTargets.add(o);
        }

        for (const bt of mainTargets) {
          if (groupedTargets.has(bt)) continue;
          items.push({ kind: 'single', target: bt, box: buildBox(bt, mergeId) });
        }

        let orderedItems = items.filter((it) => it.box.placements.size > 0);
        if (routingMode === 'straight' && orderedItems.length >= 3) {
          const sortedByH = [...orderedItems].sort((a, b) => a.box.height - b.box.height);
          const symmetric = new Array<BranchItem>(sortedByH.length);
          let leftIdx = Math.floor((sortedByH.length - 1) / 2);
          let rightIdx = leftIdx + 1;
          for (let i = 0; i < sortedByH.length; i++) {
            if (i % 2 === 0) {
              symmetric[leftIdx--] = sortedByH[i];
            } else {
              symmetric[rightIdx++] = sortedByH[i];
            }
          }
          orderedItems = symmetric.filter(Boolean);
        }

        const totalMainW =
          orderedItems.reduce((s, it) => s + it.box.width, 0) + sideGap * Math.max(0, orderedItems.length - 1);
        let bx = axis - totalMainW / 2;
        let maxMainBottom = uBox.y + uBox.height;
        for (const it of orderedItems) {
          const itemDx = orderedItems.length === 1 ? axis - it.box.axisOffset : bx;
          mergeBoxPlacements(placements, it.box, itemDx, branchStartY);
          bx += it.box.width + sideGap;
          maxMainBottom = Math.max(maxMainBottom, branchStartY + it.box.height);
        }

        const maxMovedMainRight = axis + totalMainW / 2;
        const sideBoxes: LayoutBox[] = sideTargets.map((st) => buildBox(st, null)).filter((b) => b.placements.size > 0);
        let sx = Math.max(maxMovedMainRight + sideGap, curY < sideRightBottom + mainGap ? sideRightX + sideGap : -Infinity);
        let maxSideBottom = maxMainBottom;
        for (const sb of sideBoxes) {
          mergeBoxPlacements(placements, sb, sx, branchStartY);
          sx += sb.width + sideGap;
          maxSideBottom = Math.max(maxSideBottom, branchStartY + sb.height);
        }
        sideRightBottom = Math.max(sideRightBottom, maxSideBottom);
        if (sideBoxes.length > 0) sideRightX = Math.max(sideRightX, sx - sideGap);

        if (mergeId && mergeId !== stopId && !globalPlaced.has(mergeId)) {
          const mergeNode = nodeById.get(mergeId)!;
          const mergeLeft = axis - mergeNode.width / 2;
          const mergeRight = axis + mergeNode.width / 2;
          const sideInvadesMerge = sideBoxes.length > 0 && maxMovedMainRight + sideGap < mergeRight && mergeLeft < sx;
          curY = (sideInvadesMerge ? Math.max(maxMainBottom, maxSideBottom) : maxMainBottom) + mainGap;
          curId = mergeId;
          continue;
        }
        break;
      }

      return normalizeBox(placements, axis);
    };

    const startKey = comp.entries[0] ?? comp.nodeIds[0];
    const compPlacements = new Map<string, CircuitLayoutBox>();
    const mainBox = buildBox(startKey, null);
    mergeBoxPlacements(compPlacements, mainBox, 0, 0);

    for (const id of comp.nodeIds) {
      if (globalPlaced.has(id)) continue;
      const orphanBox = buildBox(id, null);
      if (orphanBox.placements.size === 0) continue;
      let maxCompRight = 0;
      for (const p of compPlacements.values()) maxCompRight = Math.max(maxCompRight, p.x + p.width);
      mergeBoxPlacements(compPlacements, orphanBox, maxCompRight + sideGap, 0);
    }

    compResults.push(compPlacements);
  }

  const positions = new Map<string, CircuitLayoutBox>();
  let compCursorX = origin.x;
  for (const cp of compResults) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    for (const p of cp.values()) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x + p.width);
      minY = Math.min(minY, p.y);
    }
    if (minX === Infinity) continue;
    const dx = compCursorX - minX;
    const dy = origin.y - minY;
    for (const [id, p] of cp) {
      positions.set(id, { x: p.x + dx, y: p.y + dy, width: p.width, height: p.height });
    }
    compCursorX += maxX - minX + BRANCH_GAP * 1.5;
  }

  const occupied: CircuitLayoutBox[] = [...positions.values()];
  const sortedAnnots = [...topo.annotNodes].sort((a, b) => {
    const ha = positions.get(a.attachTo!);
    const hb = positions.get(b.attachTo!);
    return (ha?.y ?? 0) - (hb?.y ?? 0) || (ha?.x ?? 0) - (hb?.x ?? 0);
  });

  for (const a of sortedAnnots) {
    const host = positions.get(a.attachTo!);
    if (!host) continue;
    const leftX = host.x - annotGap - a.width;
    const rightX = host.x + host.width + annotGap;
    const candidatesX = [leftX, rightX];
    let placed: CircuitLayoutBox | null = null;
    for (const cx of candidatesX) {
      const box = { x: cx, y: host.y + host.height / 2 - a.height / 2, width: a.width, height: a.height };
      if (!occupied.some((o) => boxesOverlap(box, o, ANNOT_GAP))) {
        placed = box;
        break;
      }
    }
    if (!placed) {
      let y = host.y;
      let guard = 0;
      while (occupied.some((o) => boxesOverlap({ x: leftX, y, width: a.width, height: a.height }, o, ANNOT_GAP)) && guard++ < 200) {
        y += a.height + ANNOT_GAP;
      }
      placed = { x: leftX, y, width: a.width, height: a.height };
    }
    positions.set(a.id, placed);
    occupied.push(placed);
  }

  if (positions.size > 0) {
    let minX = Infinity;
    let minY = Infinity;
    for (const p of positions.values()) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
    }
    const shiftX = origin.x - minX;
    const shiftY = origin.y - minY;
    if (Math.abs(shiftX) > 0.01 || Math.abs(shiftY) > 0.01) {
      for (const [id, p] of positions) {
        positions.set(id, { ...p, x: p.x + shiftX, y: p.y + shiftY });
      }
    }
  }

  const fixedBoxes: Array<{ id: string; box: CircuitLayoutBox }> = [];
  for (const n of logicalNodes) {
    if (!n.fixed) continue;
    const box = { x: n.fixed.position.x, y: n.fixed.position.y, width: n.fixed.width, height: n.fixed.height };
    positions.set(n.id, box);
    fixedBoxes.push({ id: n.id, box });
  }
  if (fixedBoxes.length > 0) {
    for (const n of logicalNodes) {
      if (n.fixed) continue;
      const box = positions.get(n.id);
      if (!box) continue;
      let y = box.y;
      let guard = 0;
      while (guard++ < 300) {
        const hit = fixedBoxes.find((f) => boxesOverlap({ ...box, y }, f.box, 4));
        if (!hit) break;
        y = hit.box.y + hit.box.height + mainGap;
      }
      if (y !== box.y) positions.set(n.id, { ...box, y });
    }
  }

  const edgePlans = new Map<string, CircuitEdgePlan>();
  const allPos = [...positions.values()];
  const globalMaxRight = allPos.length > 0 ? Math.max(...allPos.map((p) => p.x + p.width)) : origin.x;
  let loopIdx = 0;
  let jumpIdx = 0;

  const hasObstacleBetween = (a: CircuitLayoutBox, b: CircuitLayoutBox, sourceId: string, targetId: string): boolean => {
    const cx = a.x + a.width / 2;
    const yTop = a.y + a.height;
    const yBot = b.y;
    if (yBot <= yTop + 4) return false;
    for (const [id, box] of positions) {
      if (id === sourceId || id === targetId) continue;
      if (cx > box.x - 4 && cx < box.x + box.width + 4 && box.y + box.height > yTop && box.y < yBot) return true;
    }
    return false;
  };

  for (const e of edges) {
    const kind = e.kind ?? 'next';
    const key = `${e.from}|${e.to}|${kind}`;
    const a = positions.get(e.from);
    const b = positions.get(e.to);
    if (!a || !b) continue;

    let plan: CircuitEdgePlan;
    const isBack = kind === 'loop' || topo.backEdgeKeys.has(key);
    const isBypass = bypassEdgeKeys.has(key);

    if (kind === 'annotate') {
      const toLeft = b.x + b.width <= a.x + a.width / 2;
      const sourceHandle = toLeft ? 'left' : 'right';
      const targetHandle = toLeft ? 'right' : 'left';
      if (routingMode === 'straight') {
        plan = { sourceHandle, targetHandle, routingType: 'straight' };
      } else {
        const midX = toLeft ? Math.round((b.x + b.width + a.x) / 2) : Math.round((a.x + a.width + b.x) / 2);
        plan = {
          sourceHandle,
          targetHandle,
          routingType: 'orthogonal',
          waypoints: [
            { x: midX, y: a.y + a.height / 2 },
            { x: midX, y: b.y + b.height / 2 },
          ],
        };
      }
    } else if (isBack) {
      const yMin = Math.min(a.y, b.y) - 20;
      const yMax = Math.max(a.y + a.height, b.y + b.height) + 20;
      let localMaxRight = Math.max(a.x + a.width, b.x + b.width);
      for (const p of allPos) {
        if (p.y + p.height >= yMin && p.y <= yMax) localMaxRight = Math.max(localMaxRight, p.x + p.width);
      }
      const corridorX = localMaxRight + LOOP_SIDE + loopIdx++ * REG_LANE_STEP;
      plan = {
        sourceHandle: 'right',
        targetHandle: 'right',
        routingType: 'orthogonal',
        waypoints: [
          { x: corridorX, y: a.y + a.height / 2 },
          { x: corridorX, y: b.y + b.height / 2 },
        ],
      };
    } else if (isBypass) {
      const scx = a.x + a.width / 2;
      const tcx = b.x + b.width / 2;
      const blockedStraight = Math.abs(scx - tcx) < 24 && hasObstacleBetween(a, b, e.from, e.to);
      if (routingMode === 'straight' && !blockedStraight) {
        plan = { sourceHandle: 'bottom', targetHandle: 'top', routingType: 'straight' };
      } else {
        const corridorX = globalMaxRight + LOOP_SIDE + jumpIdx++ * REG_LANE_STEP;
        plan = {
          sourceHandle: 'right',
          targetHandle: 'right',
          routingType: 'orthogonal',
          waypoints: [
            { x: corridorX, y: a.y + a.height / 2 },
            { x: corridorX, y: b.y + b.height / 2 },
          ],
        };
      }
    } else if (routingMode === 'straight') {
      plan = { sourceHandle: 'bottom', targetHandle: 'top', routingType: 'straight' };
    } else {
      const scx = a.x + a.width / 2;
      const tcx = b.x + b.width / 2;
      const outDeg = (cfAdj.get(e.from) ?? []).length;
      const inDeg = (cfParents.get(e.to) ?? []).length;
      if (Math.abs(scx - tcx) <= 2 && b.y >= a.y + a.height) {
        if (hasObstacleBetween(a, b, e.from, e.to)) {
          const corridorX = Math.min(a.x, b.x) - LOOP_SIDE;
          plan = {
            sourceHandle: 'left',
            targetHandle: 'left',
            routingType: 'orthogonal',
            waypoints: [
              { x: corridorX, y: a.y + a.height / 2 },
              { x: corridorX, y: b.y + b.height / 2 },
            ],
          };
        } else {
          plan = { sourceHandle: 'bottom', targetHandle: 'top', routingType: 'orthogonal' };
        }
      } else if (outDeg >= 2 && b.y >= a.y + a.height) {
        const busY = Math.round(a.y + a.height + mainGap * 0.45);
        plan = {
          sourceHandle: 'bottom',
          targetHandle: 'top',
          routingType: 'orthogonal',
          waypoints: [
            { x: scx, y: busY },
            { x: tcx, y: busY },
          ],
        };
      } else if (inDeg >= 2 && b.y >= a.y + a.height) {
        const busY = Math.round(b.y - mainGap * 0.45);
        plan = {
          sourceHandle: 'bottom',
          targetHandle: 'top',
          routingType: 'orthogonal',
          waypoints: [
            { x: scx, y: busY },
            { x: tcx, y: busY },
          ],
        };
      } else {
        plan = { sourceHandle: 'bottom', targetHandle: 'top', routingType: 'orthogonal' };
      }
    }

    edgePlans.set(key, plan);
  }

  if (!isRight) {
    return { positions, edgePlans, backEdgeKeys: topo.backEdgeKeys, warnings };
  }

  const finalPositions = new Map<string, CircuitLayoutBox>();
  for (const [id, p] of positions) {
    finalPositions.set(id, { x: p.y, y: p.x, width: p.height, height: p.width });
  }
  const finalPlans = new Map<string, CircuitEdgePlan>();
  for (const [key, plan] of edgePlans) {
    finalPlans.set(key, {
      sourceHandle: flipSide(plan.sourceHandle),
      targetHandle: flipSide(plan.targetHandle),
      routingType: plan.routingType,
      ...(plan.waypoints ? { waypoints: plan.waypoints.map((pt) => ({ x: pt.y, y: pt.x })) } : {}),
    });
  }

  return { positions: finalPositions, edgePlans: finalPlans, backEdgeKeys: topo.backEdgeKeys, warnings };
}

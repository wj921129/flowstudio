import { describe, it, expect } from 'vitest';
import {
  SEGMENT_MERGE_SNAP_THRESHOLD,
  adjustWaypointsOnNodeMove,
  buildWaypointPath,
  deriveDefaultOrthogonalWaypoints,
  findNearestNodeBorderAnchor,
  moveOrthogonalSegment,
  simplifyOrthogonalWaypoints,
} from '../src/features/canvas/custom-edges/waypoint-path-utils.js';
import type { FlowNode, XYPosition } from '@flowstudio/shared';

const isOrthogonal = (pts: XYPosition[]) =>
  pts.slice(1).every((p, i) => p.x === pts[i].x || p.y === pts[i].y);

describe('waypoint-path-utils: 线段横纵拖动', () => {
  const s = { x: 0, y: 0 };
  const t = { x: 200, y: 100 };
  const wps = [{ x: 100, y: 0 }, { x: 100, y: 100 }];

  it('中间竖线段只沿 X 平移并保持正交', () => {
    const next = moveOrthogonalSegment(s, t, wps, 1, 30);
    expect(next).toEqual([{ x: 130, y: 0 }, { x: 130, y: 100 }]);
    expect(isOrthogonal([s, ...next, t])).toBe(true);
  });

  it('首尾段与无折点直通线段支持自动保留短桩拆出正交折线且绝不挪动起终点', () => {
    const movedFirst = moveOrthogonalSegment(s, t, wps, 0, -40);
    expect(movedFirst.length).toBeGreaterThan(wps.length);
    expect(isOrthogonal([s, ...movedFirst, t])).toBe(true);
    expect(movedFirst[0].y).toBe(s.y);
    expect(movedFirst[1].y).toBe(-40);

    const movedLast = moveOrthogonalSegment(s, t, wps, 2, 40);
    expect(movedLast.length).toBeGreaterThan(wps.length);
    expect(isOrthogonal([s, ...movedLast, t])).toBe(true);
    expect(movedLast[movedLast.length - 1].y).toBe(t.y);
    expect(movedLast[movedLast.length - 2].y).toBe(140);

    const a = { x: 0, y: 50 };
    const b = { x: 300, y: 50 };
    const splitH = moveOrthogonalSegment(a, b, [], 0, 20);
    expect(splitH).toEqual([
      { x: 16, y: 50 },
      { x: 16, y: 70 },
      { x: 284, y: 70 },
      { x: 284, y: 50 },
    ]);
    expect(isOrthogonal([a, ...splitH, b])).toBe(true);

    const va = { x: 50, y: 0 };
    const vb = { x: 50, y: 200 };
    const splitV = moveOrthogonalSegment(va, vb, [], 0, -25);
    expect(splitV).toEqual([
      { x: 50, y: 16 },
      { x: 25, y: 16 },
      { x: 25, y: 184 },
      { x: 50, y: 184 },
    ]);
    expect(isOrthogonal([va, ...splitV, vb])).toBe(true);

    const diag = moveOrthogonalSegment({ x: 0, y: 0 }, { x: 200, y: 100 }, [], 0, 20);
    expect(diag).toEqual([
      { x: 120, y: 0 },
      { x: 120, y: 100 },
    ]);
    expect(isOrthogonal([{ x: 0, y: 0 }, ...diag, { x: 200, y: 100 }])).toBe(true);
  });

  it('中间横线段只沿 Y 平移并保持原有折点数量与正交性', () => {
    const src = { x: 0, y: 0 };
    const tgt = { x: 200, y: 200 };
    const zWps = [{ x: 0, y: 100 }, { x: 200, y: 100 }];
    const next = moveOrthogonalSegment(src, tgt, zWps, 1, -25);
    expect(next).toEqual([{ x: 0, y: 75 }, { x: 200, y: 75 }]);
    expect(next).toHaveLength(2);
    expect(isOrthogonal([src, ...next, tgt])).toBe(true);
  });

  it('简化时合并共线与重复折点', () => {
    expect(simplifyOrthogonalWaypoints(s, t, [{ x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 100 }])).toEqual([
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
    expect(simplifyOrthogonalWaypoints({ x: 0, y: 50 }, { x: 300, y: 50 }, [{ x: 16, y: 50 }, { x: 16, y: 50 }, { x: 284, y: 50 }, { x: 284, y: 50 }])).toEqual([]);
  });

  it('平行两条折线中间存在折线时，拖动靠近另一平行线触发极窄吸附并合并三条折线为一条', () => {
    const src = { x: 0, y: 100 };
    const tgt = { x: 300, y: 100 };
    const wps5H = [
      { x: 100, y: 100 },
      { x: 100, y: 180 },
      { x: 200, y: 180 },
      { x: 200, y: 100 },
    ];
    // 水平中段 segIndex=2 原在 y=180，向 y=100 拖动 75px -> y=105，落入 8px 阈值内吸附到 y=100 并合并 3 条折线
    const mergedH = moveOrthogonalSegment(src, tgt, wps5H, 2, -75);
    expect(mergedH).toEqual([]);

    // 另一侧仅后段共线：源 y=100、目标 y=160，中段 y=200 向目标 y=160 拖动至 y=165（5px <= 8px）
    const tgt2 = { x: 300, y: 160 };
    const wps5H2 = [
      { x: 100, y: 100 },
      { x: 100, y: 200 },
      { x: 200, y: 200 },
      { x: 200, y: 160 },
    ];
    const mergedToTgt = moveOrthogonalSegment(src, tgt2, wps5H2, 2, -35);
    expect(mergedToTgt).toEqual([
      { x: 100, y: 100 },
      { x: 100, y: 160 },
    ]);
    expect(isOrthogonal([src, ...mergedToTgt, tgt2])).toBe(true);

    // 竖直平行段中间存在水平折线：竖中段 x=220 向首竖段 x=100 拖动至 x=106（6px <= 8px）合并
    const vSrc = { x: 100, y: 0 };
    const vTgt = { x: 180, y: 300 };
    const wps5V = [
      { x: 100, y: 100 },
      { x: 220, y: 100 },
      { x: 220, y: 200 },
      { x: 180, y: 200 },
    ];
    const mergedV = moveOrthogonalSegment(vSrc, vTgt, wps5V, 2, -114);
    expect(mergedV).toEqual([
      { x: 100, y: 200 },
      { x: 180, y: 200 },
    ]);
    expect(isOrthogonal([vSrc, ...mergedV, vTgt])).toBe(true);

    // U 型回折合并：简化时收敛消除退化回折
    const uSrc = { x: 0, y: 50 };
    const uTgt = { x: 300, y: 50 };
    const uWps = [
      { x: 100, y: 50 },
      { x: 100, y: 120 },
      { x: 200, y: 120 },
      { x: 200, y: 50 },
    ];
    expect(moveOrthogonalSegment(uSrc, uTgt, uWps, 2, -65, SEGMENT_MERGE_SNAP_THRESHOLD)).toEqual([]);

    // 超过阈值或关闭吸附 (snapThreshold=0) 时保留折线不合并
    const unmerged = moveOrthogonalSegment(src, tgt, wps5H, 2, -65);
    expect(unmerged).toHaveLength(4);
    const noSnap = moveOrthogonalSegment(src, tgt, wps5H, 2, -75, 0);
    expect(noSnap[1].y).toBe(105);
    expect(noSnap).toHaveLength(4);
  });
});

describe('waypoint-path-utils: 节点平移保角与两端锚点吸附', () => {
  it('平移单个节点时只增缩连接线段，不改变折线直角结构', () => {
    const src = { x: 100, y: 100 };
    const tgt = { x: 300, y: 200 };
    const wps = [
      { x: 200, y: 100 },
      { x: 200, y: 200 },
    ];

    // 源节点向右平移 30、向下平移 40：首折点仅随 y 跟进，x=200 保持结构不变
    const movedSrc = adjustWaypointsOnNodeMove({
      waypoints: wps,
      sourceDelta: { x: 30, y: 40 },
      targetDelta: { x: 0, y: 0 },
      sourceSide: 'right',
      targetSide: 'left',
      oldSource: src,
      oldTarget: tgt,
      newSource: { x: 130, y: 140 },
      newTarget: tgt,
    });
    expect(movedSrc).toEqual([
      { x: 200, y: 140 },
      { x: 200, y: 200 },
    ]);
    expect(isOrthogonal([{ x: 130, y: 140 }, ...movedSrc, tgt])).toBe(true);

    // 源节点大幅右移跨过 x=200（newSource.x=230）：防倒穿推进中竖段至 230+16=246，仍保正交
    const pushedSrc = adjustWaypointsOnNodeMove({
      waypoints: wps,
      sourceDelta: { x: 130, y: 0 },
      targetDelta: { x: 0, y: 0 },
      sourceSide: 'right',
      targetSide: 'left',
      oldSource: src,
      oldTarget: tgt,
      newSource: { x: 230, y: 100 },
      newTarget: tgt,
    });
    expect(pushedSrc).toEqual([
      { x: 246, y: 100 },
      { x: 246, y: 200 },
    ]);
    expect(isOrthogonal([{ x: 230, y: 100 }, ...pushedSrc, tgt])).toBe(true);

    // 目标节点向下平移 50：仅尾折点跟进 y
    const movedTgt = adjustWaypointsOnNodeMove({
      waypoints: wps,
      sourceDelta: { x: 0, y: 0 },
      targetDelta: { x: 0, y: 50 },
      sourceSide: 'right',
      targetSide: 'left',
      oldSource: src,
      oldTarget: tgt,
      newSource: src,
      newTarget: { x: 300, y: 250 },
    });
    expect(movedTgt).toEqual([
      { x: 200, y: 100 },
      { x: 200, y: 250 },
    ]);
    expect(isOrthogonal([src, ...movedTgt, { x: 300, y: 250 }])).toBe(true);
  });

  it('双端同速平移刚性跟随，L 型单折点与共线单折点均保持正交', () => {
    const rigid = adjustWaypointsOnNodeMove({
      waypoints: [
        { x: 200, y: 100 },
        { x: 200, y: 200 },
      ],
      sourceDelta: { x: 45, y: -20 },
      targetDelta: { x: 45, y: -20 },
    });
    expect(rigid).toEqual([
      { x: 245, y: 80 },
      { x: 245, y: 180 },
    ]);

    // L 型单折点（right -> top）
    const lCorner = adjustWaypointsOnNodeMove({
      waypoints: [{ x: 300, y: 100 }],
      sourceDelta: { x: 10, y: 25 },
      targetDelta: { x: -15, y: 5 },
      sourceSide: 'right',
      targetSide: 'top',
    });
    expect(lCorner).toEqual([{ x: 285, y: 125 }]);
    expect(isOrthogonal([{ x: 110, y: 125 }, ...lCorner, { x: 285, y: 205 }])).toBe(true);

    // 共线单折点（right -> left）源端垂直移动：自动拆为双折点保持正交
    const splitCollinear = adjustWaypointsOnNodeMove({
      waypoints: [{ x: 200, y: 100 }],
      sourceDelta: { x: 0, y: 30 },
      targetDelta: { x: 0, y: 0 },
      sourceSide: 'right',
      targetSide: 'left',
    });
    expect(splitCollinear).toEqual([
      { x: 200, y: 130 },
      { x: 200, y: 100 },
    ]);
    expect(isOrthogonal([{ x: 100, y: 130 }, ...splitCollinear, { x: 300, y: 100 }])).toBe(true);
  });

  it('findNearestNodeBorderAnchor 支持同节点跨边吸附与异节点几何边框吸附，且排除对端和容器节点', () => {
    const nodes: FlowNode[] = [
      {
        id: 'pool-1',
        type: 'pool',
        position: { x: 0, y: 0 },
        width: 800,
        height: 400,
        data: { label: '泳道池', type: 'pool' },
      },
      {
        id: 'n1',
        type: 'process',
        position: { x: 100, y: 100 },
        width: 120,
        height: 60,
        data: { label: 'A', type: 'process' },
      },
      {
        id: 'n2',
        type: 'decision',
        position: { x: 360, y: 100 },
        width: 120,
        height: 80,
        data: { label: 'B', type: 'decision' },
      },
    ];

    // 拖到 n1 上边中点（可换到同节点其他边），排除对端 n2
    const hitSelf = findNearestNodeBorderAnchor({ x: 160, y: 96 }, nodes, 'n2');
    expect(hitSelf?.nodeId).toBe('n1');
    expect(hitSelf?.side).toBe('top');
    expect(hitSelf?.handleId).toBe('top');

    // 拖到 n2 菱形左顶角附近
    const hitDecision = findNearestNodeBorderAnchor({ x: 364, y: 140 }, nodes, 'n1');
    expect(hitDecision?.nodeId).toBe('n2');
    expect(hitDecision?.side).toBe('left');

    // 拖到泳道空白处不误吸附容器节点
    const hitEmpty = findNearestNodeBorderAnchor({ x: 700, y: 350 }, nodes, 'n1');
    expect(hitEmpty).toBeNull();
  });
});

describe('waypoint-path-utils: Orthogonal Edge Waypoints and Routing', () => {
  it('builds orthogonal SVG path string from source, waypoints, and target', () => {
    const source = { x: 50, y: 100 };
    const target = { x: 400, y: 300 };
    const waypoints = [
      { x: 200, y: 100 },
      { x: 200, y: 300 },
    ];

    const result = buildWaypointPath(source, target, waypoints);

    expect(result.path).toBe('M 50 100 L 200 100 L 200 300 L 400 300');
    expect(result.segments.length).toBe(3);

    // 第一段：(50, 100) -> (200, 100)，中点为 (125, 100)
    expect(result.segments[0].midpoint).toEqual({ x: 125, y: 100 });
    // 第二段：(200, 100) -> (200, 300)，中点为 (200, 200)
    expect(result.segments[1].midpoint).toEqual({ x: 200, y: 200 });
    // 第三段：(200, 300) -> (400, 300)，中点为 (300, 300)
    expect(result.segments[2].midpoint).toEqual({ x: 300, y: 300 });

    // 标签应落在中间线段 (200, 200) 附近
    expect(result.labelPosition).toEqual({ x: 200, y: 200 });
  });

  it('derives default orthogonal waypoints between two arbitrary points', () => {
    const source = { x: 100, y: 50 };
    const target = { x: 300, y: 250 };

    const derived = deriveDefaultOrthogonalWaypoints(source, target);

    // 中间 X 轴为 200
    expect(derived.length).toBe(2);
    expect(derived[0]).toEqual({ x: 200, y: 50 });
    expect(derived[1]).toEqual({ x: 200, y: 250 });

    const pathRes = buildWaypointPath(source, target, derived);
    expect(pathRes.path).toBe('M 100 50 L 200 50 L 200 250 L 300 250');
  });

  it('derives bend at mid Y for a vertically routed edge', () => {
    const source = { x: 100, y: 50 };
    const target = { x: 300, y: 250 };

    const derived = deriveDefaultOrthogonalWaypoints(source, target, 'bottom', 'top');

    expect(derived).toEqual([
      { x: 100, y: 150 },
      { x: 300, y: 150 },
    ]);
  });

  it('derives a single corner when the two anchors lie on different axes', () => {
    const source = { x: 100, y: 50 };
    const target = { x: 300, y: 250 };

    expect(deriveDefaultOrthogonalWaypoints(source, target, 'right', 'top')).toEqual([
      { x: 300, y: 50 },
    ]);
    expect(deriveDefaultOrthogonalWaypoints(source, target, 'bottom', 'left')).toEqual([
      { x: 100, y: 250 },
    ]);
  });

  it('handles empty waypoints list gracefully', () => {
    const source = { x: 0, y: 0 };
    const target = { x: 100, y: 100 };

    const result = buildWaypointPath(source, target, []);
    expect(result.path).toBe('M 0 0 L 100 100');
    expect(result.segments.length).toBe(1);
    expect(result.labelPosition).toEqual({ x: 50, y: 50 });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  useFlowStore,
  selectNodeById,
  selectIncomingHandleKeys,
  selectCustomAttachedHandleKeys,
  selectNodeSemanticRole,
} from '../src/stores/flow-store';
import {
  deriveDisplayNodes,
  POOL_Z_INDEX,
  LANE_Z_INDEX,
  type DisplayNodeCacheEntry,
} from '../src/features/canvas/utils/display-nodes';
import {
  CANVAS_BASE_EXTENT,
  computeCanvasTranslateExtent,
  resolveMiniMapFlowPosition,
} from '../src/features/canvas/utils/canvas-bounds';
import { resolveNodeSemanticRole } from '../src/features/canvas/custom-nodes/base-node-wrapper';
import {
  getPointAtPolylineRatio,
  projectPointOntoPolyline,
} from '../src/features/canvas/custom-edges/waypoint-path-utils';
import { computeFlowDotAnimationSpec } from '../src/features/canvas/custom-edges/orthogonal-edge';
import {
  parseBorderAnchorHandle,
  formatBorderAnchorHandle,
  projectPointToNodeBorder,
  getShapeBorderNormalizedPoint,
} from '@flowstudio/shared';
import { THEME_PRESETS } from '../src/features/sidebar/styles/theme-presets';
import { resolveNodeStyle } from '../src/features/sidebar/styles/style-resolver';

describe('画布交互体验与视觉改造回归测试', () => {
  beforeEach(() => {
    useFlowStore.setState({
      activeTool: 'select',
      isSpacePanning: false,
      editingEdgeLabelId: null,
    });
  });

  it('按住空格临时平移状态可切换并无损返回上一个工具', () => {
    useFlowStore.getState().setActiveTool('connect');
    useFlowStore.getState().setSpacePanning(true);
    expect(useFlowStore.getState().isSpacePanning).toBe(true);
    expect(useFlowStore.getState().activeTool).toBe('connect');

    useFlowStore.getState().setSpacePanning(false);
    expect(useFlowStore.getState().isSpacePanning).toBe(false);
    expect(useFlowStore.getState().activeTool).toBe('connect');
  });

  it('开始-处理-结束语义角色按拓扑与文案准确区分', () => {
    const edges = [
      { source: 'n-start', target: 'n-proc' },
      { source: 'n-proc', target: 'n-end' },
    ];
    expect(resolveNodeSemanticRole('n-start', 'start-end', '节点A', edges)).toBe('start');
    expect(resolveNodeSemanticRole('n-proc', 'process', '处理B', edges)).toBe('process');
    expect(resolveNodeSemanticRole('n-end', 'start-end', '节点C', edges)).toBe('end');
    expect(resolveNodeSemanticRole('n-iso-end', 'start-end', '流程结束', [])).toBe('end');
    expect(resolveNodeSemanticRole('n-iso-start', 'start-end', '发起申请', [])).toBe('start');
  });

  it('连线标签沿折线比例计算与拖动投影吸附精确可用', () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    expect(getPointAtPolylineRatio(poly, 0.25)).toEqual({ x: 50, y: 0 });
    expect(getPointAtPolylineRatio(poly, 0.75)).toEqual({ x: 100, y: 50 });

    const proj = projectPointOntoPolyline(poly, { x: 112, y: 50 });
    expect(proj.point).toEqual({ x: 100, y: 50 });
    expect(proj.ratio).toBe(0.75);
  });

  it('样式与组件源码包含黑边手掌光标、正圆居中锚点、连线模式全锚点及非走查零降暗', () => {
    const tokensCss = fs.readFileSync(
      path.resolve(__dirname, '../src/features/theme/tokens.css'),
      'utf-8'
    );
    expect(tokensCss).toContain('.fs-cursor-pan');
    expect(tokensCss).toContain("stroke='%232563eb'");
    expect(tokensCss).toContain('M4.037 4.688');
    expect(tokensCss).toContain('.fs-handle-dot');
    expect(tokensCss).toContain('aspect-ratio: 1 / 1');
    expect(tokensCss).toContain('--fs-node-start-bg');
    expect(tokensCss).toContain('--fs-node-process-bg');
    expect(tokensCss).toContain('--fs-node-end-bg');

    const wrapperCode = fs.readFileSync(
      path.resolve(__dirname, '../src/features/canvas/custom-nodes/base-node-wrapper.tsx'),
      'utf-8'
    );
    expect(wrapperCode).toContain("const isForceShowHandles = isConnecting || activeTool === 'connect';");
    expect(wrapperCode).toContain('fs-handle-dot');

    const canvasCode = fs.readFileSync(
      path.resolve(__dirname, '../src/features/canvas/flow-canvas.tsx'),
      'utf-8'
    );
    expect(canvasCode).toContain('const hasSpotlightDim = Boolean(spotlightActive && spotlightResult);');
    expect(canvasCode).toContain('const dimOthers = spotlightActive;');

    const toolbarCode = fs.readFileSync(
      path.resolve(__dirname, '../src/features/toolbar/floating-toolbar.tsx'),
      'utf-8'
    );
    expect(toolbarCode).toContain("active={activeTool === 'pan' || isSpacePanning}");
    expect(tokensCss).toContain("fill='%23ffffff' stroke='%232563eb'");
    expect(tokensCss).toContain("fill='%230f172a' stroke='%23ffffff'");
    expect(tokensCss).toContain("width='20' height='20'");
    expect(tokensCss).not.toContain("width='24' height='24'");
  });

  it('6 套元素风格均为开始与结束节点提供独立且可区分的主题配色', () => {
    const colorDist = (a: string, b: string) => {
      const parse = (hex: string) => {
        const clean = hex.replace('#', '');
        return [
          parseInt(clean.slice(0, 2), 16),
          parseInt(clean.slice(2, 4), 16),
          parseInt(clean.slice(4, 6), 16),
        ];
      };
      const [r1, g1, b1] = parse(a);
      const [r2, g2, b2] = parse(b);
      return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
    };

    for (const theme of THEME_PRESETS) {
      const startStyle = resolveNodeStyle('start-end', theme, 'start');
      const processStyle = resolveNodeStyle('process', theme, 'process');
      const endStyle = resolveNodeStyle('start-end', theme, 'end');
      expect(startStyle.fillColor).toBeTruthy();
      expect(endStyle.fillColor).toBeTruthy();
      expect(startStyle.fillColor).not.toBe(endStyle.fillColor);
      expect(startStyle.fillColor).not.toBe(processStyle.fillColor);
      expect(endStyle.fillColor).not.toBe(processStyle.fillColor);
      expect(colorDist(startStyle.borderColor, processStyle.borderColor)).toBeGreaterThanOrEqual(90);
      expect(colorDist(endStyle.borderColor, processStyle.borderColor)).toBeGreaterThanOrEqual(90);
      expect(colorDist(startStyle.borderColor, endStyle.borderColor)).toBeGreaterThanOrEqual(90);
    }
  });

  it('连线文字标记可独立选中并单独删除而不删除连线', () => {
    useFlowStore.setState({
      nodes: [
        { id: 'n1', type: 'process', position: { x: 0, y: 0 }, data: { label: 'A', type: 'process' } },
        { id: 'n2', type: 'process', position: { x: 200, y: 0 }, data: { label: 'B', type: 'process' } },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', label: '通过', data: { label: '通过', labelRatio: 0.4 } },
      ],
      selectedNodeIds: [],
      selectedEdgeId: null,
      selectedEdgeLabelId: null,
    });

    useFlowStore.getState().setSelectedEdgeLabelId('e1');
    expect(useFlowStore.getState().selectedEdgeLabelId).toBe('e1');
    expect(useFlowStore.getState().selectedEdgeId).toBeNull();

    useFlowStore.getState().deleteSelected();
    const state = useFlowStore.getState();
    expect(state.edges).toHaveLength(1);
    expect(state.edges[0].label).toBeUndefined();
    expect(state.edges[0].data?.label).toBeUndefined();
    expect(state.edges[0].data?.labelRatio).toBeUndefined();
    expect(state.selectedEdgeLabelId).toBeNull();
  });

  it('边框任意位置连线点支持极窄 1/2、1/3、1/4 对齐规则与自由定位', () => {
    // 120x60 节点顶边：1/4 = 30px, 1/3 = 40px, 1/2 = 60px
    const snapQuarter = projectPointToNodeBorder(33, 1, 120, 60);
    expect(snapQuarter.side).toBe('top');
    expect(snapQuarter.offset).toBe(0.25);
    expect(snapQuarter.snappedLabel).toBe('1/4');

    const snapThird = projectPointToNodeBorder(42, 0, 120, 60);
    expect(snapThird.side).toBe('top');
    expect(snapThird.offset).toBeCloseTo(1 / 3, 4);
    expect(snapThird.snappedLabel).toBe('1/3');

    const snapHalf = projectPointToNodeBorder(58, 59, 120, 60);
    expect(snapHalf.side).toBe('bottom');
    expect(snapHalf.offset).toBe(0.5);
    expect(snapHalf.snappedLabel).toBe('1/2');

    // 超出 ±5px 阈值或禁用吸附时自由定位
    const freePoint = projectPointToNodeBorder(15, 0, 120, 60);
    expect(freePoint.snappedLabel).toBeUndefined();
    expect(freePoint.offset).toBeCloseTo(0.125, 4);

    const altFree = projectPointToNodeBorder(33, 1, 120, 60, { disableSnap: true });
    expect(altFree.snappedLabel).toBeUndefined();
    expect(altFree.offset).toBeCloseTo(33 / 120, 4);

    expect(formatBorderAnchorHandle('top', 0.5)).toBe('top');
    expect(formatBorderAnchorHandle('right', 0.25)).toBe('right@0.25');
    expect(parseBorderAnchorHandle('right@0.25')).toEqual({ side: 'right', offset: 0.25 });
    expect(parseBorderAnchorHandle('left')).toEqual({ side: 'left', offset: 0.5 });
  });

  it('邻接摘要选择器与泳道/节点组件消除全图扫描及无参 store 订阅', () => {
    const nodes = [
      { id: 'n1', type: 'start-end' as const, position: { x: 0, y: 0 }, data: { label: '起', type: 'start-end' as const } },
      { id: 'n2', type: 'process' as const, position: { x: 200, y: 0 }, data: { label: '中', type: 'process' as const } },
      { id: 'n3', type: 'start-end' as const, position: { x: 400, y: 0 }, data: { label: '终', type: 'start-end' as const } },
    ];
    const edges = [
      { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'right@0.25' },
      { id: 'e2', source: 'n2', target: 'n3', targetHandle: 'left' },
    ];

    expect(selectNodeById(nodes, 'n2')?.id).toBe('n2');
    expect(selectNodeSemanticRole(edges, 'n1', 'start-end', '起')).toBe('start');
    expect(selectNodeSemanticRole(edges, 'n3', 'start-end', '终')).toBe('end');
    expect(selectIncomingHandleKeys(nodes, edges, 'n2')).toBe('left');
    expect(selectIncomingHandleKeys(nodes, edges, 'n3')).toBe('left');
    expect(selectCustomAttachedHandleKeys(edges, 'n1', new Set(['top', 'right', 'bottom', 'left']))).toBe('right@0.25');

    const laneCode = fs.readFileSync(
      path.resolve(__dirname, '../src/features/canvas/custom-nodes/lane-node.tsx'),
      'utf-8'
    );
    expect(laneCode).not.toMatch(/useFlowStore\(\s*\)/);

    const wrapperCode = fs.readFileSync(
      path.resolve(__dirname, '../src/features/canvas/custom-nodes/base-node-wrapper.tsx'),
      'utf-8'
    );
    expect(wrapperCode).not.toContain('useCollaboration');
    expect(wrapperCode).not.toMatch(/for\s*\(\s*const\s+edge\s+of\s+s\.edges\s*\)/);
  });

  it('deriveDisplayNodes 在无聚光灯与无锁定时复用原数组，局部变更时复用未变化节点引用', () => {
    const cache = new Map<string, DisplayNodeCacheEntry>();
    const n1 = { id: 'n1', type: 'process' as const, position: { x: 0, y: 0 }, data: { label: '1', type: 'process' as const } };
    const n2 = { id: 'n2', type: 'process' as const, position: { x: 200, y: 0 }, data: { label: '2', type: 'process' as const, lockMode: 'position' as const } };
    const n3 = { id: 'n3', type: 'process' as const, position: { x: 400, y: 0 }, data: { label: '3', type: 'process' as const } };

    // 1. 无聚光灯、无锁定：直接返回原数组引用
    const unlocked = [n1, n3];
    expect(deriveDisplayNodes(unlocked, { hasSpotlightDim: false, spotlightResult: null, isReadOnly: false }, cache)).toBe(unlocked);

    // 2. 存在锁定节点时，移动 n1 不应重建 n2 与 n3 的派生引用
    const frame1 = deriveDisplayNodes([n1, n2, n3], { hasSpotlightDim: false, spotlightResult: null, isReadOnly: false }, cache);
    expect(frame1[1].draggable).toBe(false);
    expect(frame1[2]).toBe(n3);

    const n1Moved = { ...n1, position: { x: 50, y: 0 } };
    const frame2 = deriveDisplayNodes([n1Moved, n2, n3], { hasSpotlightDim: false, spotlightResult: null, isReadOnly: false }, cache);
    expect(frame2[1]).toBe(frame1[1]);
    expect(frame2[2]).toBe(n3);

    // 3. 聚光灯模式下，移动 n1 不应重建 n2 与 n3 的派生引用
    const spotlightResult = { nodeIds: new Set(['n1']), edgeIds: new Set<string>(), laneIds: new Set<string>() };
    const spot1 = deriveDisplayNodes([n1, n2, n3], { hasSpotlightDim: true, spotlightResult, isReadOnly: false }, cache);
    const spot2 = deriveDisplayNodes([n1Moved, n2, n3], { hasSpotlightDim: true, spotlightResult, isReadOnly: false }, cache);
    expect(spot2[0]).not.toBe(spot1[0]);
    expect(spot2[1]).toBe(spot1[1]);
    expect(spot2[2]).toBe(spot1[2]);
  });

  it('deriveDisplayNodes 将 pool/lane 层级置底防遮挡（含选中抬升与 style.zIndex 清理），并自动修复子先于父的拓扑序', () => {
    const cache = new Map<string, DisplayNodeCacheEntry>();
    const pool = {
      id: 'pool-1',
      type: 'pool' as const,
      position: { x: 0, y: 0 },
      style: { width: 800, height: 400, zIndex: 999 },
      data: { label: '泳道池', type: 'pool' as const },
    };
    const lane = {
      id: 'lane-1',
      type: 'lane' as const,
      parentId: 'pool-1',
      position: { x: 0, y: 40 },
      style: { width: 800, height: 200, zIndex: 888 },
      data: { label: '泳道1', type: 'lane' as const },
    };
    const child = {
      id: 'node-child',
      type: 'process' as const,
      parentId: 'lane-1',
      position: { x: 80, y: 60 },
      data: { label: '泳道内节点', type: 'process' as const },
    };
    const floating = {
      id: 'node-floating',
      type: 'process' as const,
      position: { x: 100, y: 120 },
      data: { label: '浮游节点', type: 'process' as const },
    };

    const derived = deriveDisplayNodes(
      [child, floating, lane, pool],
      { hasSpotlightDim: false, spotlightResult: null, isReadOnly: false },
      cache
    );

    expect(derived.map((n) => n.id)).toEqual(['node-floating', 'pool-1', 'lane-1', 'node-child']);
    expect(derived[0]).toBe(floating);
    expect(derived[1].zIndex).toBe(POOL_Z_INDEX);
    expect(derived[2].zIndex).toBe(LANE_Z_INDEX);
    expect(POOL_Z_INDEX).toBeLessThan(LANE_Z_INDEX);
    expect(POOL_Z_INDEX + 1000).toBeLessThan(0);
    expect(LANE_Z_INDEX + 1000).toBeLessThan(0);
    expect((derived[1].style as Record<string, unknown> | undefined)?.zIndex).toBeUndefined();
    expect((derived[2].style as Record<string, unknown> | undefined)?.zIndex).toBeUndefined();
    expect(derived[3]).toBe(child);

    const floatingMoved = { ...floating, position: { x: 120, y: 140 } };
    const derived2 = deriveDisplayNodes(
      [pool, lane, floatingMoved, child],
      { hasSpotlightDim: false, spotlightResult: null, isReadOnly: false },
      cache
    );
    expect(derived2[0]).toBe(derived[1]);
    expect(derived2[1]).toBe(derived[2]);
  });

  it('特殊形状连接点贴合真实几何边框，移除分点浮标，顶部操作栏固定居中且浅色节点光标高对比', () => {
    // 1. 菱形 decision: 1/4 与 1/3 位置严格落在菱形斜边上
    const decTopQuarter = getShapeBorderNormalizedPoint('top', 0.25, 'decision');
    expect(decTopQuarter.u).toBeCloseTo(0.25, 4);
    expect(decTopQuarter.v).toBeCloseTo(0.255, 4);
    const decProj = projectPointToNodeBorder(140 / 3, 17.33, 140, 100, { nodeType: 'decision' });
    expect(decProj.side).toBe('top');
    expect(decProj.x).toBeCloseTo(140 / 3, 1);
    expect(decProj.y).toBeCloseTo(17.33, 1);

    // 2. 圆柱 database: 顶部 1/4 贴合上椭圆弧，底部中点贴合下弧底
    const dbTopQuarter = getShapeBorderNormalizedPoint('top', 0.25, 'database');
    expect(dbTopQuarter.v).toBeGreaterThan(0.02);
    expect(dbTopQuarter.v).toBeLessThan(0.13);
    const dbProj = projectPointToNodeBorder(60, 99, 120, 100, { nodeType: 'database' });
    expect(dbProj.side).toBe('bottom');
    expect(dbProj.y).toBeCloseTo(99, 1);

    // 3. 平行四边形 io: 左右斜边随纵坐标线性内缩
    const ioLeft = getShapeBorderNormalizedPoint('left', 0.5, 'io');
    const ioRight = getShapeBorderNormalizedPoint('right', 0.5, 'io');
    expect(ioLeft.u).toBeCloseTo(0.06, 4);
    expect(ioRight.u).toBeCloseTo(0.94, 4);
    const ioProj = projectPointToNodeBorder(10, 40, 160, 80, { nodeType: 'io' });
    expect(ioProj.side).toBe('left');
    expect(ioProj.x).toBeCloseTo(9.6, 1);

    // 4. 文档 document: 底边右侧波浪谷位高于底框
    const docBottomRight = getShapeBorderNormalizedPoint('bottom', 0.75, 'document');
    expect(docBottomRight.v).toBeLessThan(0.95);
    const docProj = projectPointToNodeBorder(120, 72, 160, 80, { nodeType: 'document' });
    expect(docProj.side).toBe('bottom');
    expect(docProj.y).toBeLessThan(76);

    // 5. BaseNodeWrapper 不再渲染 snappedLabel 文字浮标
    const wrapperCode = fs.readFileSync(
      path.resolve(__dirname, '../src/features/canvas/custom-nodes/base-node-wrapper.tsx'),
      'utf-8'
    );
    expect(wrapperCode).not.toContain('hoverAnchor.snappedLabel');

    // 6. ContextualActionBar 固定至画布顶部居中
    const actionBarCode = fs.readFileSync(
      path.resolve(__dirname, '../src/features/canvas/floating-toolbar/contextual-action-bar.tsx'),
      'utf-8'
    );
    expect(actionBarCode).toContain('top-4 left-1/2 -translate-x-1/2');
    expect(actionBarCode).not.toContain('computeBoundingBox');

    // 7. 浅色节点内悬停使用蓝边箭头图标，不落回系统白手
    const tokensCss = fs.readFileSync(
      path.resolve(__dirname, '../src/features/theme/tokens.css'),
      'utf-8'
    );
    expect(tokensCss).toContain('.react-flow:not(.fs-cursor-pan):not(.fs-cursor-connect) .react-flow__node.draggable');
  });

  it('底部工具栏连线模式与线型按钮采用悬停向上弹窗选择，移出消失且不再点击循环切换', () => {
    const toolbarCode = fs.readFileSync(
      path.resolve(__dirname, '../src/features/toolbar/floating-toolbar.tsx'),
      'utf-8'
    );
    expect(toolbarCode).toContain('onMouseEnter={() => setOpen(true)}');
    expect(toolbarCode).toContain('onMouseLeave={() => setOpen(false)}');
    expect(toolbarCode).toContain('bottom-full left-1/2 -translate-x-1/2 pb-2');
    expect(toolbarCode).toContain('EDGE_MODE_OPTIONS');
    expect(toolbarCode).toContain('LINE_STYLE_OPTIONS');
    expect(toolbarCode).not.toContain('toggleEdgeConnectMode');
    expect(toolbarCode).not.toContain('handleLineStyleCycle');
    expect(toolbarCode).toMatch(/handleActivateConnectTool[\s\S]*?setActiveTool\('connect'\)/);
    expect(toolbarCode).not.toMatch(/handleActivateConnectTool[\s\S]*?setEdgeConnectMode\('orthogonal'\)/);

    useFlowStore.setState({
      nodes: [
        { id: 'n1', type: 'process', position: { x: 0, y: 0 }, data: { label: 'A', type: 'process' } },
        { id: 'n2', type: 'process', position: { x: 200, y: 0 }, data: { label: 'B', type: 'process' } },
      ],
      edges: [],
      edgeConnectMode: 'orthogonal',
      edgeLineStyle: 'solid',
    });
    useFlowStore.getState().setEdgeConnectMode('straight');
    useFlowStore.getState().setEdgeLineStyle('dashed');
    useFlowStore.getState().onConnect({ source: 'n1', target: 'n2', sourceHandle: null, targetHandle: null });
    const created = useFlowStore.getState().edges[0];
    expect(created.type).toBe('straight');
    expect(created.data?.style?.strokeStyle).toBe('dashed');
  });

  it('连线标签复用当前模式光标，支持单独选中与角标删除，并在平移模式下全量封锁交互', () => {
    const tokensCss = fs.readFileSync(
      path.resolve(__dirname, '../src/features/theme/tokens.css'),
      'utf-8'
    );
    expect(tokensCss).toContain('.react-flow:not(.fs-cursor-pan):not(.fs-cursor-connect) .fs-edge-label');
    expect(tokensCss).toContain(':root.dark .react-flow:not(.fs-cursor-pan):not(.fs-cursor-connect) .fs-edge-label');

    const edgeCode = fs.readFileSync(
      path.resolve(__dirname, '../src/features/canvas/custom-edges/orthogonal-edge.tsx'),
      'utf-8'
    );
    expect(edgeCode).toContain('fs-edge-label');
    expect(edgeCode).not.toContain('cursor-grab');
    expect(edgeCode).not.toContain('cursor-grabbing');
    expect(edgeCode).toContain('isPanOrLocked = isSpacePanning || isReadOnly || activeTool === \'pan\'');
    expect(edgeCode).toContain('if (!isPanOrLocked) e.stopPropagation()');
    expect(edgeCode).toContain('aria-label="删除连线标签"');
    expect(edgeCode).toContain('deleteEdgeLabel(id)');

    const wrapperCode = fs.readFileSync(
      path.resolve(__dirname, '../src/features/canvas/custom-nodes/base-node-wrapper.tsx'),
      'utf-8'
    );
    expect(wrapperCode).toContain('isConnectable={!isPanOrLocked}');

    const poolCode = fs.readFileSync(
      path.resolve(__dirname, '../src/features/canvas/custom-nodes/pool-node.tsx'),
      'utf-8'
    );
    expect(poolCode).toContain('if (isPanOrLocked) return;');

    const laneCode = fs.readFileSync(
      path.resolve(__dirname, '../src/features/canvas/custom-nodes/lane-node.tsx'),
      'utf-8'
    );
    expect(laneCode).toContain('if (isPanOrLocked) return;');

    const canvasCode = fs.readFileSync(
      path.resolve(__dirname, '../src/features/canvas/flow-canvas.tsx'),
      'utf-8'
    );
    expect(canvasCode).toContain('isInteractionLocked = isReadOnly || spacePanningNow || activeToolNow === \'pan\'');
    expect(canvasCode).toContain('{!isPresenting && !effectivePanMode && <ContextualActionBar />}');
  });

  it('画布移动边界按基准与图元包围盒动态延展，右上角缩略图准确换算点击定位坐标', () => {
    expect(CANVAS_BASE_EXTENT).toEqual([
      [-4000, -4000],
      [6000, 6000],
    ]);
    expect(computeCanvasTranslateExtent([])).toEqual(CANVAS_BASE_EXTENT);

    const extent = computeCanvasTranslateExtent([
      {
        id: 'pool-1',
        type: 'pool',
        position: { x: 5500, y: -3500 },
        width: 400,
        height: 200,
        data: { label: 'P', type: 'pool' },
      },
      {
        id: 'child-1',
        type: 'process',
        parentId: 'pool-1',
        position: { x: 300, y: 50 },
        width: 160,
        height: 80,
        data: { label: 'C', type: 'process' },
      },
    ]);
    expect(extent).toEqual([
      [-4000, -5500],
      [7960, 6000],
    ]);

    const mapped = resolveMiniMapFlowPosition(
      188,
      64,
      { left: 100, top: 0, width: 176, height: 128 },
      { x: 0, y: 0, width: 880, height: 640 },
      CANVAS_BASE_EXTENT
    );
    expect(mapped).toEqual({ x: 440, y: 320 });

    const clamped = resolveMiniMapFlowPosition(
      99999,
      -99999,
      { left: 100, top: 0, width: 176, height: 128 },
      { x: 0, y: 0, width: 880, height: 640 },
      CANVAS_BASE_EXTENT
    );
    expect(clamped).toEqual({ x: 6000, y: -4000 });

    const controlsCode = fs.readFileSync(
      path.resolve(__dirname, '../src/features/canvas/canvas-controls.tsx'),
      'utf-8'
    );
    expect(controlsCode).toContain('useState(true)');
    expect(controlsCode).toContain('position="top-right"');
    expect(controlsCode).toContain('!mr-[332px]');
    expect(controlsCode).toContain('pannable={false}');
    expect(controlsCode).toContain('setCenter(target.x, target.y');
    expect(controlsCode).toContain('maskStrokeColor="transparent"');
    expect(controlsCode).toContain('maskStrokeWidth={0}');
    expect(controlsCode).toContain('MiniMapFocusNode');
    expect(controlsCode).toContain('fs-minimap-focus-ring');
    expect(controlsCode).not.toContain('maskStrokeColor="var(--fs-primary)"');
    expect(controlsCode).not.toContain('maskColor="var(--fs-canvas-dot)"');

    const edgeCode = fs.readFileSync(
      path.resolve(__dirname, '../src/features/canvas/custom-edges/orthogonal-edge.tsx'),
      'utf-8'
    );
    expect(edgeCode).not.toContain('+ 标签');
    expect(edgeCode).not.toContain('handleWaypointPointerDown');

    const elementsPanelCode = fs.readFileSync(
      path.resolve(__dirname, '../src/features/sidebar/tabs/elements-panel.tsx'),
      'utf-8'
    );
    expect(elementsPanelCode).toContain('EDGE_LABEL_DRAG_MIME');
    expect(elementsPanelCode).toContain('aria-label="连线标签"');

    const canvasCode = fs.readFileSync(
      path.resolve(__dirname, '../src/features/canvas/flow-canvas.tsx'),
      'utf-8'
    );
    expect(canvasCode).toContain('translateExtent={translateExtent}');
  });

  it('选中连线及箭头变蓝、平移节点保持折线结构、两端支持拖拽重连', () => {
    const edgeCode = fs.readFileSync(
      path.resolve(__dirname, '../src/features/canvas/custom-edges/orthogonal-edge.tsx'),
      'utf-8'
    );
    expect(edgeCode).toContain("selected && incomingStroke !== '#6366f1'");
    expect(edgeCode.indexOf('...style,')).toBeLessThan(edgeCode.indexOf('stroke: strokeColor,'));
    expect(edgeCode).toContain('aria-label="拖动连线起点"');
    expect(edgeCode).toContain('aria-label="拖动连线终点"');
    expect(edgeCode).toContain('SEGMENT_MERGE_SNAP_THRESHOLD');

    const canvasCode = fs.readFileSync(
      path.resolve(__dirname, '../src/features/canvas/flow-canvas.tsx'),
      'utf-8'
    );
    expect(canvasCode).toContain('tintMarker(edge.markerEnd');

    const tokensCss = fs.readFileSync(
      path.resolve(__dirname, '../src/features/theme/tokens.css'),
      'utf-8'
    );
    expect(tokensCss).toContain('--xy-edge-stroke-selected: var(--fs-selection-ring)');

    // Store 节点平移保角与两头重连校验
    useFlowStore.setState({
      nodes: [
        {
          id: 'n1',
          type: 'process',
          position: { x: 0, y: 100 },
          width: 120,
          height: 60,
          data: { label: 'A', type: 'process' },
        },
        {
          id: 'n2',
          type: 'process',
          position: { x: 300, y: 200 },
          width: 120,
          height: 60,
          data: { label: 'B', type: 'process' },
        },
        {
          id: 'n3',
          type: 'process',
          position: { x: 300, y: 0 },
          width: 120,
          height: 60,
          data: { label: 'C', type: 'process' },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'n1',
          target: 'n2',
          sourceHandle: 'right',
          targetHandle: 'left',
          type: 'orthogonal',
          data: {
            waypoints: [
              { x: 210, y: 130 },
              { x: 210, y: 230 },
            ],
          },
        },
      ],
      historyPast: [],
      selectedEdgeId: 'e1',
    });

    // 纯测量变更不得改写连线 waypoints
    useFlowStore.getState().onNodesChange([
      { id: 'n1', type: 'dimensions', dimensions: { width: 120, height: 60 } } as any,
    ]);
    expect(useFlowStore.getState().edges[0].data?.waypoints).toEqual([
      { x: 210, y: 130 },
      { x: 210, y: 230 },
    ]);

    // 拖拽 n1 下移 20px、右移 10px：折线仅首段跟进 y，保持 x=210 结构不变
    useFlowStore.getState().onNodesChange([
      { id: 'n1', type: 'position', position: { x: 10, y: 120 }, dragging: false } as any,
    ]);
    expect(useFlowStore.getState().edges[0].data?.waypoints).toEqual([
      { x: 210, y: 150 },
      { x: 210, y: 230 },
    ]);

    // 两端重连：同一连接点重复触发不入历史栈，更换起点/终点均正常生效并保持选中
    const historyBeforeSame = useFlowStore.getState().historyPast.length;
    useFlowStore.getState().reconnectEdge(useFlowStore.getState().edges[0], {
      source: 'n1',
      target: 'n2',
      sourceHandle: 'right',
      targetHandle: 'left',
    });
    expect(useFlowStore.getState().historyPast.length).toBe(historyBeforeSame);

    useFlowStore.getState().reconnectEdge(useFlowStore.getState().edges[0], {
      source: 'n3',
      target: 'n2',
      sourceHandle: 'bottom',
      targetHandle: 'top',
    });
    expect(useFlowStore.getState().edges[0].source).toBe('n3');
    expect(useFlowStore.getState().edges[0].sourceHandle).toBe('bottom');
    expect(useFlowStore.getState().edges[0].targetHandle).toBe('top');
    expect(useFlowStore.getState().edges[0].selected).toBe(true);
    expect(useFlowStore.getState().selectedEdgeId).toBe('e1');
  });

  it('Hover 聚焦区分聚焦/淡化且保护父容器，流向圆点匀速每 0.5s 发射且源码关闭内置重联抢占', () => {
    const cache = new Map<string, DisplayNodeCacheEntry>();
    const pool = {
      id: 'pool-1',
      type: 'pool' as const,
      position: { x: 0, y: 0 },
      zIndex: POOL_Z_INDEX,
      data: { label: '泳池', type: 'pool' as const },
    };
    const lane = {
      id: 'lane-1',
      type: 'lane' as const,
      parentId: 'pool-1',
      position: { x: 0, y: 40 },
      zIndex: LANE_Z_INDEX,
      data: { label: '泳道', type: 'lane' as const },
    };
    const n1 = {
      id: 'n1',
      type: 'process' as const,
      parentId: 'lane-1',
      position: { x: 50, y: 60 },
      data: { label: 'N1', type: 'process' as const },
    };
    const n2 = {
      id: 'n2',
      type: 'process' as const,
      position: { x: 260, y: 60 },
      data: { label: 'N2', type: 'process' as const },
    };

    const baseNodes = [pool, lane, n1, n2];
    expect(
      deriveDisplayNodes(
        baseNodes,
        { hasSpotlightDim: false, spotlightResult: null, isReadOnly: false, hoverFocusNodeIds: null },
        cache
      )
    ).toBe(baseNodes);

    const hovered = deriveDisplayNodes(
      baseNodes,
      { hasSpotlightDim: false, spotlightResult: null, isReadOnly: false, hoverFocusNodeIds: new Set(['n1']) },
      cache
    );
    expect(hovered[0].className ?? '').not.toContain('fs-node-hover-dim');
    expect(hovered[1].className ?? '').not.toContain('fs-node-hover-dim');
    expect(hovered[2].className).toContain('fs-node-hover-focus');
    expect(hovered[3].className).toContain('fs-node-hover-dim');

    const spotlightWins = deriveDisplayNodes(
      baseNodes,
      {
        hasSpotlightDim: true,
        spotlightResult: { nodeIds: new Set(['n2']), edgeIds: new Set<string>(), laneIds: new Set<string>() },
        isReadOnly: false,
        hoverFocusNodeIds: new Set(['n1']),
      },
      cache
    );
    expect(spotlightWins[2].className ?? '').not.toContain('fs-node-hover-focus');
    expect(spotlightWins[2].style?.opacity).toBe(0.15);

    const shortSpec = computeFlowDotAnimationSpec(40);
    expect(shortSpec.dotCount).toBe(1);
    expect(shortSpec.cycleDur).toBe(0.5);
    expect(shortSpec.step).toBe(0.5);

    const medSpec = computeFlowDotAnimationSpec(240);
    expect(medSpec.travelDur).toBeCloseTo(1.5, 4);
    expect(medSpec.dotCount).toBe(3);
    expect(medSpec.cycleDur).toBe(1.5);
    expect(medSpec.step).toBe(0.5);

    const longSpec = computeFlowDotAnimationSpec(320);
    expect(longSpec.travelDur).toBeCloseTo(2.0, 4);
    expect(longSpec.dotCount).toBe(4);
    expect(longSpec.cycleDur).toBeGreaterThanOrEqual(longSpec.travelDur);

    const ultraLongSpec = computeFlowDotAnimationSpec(4800);
    expect(ultraLongSpec.dotCount).toBe(20);
    expect(ultraLongSpec.cycleDur).toBeCloseTo(30, 4);

    const canvasCode = fs.readFileSync(
      path.resolve(__dirname, '../src/features/canvas/flow-canvas.tsx'),
      'utf-8'
    );
    expect(canvasCode).toContain('edgesReconnectable={false}');
    expect(canvasCode).toContain('onNodeMouseEnter={handleNodeMouseEnter}');
    expect(canvasCode).toContain('onNodeMouseLeave={handleNodeMouseLeave}');

    const edgeCode = fs.readFileSync(
      path.resolve(__dirname, '../src/features/canvas/custom-edges/orthogonal-edge.tsx'),
      'utf-8'
    );
    expect(edgeCode).toContain('<animateMotion');
    expect(edgeCode).toContain('handleCornerPointerDown');
    expect(edgeCode).toContain('draggableSegments');
  });
});

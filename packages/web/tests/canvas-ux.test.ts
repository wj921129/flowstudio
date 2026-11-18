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
  type DisplayNodeCacheEntry,
} from '../src/features/canvas/utils/display-nodes';
import { resolveNodeSemanticRole } from '../src/features/canvas/custom-nodes/base-node-wrapper';
import {
  getPointAtPolylineRatio,
  projectPointOntoPolyline,
} from '../src/features/canvas/custom-edges/waypoint-path-utils';
import {
  parseBorderAnchorHandle,
  formatBorderAnchorHandle,
  projectPointToNodeBorder,
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
    expect(tokensCss).toContain("stroke='%230f172a'");
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
    expect(tokensCss).toContain("fill='%23ffffff' stroke='%230f172a'");
    expect(tokensCss).toContain("fill='%230f172a' stroke='%23ffffff'");
  });

  it('6 套元素风格均为开始与结束节点提供独立且可区分的主题配色', () => {
    for (const theme of THEME_PRESETS) {
      const startStyle = resolveNodeStyle('start-end', theme, 'start');
      const processStyle = resolveNodeStyle('process', theme, 'process');
      const endStyle = resolveNodeStyle('start-end', theme, 'end');
      expect(startStyle.fillColor).toBeTruthy();
      expect(endStyle.fillColor).toBeTruthy();
      expect(startStyle.fillColor).not.toBe(endStyle.fillColor);
      expect(startStyle.borderColor).not.toBe(processStyle.borderColor);
      expect(endStyle.borderColor).not.toBe(processStyle.borderColor);
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
});

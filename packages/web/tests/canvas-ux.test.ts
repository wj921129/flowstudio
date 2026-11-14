import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { useFlowStore } from '../src/stores/flow-store';
import { resolveNodeSemanticRole } from '../src/features/canvas/custom-nodes/base-node-wrapper';
import {
  getPointAtPolylineRatio,
  projectPointOntoPolyline,
} from '../src/features/canvas/custom-edges/waypoint-path-utils';

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
  });
});

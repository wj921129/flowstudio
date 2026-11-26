import { describe, it, expect, beforeEach } from 'vitest';
import type { FlowNode, FlowEdge } from '@flowstudio/shared';
import {
  NODE_SPACING_MAX_GAP,
  NODE_SPACING_MAX_SCALE,
  NODE_SPACING_MIN_GAP,
  NODE_SPACING_MIN_SCALE,
  applyDiagramSpacingScale,
  clampSpacingScale,
  scaleAxisIntervals,
} from '../src/features/canvas/utils/node-spacing.js';
import { useFlowStore } from '../src/stores/flow-store.js';

describe('node-spacing: 有界元素间隙缩放与Store联动', () => {
  beforeEach(() => {
    useFlowStore.getState().resetDiagramState();
  });

  it('clampSpacingScale 与 scaleAxisIntervals 保持对齐并受上下限保护', () => {
    expect(clampSpacingScale(0.1)).toBe(NODE_SPACING_MIN_SCALE);
    expect(clampSpacingScale(99)).toBe(NODE_SPACING_MAX_SCALE);
    expect(clampSpacingScale(Number.NaN)).toBe(1);

    const alignedCol = scaleAxisIntervals(
      [
        { id: 'a', start: 100, size: 120 },
        { id: 'b', start: 100, size: 120 },
      ],
      2.0
    );
    expect(alignedCol.get('a')).toBe(100);
    expect(alignedCol.get('b')).toBe(100);

    const tightItems = [
      { id: 'n1', start: 0, size: 100 },
      { id: 'n2', start: 120, size: 100 },
    ];
    const shrunk = scaleAxisIntervals(tightItems, 0.5);
    const shrunkGap = shrunk.get('n2')! - (shrunk.get('n1')! + 100);
    expect(shrunkGap).toBeGreaterThanOrEqual(NODE_SPACING_MIN_GAP);

    const wideItems = [
      { id: 'n1', start: 0, size: 100 },
      { id: 'n2', start: 300, size: 100 },
    ];
    const expanded = scaleAxisIntervals(wideItems, 2.5);
    const expandedGap = expanded.get('n2')! - (expanded.get('n1')! + 100);
    expect(expandedGap).toBe(NODE_SPACING_MAX_GAP);
  });

  it('applyDiagramSpacingScale 支持泳道/分组容器自适应扩缩且不移动锁定节点', () => {
    const nodes: FlowNode[] = [
      {
        id: 'pool-1',
        type: 'pool',
        position: { x: 0, y: 0 },
        width: 410,
        height: 240,
        data: { label: '泳池', type: 'pool', orientation: 'horizontal', headerSize: 40 },
      },
      {
        id: 'lane-1',
        type: 'lane',
        parentId: 'pool-1',
        position: { x: 0, y: 40 },
        width: 410,
        height: 200,
        data: { label: '泳道', type: 'lane' },
      },
      {
        id: 'a',
        type: 'process',
        parentId: 'lane-1',
        position: { x: 64, y: 60 },
        width: 120,
        height: 60,
        data: { label: 'A', type: 'process' },
      },
      {
        id: 'b',
        type: 'process',
        parentId: 'lane-1',
        position: { x: 244, y: 60 },
        width: 120,
        height: 60,
        data: { label: 'B', type: 'process' },
      },
      {
        id: 'locked-free',
        type: 'process',
        position: { x: 700, y: 100 },
        width: 120,
        height: 60,
        data: { label: 'Locked', type: 'process', lockMode: 'position' },
      },
    ];

    const { nodes: scaled, clampedScale } = applyDiagramSpacingScale(nodes, 2.0);
    expect(clampedScale).toBe(2);

    const a = scaled.find((n) => n.id === 'a')!;
    const b = scaled.find((n) => n.id === 'b')!;
    const pool = scaled.find((n) => n.id === 'pool-1')!;
    const locked = scaled.find((n) => n.id === 'locked-free')!;

    expect(b.position.x - (a.position.x + 120)).toBe(120);
    expect(a.position.y).toBe(b.position.y);
    expect(pool.width!).toBeGreaterThan(410);
    expect(locked.position).toEqual({ x: 700, y: 100 });
  });

  it('useFlowStore 预览/提交支持单步撤销且连续调节基于同一基准不无限扩张', () => {
    const initialNodes: FlowNode[] = [
      { id: 'n1', type: 'process', position: { x: 0, y: 0 }, width: 100, height: 60, data: { label: '1', type: 'process' } },
      { id: 'n2', type: 'process', position: { x: 140, y: 0 }, width: 100, height: 60, data: { label: '2', type: 'process' } },
    ];
    const initialEdges: FlowEdge[] = [
      { id: 'e1', source: 'n1', target: 'n2', type: 'orthogonal' },
    ];

    useFlowStore.getState().setDiagram(initialNodes, initialEdges);

    useFlowStore.getState().previewDiagramSpacing(1.5);
    useFlowStore.getState().previewDiagramSpacing(2.0);
    expect(useFlowStore.getState().historyPast.length).toBe(0);
    useFlowStore.getState().commitDiagramSpacing();
    expect(useFlowStore.getState().historyPast.length).toBe(1);

    const gapAt2 =
      useFlowStore.getState().nodes[1].position.x -
      (useFlowStore.getState().nodes[0].position.x + 100);
    expect(gapAt2).toBe(80);

    useFlowStore.getState().previewDiagramSpacing(99);
    useFlowStore.getState().commitDiagramSpacing();
    expect(useFlowStore.getState().spacingScale).toBe(NODE_SPACING_MAX_SCALE);
    expect(useFlowStore.getState().historyPast.length).toBe(2);

    const gapAtMax =
      useFlowStore.getState().nodes[1].position.x -
      (useFlowStore.getState().nodes[0].position.x + 100);
    expect(gapAtMax).toBe(100);

    useFlowStore.getState().undo();
    const gapAfterUndo1 =
      useFlowStore.getState().nodes[1].position.x -
      (useFlowStore.getState().nodes[0].position.x + 100);
    expect(gapAfterUndo1).toBe(80);

    useFlowStore.getState().undo();
    const gapAfterUndo2 =
      useFlowStore.getState().nodes[1].position.x -
      (useFlowStore.getState().nodes[0].position.x + 100);
    expect(gapAfterUndo2).toBe(40);
  });
});

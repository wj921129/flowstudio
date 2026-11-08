/**
 * flow-store 拖拽落点改写回归：验证拖动帧与松手帧都执行智能对齐，且 Alt 关闭时保留自由落点
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { FlowNode } from '@flowstudio/shared';
import { useFlowStore } from '../src/stores/flow-store.js';

function makeNode(id: string, x: number, y: number, width: number, height: number): FlowNode {
  return {
    id,
    type: 'process',
    position: { x, y },
    width,
    height,
    data: { label: id, type: 'process' },
  };
}

const baseNodes: FlowNode[] = [
  makeNode('db', 100, 260, 120, 100),
  makeNode('proc', 300, 300, 160, 80),
];

function positionOf(id: string) {
  return useFlowStore.getState().nodes.find((n) => n.id === id)!.position;
}

describe('flow-store: 拖拽智能对齐落点改写', () => {
  beforeEach(() => {
    useFlowStore.setState({
      nodes: baseNodes.map((n) => ({ ...n, position: { ...n.position } })),
      edges: [],
      historyPast: [],
      historyFuture: [],
      isInteracting: false,
      alignmentGuides: [],
      viewportZoom: 1,
      alignmentSnapEnabled: true,
    });
  });

  it('拖动帧把落点吸附到目标左边线并产出参考线', () => {
    useFlowStore.getState().onNodesChange([
      { id: 'proc', type: 'position', position: { x: 104, y: 300 }, dragging: true } as never,
    ]);

    expect(positionOf('proc')).toEqual({ x: 100, y: 300 });
    expect(useFlowStore.getState().alignmentGuides).toEqual([
      { axis: 'vertical', position: 100, start: 260, end: 380 },
    ]);
  });

  it('松手帧同样执行吸附，节点不会在释放瞬间从对齐线上弹开', () => {
    useFlowStore.getState().onNodesChange([
      { id: 'proc', type: 'position', position: { x: 104, y: 300 }, dragging: true } as never,
    ]);
    useFlowStore.getState().onNodesChange([
      { id: 'proc', type: 'position', position: { x: 103, y: 300 }, dragging: false } as never,
    ]);

    expect(positionOf('proc')).toEqual({ x: 100, y: 300 });
    expect(useFlowStore.getState().alignmentGuides).toEqual([]);
  });

  it('超出感应阈值时保留自由落点', () => {
    useFlowStore.getState().onNodesChange([
      { id: 'proc', type: 'position', position: { x: 120, y: 300 }, dragging: true } as never,
    ]);

    expect(positionOf('proc')).toEqual({ x: 120, y: 300 });
    expect(useFlowStore.getState().alignmentGuides).toEqual([]);
  });

  it('关闭吸附开关后落点完全自由', () => {
    useFlowStore.getState().setAlignmentSnapEnabled(false);

    useFlowStore.getState().onNodesChange([
      { id: 'proc', type: 'position', position: { x: 103.5, y: 300.25 }, dragging: true } as never,
    ]);

    expect(positionOf('proc')).toEqual({ x: 103.5, y: 300.25 });
  });

  it('多选拖拽整组获得同一吸附位移', () => {
    useFlowStore.setState({
      nodes: [
        ...baseNodes,
        makeNode('extra', 400, 100, 160, 80),
      ],
    });

    useFlowStore.getState().onNodesChange([
      { id: 'proc', type: 'position', position: { x: 104, y: 300 }, dragging: true } as never,
      { id: 'extra', type: 'position', position: { x: 104, y: 120 }, dragging: true } as never,
    ]);

    // 并集包围盒左边线吸附到 db 左边线，两个节点同步位移 -4
    expect(positionOf('proc')).toEqual({ x: 100, y: 300 });
    expect(positionOf('extra')).toEqual({ x: 100, y: 120 });
  });
});

import { describe, it, expect } from 'vitest';
import { handleNodeDragNesting, getAbsoluteWorldPosition } from '../src/features/canvas/utils/lane-nesting-manager.js';
import type { FlowNode } from '@flowstudio/shared';

describe('lane-nesting-manager: Swimlane Drag-in / Drag-out & Auto-expand', () => {
  const initialNodes: FlowNode[] = [
    {
      id: 'pool-1',
      type: 'pool',
      position: { x: 100, y: 100 },
      width: 800,
      height: 400,
      data: {
        label: '业务泳道池',
        type: 'pool',
        orientation: 'horizontal',
        laneOrder: ['lane-1'],
        headerSize: 40,
      },
    },
    {
      id: 'lane-1',
      type: 'lane',
      parentId: 'pool-1',
      position: { x: 0, y: 40 },
      width: 800,
      height: 200,
      data: { label: '审批泳道', type: 'lane' },
    },
    {
      id: 'node-outside',
      type: 'process',
      position: { x: 250, y: 180 }, // 全局落点落在 lane-1 全局范围 [100, 140, 900, 340]
      width: 160,
      height: 80,
      data: { label: '审核订单', type: 'process' },
    },
  ];

  it('correctly calculates absolute world position for nested and root nodes', () => {
    // 根节点
    expect(getAbsoluteWorldPosition('pool-1', initialNodes)).toEqual({ x: 100, y: 100 });
    // 嵌套节点：pool(100, 100) + lane(0, 40) = (100, 140)
    expect(getAbsoluteWorldPosition('lane-1', initialNodes)).toEqual({ x: 100, y: 140 });
    // 独立节点
    expect(getAbsoluteWorldPosition('node-outside', initialNodes)).toEqual({ x: 250, y: 180 });
  });

  it('drags a floating node into a swimlane, updates parentId and translates coordinates', () => {
    const { updated, nextNodes } = handleNodeDragNesting('node-outside', initialNodes);
    expect(updated).toBe(true);

    const dragged = nextNodes.find((n) => n.id === 'node-outside')!;
    expect(dragged.parentId).toBe('lane-1');
    expect(dragged.extent).toBeUndefined();

    // 相对坐标：绝对坐标 (250, 180) - Lane绝对坐标 (100, 140) = (150, 40)
    expect(dragged.position).toEqual({ x: 150, y: 40 });
  });

  it('drags an existing nested node out of a swimlane, clears parentId and restores absolute coordinates', () => {
    // 先构造一个在泳道内的节点
    const nestedNodes: FlowNode[] = [
      initialNodes[0],
      initialNodes[1],
      {
        id: 'node-in-lane',
        type: 'process',
        parentId: 'lane-1',
        extent: 'parent',
        position: { x: 10, y: 800 }, // 此时局部坐标非常大，绝对坐标落在池与泳道外部
        width: 160,
        height: 80,
        data: { label: '已移出泳道的步骤', type: 'process' },
      },
    ];

    const { updated, nextNodes } = handleNodeDragNesting('node-in-lane', nestedNodes);
    expect(updated).toBe(true);

    const draggedOut = nextNodes.find((n) => n.id === 'node-in-lane')!;
    expect(draggedOut.parentId).toBeUndefined();
    expect(draggedOut.extent).toBeUndefined();
    // 恢复为绝对坐标：lane(100, 140) + (10, 800) = (110, 940)
    expect(draggedOut.position).toEqual({ x: 110, y: 940 });
  });

  it('automatically expands lane and pool dimensions when a child node touches outer boundary', () => {
    // 节点在泳道内靠右下放置：x: 750 (加上 width 160 = 910, 超过原 lane 宽 800)
    const crowdedNodes: FlowNode[] = [
      initialNodes[0],
      initialNodes[1],
      {
        id: 'node-crowded',
        type: 'process',
        parentId: 'lane-1',
        extent: 'parent',
        position: { x: 750, y: 50 },
        width: 160,
        height: 80,
        data: { label: '边界扩张节点', type: 'process' },
      },
    ];

    const { updated, nextNodes } = handleNodeDragNesting('node-crowded', crowdedNodes);
    expect(updated).toBe(true);

    const lane = nextNodes.find((n) => n.id === 'lane-1')!;
    const pool = nextNodes.find((n) => n.id === 'pool-1')!;

    // 750 + 160 + padding 40 = 950
    expect(lane.width).toBeGreaterThanOrEqual(950);
    expect(pool.width).toBeGreaterThanOrEqual(950);
  });
});

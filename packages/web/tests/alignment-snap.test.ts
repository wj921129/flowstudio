import { describe, it, expect } from 'vitest';
import type { FlowNode, FlowNodeData, FlowNodeType } from '@flowstudio/shared';
import {
  computeAlignmentSnap,
  computeDragAlignment,
  resolveSnapThreshold,
  type AlignBox,
} from '../src/features/canvas/utils/alignment-snap.js';

function makeBox(x: number, y: number, width: number, height: number): AlignBox {
  return { x, y, width, height };
}

function makeNode(
  id: string,
  position: { x: number; y: number },
  size: { width: number; height: number },
  type: FlowNodeType = 'process',
  extra: Partial<FlowNode> = {}
): FlowNode {
  const data: FlowNodeData = { label: id, type };
  return {
    id,
    type,
    position,
    width: size.width,
    height: size.height,
    data,
    ...extra,
  };
}

describe('alignment-snap: 自由拖拽智能对齐', () => {
  describe('resolveSnapThreshold', () => {
    it('按缩放比例反算感应半径并夹紧到上下限', () => {
      expect(resolveSnapThreshold(1)).toBe(5);
      expect(resolveSnapThreshold(2)).toBe(4);
      expect(resolveSnapThreshold(0.1)).toBe(10);
      expect(resolveSnapThreshold(8)).toBe(4);
      expect(resolveSnapThreshold(Number.NaN)).toBe(5);
    });
  });

  describe('computeAlignmentSnap', () => {
    it('左边线在阈值内吸附，参考线跨越两侧包围盒', () => {
      const dragged = makeBox(0, 0, 160, 80);
      const target = makeBox(3, 10, 160, 80);

      const result = computeAlignmentSnap(dragged, [target], 5);

      expect(result.offset).toEqual({ x: 3, y: 0 });
      expect(result.guides).toEqual([{ axis: 'vertical', position: 3, start: 0, end: 90 }]);
    });

    it('超出感应阈值时不产生吸附与参考线', () => {
      const result = computeAlignmentSnap(makeBox(0, 0, 160, 80), [makeBox(20, 10, 160, 80)], 5);

      expect(result.offset).toEqual({ x: 0, y: 0 });
      expect(result.guides).toHaveLength(0);
    });

    it('多个目标只保留位移最小的一条对齐线', () => {
      const dragged = makeBox(0, 0, 160, 80);
      const targets = [makeBox(6, 10, 160, 80), makeBox(2, 10, 160, 80)];

      const result = computeAlignmentSnap(dragged, targets, 5);

      expect(result.offset.x).toBe(2);
      expect(result.guides).toHaveLength(1);
      expect(result.guides[0].position).toBe(2);
    });

    it('边线无候选时退化为中心线对齐', () => {
      const dragged = makeBox(0, 0, 100, 100);
      const target = makeBox(-15, 20, 130, 40);

      const result = computeAlignmentSnap(dragged, [target], 5);

      expect(result.offset).toEqual({ x: 0, y: 0 });
      expect(result.guides).toEqual([{ axis: 'vertical', position: 50, start: 0, end: 100 }]);
    });

    it('纵向非重叠但同列图元支持极窄吸附与参考线，助力垂直直线走线', () => {
      const dragged = makeBox(0, 0, 100, 100);
      const target = makeBox(2, 500, 100, 100);

      const result = computeAlignmentSnap(dragged, [target], 5);

      expect(result.offset).toEqual({ x: 2, y: 0 });
      expect(result.guides).toEqual([{ axis: 'vertical', position: 2, start: 0, end: 600 }]);
    });

    it('横向非重叠但同行图元支持极窄吸附与参考线，助力水平直线走线', () => {
      const dragged = makeBox(0, 0, 100, 100);
      const target = makeBox(400, 2, 100, 100);

      const result = computeAlignmentSnap(dragged, [target], 5);

      expect(result.offset).toEqual({ x: 0, y: 2 });
      expect(result.guides).toEqual([{ axis: 'horizontal', position: 2, start: 0, end: 500 }]);
    });

    it('距离过远（> 1500px）的非相关图元不产生吸附，避免大画布远端杂散干扰', () => {
      const dragged = makeBox(0, 0, 100, 100);
      const distantTarget = makeBox(2, 3000, 100, 100);

      const result = computeAlignmentSnap(dragged, [distantTarget], 5);

      expect(result.offset).toEqual({ x: 0, y: 0 });
      expect(result.guides).toHaveLength(0);
    });

    it('支持中心点与连线锚点 Handle 关键点吸附（不同尺寸图元中心对齐）', () => {
      // dragged: width 160 (center at 80)
      // target: width 100 (center at 50, x at 32 -> center at 82, delta = 2)
      const dragged = makeBox(0, 0, 160, 80);
      const target = makeBox(32, 200, 100, 80);

      const result = computeAlignmentSnap(dragged, [target], 5);

      expect(result.offset).toEqual({ x: 2, y: 0 });
      expect(result.guides).toEqual([{ axis: 'vertical', position: 82, start: 0, end: 280 }]);
    });

    it('支持四角关键点对齐吸附（左上、右上、左下、右下）', () => {
      // dragged: (0, 0, 100, 100)
      // target: (103, 102, 100, 100) -> 左右相邻吸附 (delta 3), 上下相邻吸附 (delta 2)
      const dragged = makeBox(0, 0, 100, 100);
      const target = makeBox(103, 102, 100, 100);

      const result = computeAlignmentSnap(dragged, [target], 5);

      expect(result.offset).toEqual({ x: 3, y: 2 });
    });

    it('横竖两轴同时命中时输出两条参考线', () => {
      const dragged = makeBox(0, 0, 100, 100);
      const target = makeBox(3, -2, 100, 100);

      const result = computeAlignmentSnap(dragged, [target], 5);

      expect(result.offset).toEqual({ x: 3, y: -2 });
      expect(result.guides).toEqual([
        { axis: 'vertical', position: 3, start: -2, end: 100 },
        { axis: 'horizontal', position: -2, start: 3, end: 103 },
      ]);
    });
  });

  describe('computeDragAlignment', () => {
    it('单节点落点按世界坐标吸附后回写节点自身坐标', () => {
      const nodes: FlowNode[] = [
        makeNode('drag', { x: 0, y: 0 }, { width: 160, height: 80 }),
        makeNode('other', { x: 3, y: 200 }, { width: 160, height: 80 }),
      ];

      const draggedPositions = new Map([['drag', { x: 5, y: 210 }]]);
      const { positions, guides } = computeDragAlignment(nodes, draggedPositions, 8);

      expect(positions.get('drag')).toEqual({ x: 3, y: 210 });
      expect(guides).toEqual([{ axis: 'vertical', position: 3, start: 200, end: 290 }]);
    });

    it('多选拖拽以并集包围盒择优，整组获得同一位移', () => {
      const nodes: FlowNode[] = [
        makeNode('a', { x: 0, y: 0 }, { width: 100, height: 50 }),
        makeNode('b', { x: 0, y: 0 }, { width: 100, height: 50 }),
        makeNode('other', { x: 104, y: 110 }, { width: 200, height: 40 }),
      ];

      const draggedPositions = new Map([
        ['a', { x: 100, y: 100 }],
        ['b', { x: 100, y: 170 }],
      ]);
      const { positions, guides } = computeDragAlignment(nodes, draggedPositions, 8);

      expect(positions.get('a')).toEqual({ x: 104, y: 100 });
      expect(positions.get('b')).toEqual({ x: 104, y: 170 });
      expect(guides).toEqual([{ axis: 'vertical', position: 104, start: 100, end: 220 }]);
    });

    it('嵌套节点的吸附量作用于相对父容器的本地坐标', () => {
      const nodes: FlowNode[] = [
        makeNode('group', { x: 50, y: 50 }, { width: 400, height: 300 }, 'group'),
        makeNode('child', { x: 10, y: 10 }, { width: 160, height: 80 }, 'process', {
          parentId: 'group',
        }),
        makeNode('other', { x: 63, y: 100 }, { width: 100, height: 100 }),
      ];

      // child 世界落点 (60, 110)：左边线距 other 左边线 3，中心线 y 与 other 中心线重合
      const draggedPositions = new Map([['child', { x: 10, y: 60 }]]);
      const { positions, guides } = computeDragAlignment(nodes, draggedPositions, 8);

      expect(positions.get('child')).toEqual({ x: 13, y: 60 });
      expect(guides).toEqual([
        { axis: 'vertical', position: 63, start: 100, end: 200 },
        { axis: 'horizontal', position: 150, start: 63, end: 223 },
      ]);
    });

    it('容器类图元不作为对齐目标，即便其中心线更靠近', () => {
      const nodes: FlowNode[] = [
        makeNode('pool', { x: 0, y: 0 }, { width: 740, height: 480 }, 'pool'),
        makeNode('drag', { x: 0, y: 0 }, { width: 160, height: 80 }),
        makeNode('other', { x: 292, y: 310 }, { width: 160, height: 80 }),
      ];

      // 落点 285：池中心线 370 距其中心 365 仅 5，普通图元左边线 292 距其左边 7
      const draggedPositions = new Map([['drag', { x: 285, y: 300 }]]);
      const { positions, guides } = computeDragAlignment(nodes, draggedPositions, 8);

      // 若容器参与对齐，位移 5 会以更短距离胜出；实际应吸附到普通图元的位移 7
      expect(positions.get('drag')).toEqual({ x: 292, y: 300 });
      expect(guides).toEqual([{ axis: 'vertical', position: 292, start: 300, end: 390 }]);
    });

    it('随被拖容器一起移动的子孙节点不作为静态目标', () => {
      const nodes: FlowNode[] = [
        makeNode('group', { x: 0, y: 0 }, { width: 400, height: 300 }, 'group'),
        makeNode('child', { x: 10, y: 10 }, { width: 100, height: 50 }, 'process', {
          parentId: 'group',
        }),
      ];

      const draggedPositions = new Map([['group', { x: 6, y: 0 }]]);
      const { positions, guides } = computeDragAlignment(nodes, draggedPositions, 8);

      expect(positions.get('group')).toEqual({ x: 6, y: 0 });
      expect(guides).toHaveLength(0);
    });

    it('无拖拽落点时原样返回', () => {
      const nodes: FlowNode[] = [makeNode('a', { x: 0, y: 0 }, { width: 100, height: 50 })];
      const draggedPositions = new Map<string, { x: number; y: number }>();

      const result = computeDragAlignment(nodes, draggedPositions, 8);

      expect(result.positions).toBe(draggedPositions);
      expect(result.guides).toEqual([]);
    });
  });
});

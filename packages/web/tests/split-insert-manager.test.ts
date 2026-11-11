import { describe, it, expect } from 'vitest';
import type { FlowNode, FlowEdge } from '@flowstudio/shared';
import {
  pointToSegmentDistance,
  findEdgeAtPosition,
  splitEdgeAndInsertNode,
  healOnDelete,
} from '../src/features/canvas/utils/split-insert-manager.js';

describe('split-insert-manager: 连线悬浮断键智能串接与局部推挤', () => {
  describe('pointToSegmentDistance', () => {
    it('精确计算点到线段垂足距离', () => {
      const a = { x: 0, y: 100 };
      const b = { x: 200, y: 100 };
      const p = { x: 100, y: 110 };

      const { distance, projection } = pointToSegmentDistance(p, a, b);
      expect(distance).toBe(10);
      expect(projection).toEqual({ x: 100, y: 100 });
    });

    it('超出线段端点时落于端点', () => {
      const a = { x: 0, y: 100 };
      const b = { x: 200, y: 100 };
      const p = { x: 250, y: 100 };

      const { distance, projection } = pointToSegmentDistance(p, a, b);
      expect(distance).toBe(50);
      expect(projection).toEqual({ x: 200, y: 100 });
    });
  });

  describe('findEdgeAtPosition: 悬停连线探测 (<16px)', () => {
    const nodes: FlowNode[] = [
      {
        id: 'node-a',
        type: 'process',
        position: { x: 100, y: 100 },
        width: 100,
        height: 60,
        data: { label: 'Node A', type: 'process' },
      },
      {
        id: 'node-b',
        type: 'process',
        position: { x: 400, y: 100 },
        width: 100,
        height: 60,
        data: { label: 'Node B', type: 'process' },
      },
    ];

    const edges: FlowEdge[] = [
      {
        id: 'edge-ab',
        source: 'node-a',
        target: 'node-b',
        data: { label: '流转' },
      },
    ];

    it('光标距离连线 < 16px 时命中目标连线', () => {
      // 连线在 y=130 (中间折线)，我们在 (250, 138) 距离 8px
      const hit = findEdgeAtPosition(edges, nodes, { x: 250, y: 138 }, 16);
      expect(hit).not.toBeNull();
      expect(hit?.edge.id).toBe('edge-ab');
      expect(hit?.distance).toBeLessThan(16);
    });

    it('光标距离连线 > 16px 时返回 null', () => {
      const hit = findEdgeAtPosition(edges, nodes, { x: 250, y: 180 }, 16);
      expect(hit).toBeNull();
    });
  });

  describe('splitEdgeAndInsertNode: 断键插入与下游局部推挤', () => {
    it('自动拆分原连线为两段并继承分支标签，且下游节点顺推', () => {
      const nodeA: FlowNode = {
        id: 'A',
        type: 'decision',
        position: { x: 100, y: 100 },
        width: 120,
        height: 80,
        data: { label: '判断', type: 'decision' },
      };
      const nodeB: FlowNode = {
        id: 'B',
        type: 'process',
        position: { x: 300, y: 100 },
        width: 120,
        height: 80,
        data: { label: '处理B', type: 'process' },
      };
      const nodeC: FlowNode = {
        id: 'C',
        type: 'process',
        position: { x: 500, y: 100 },
        width: 120,
        height: 80,
        data: { label: '处理C', type: 'process' },
      };
      const upstreamOther: FlowNode = {
        id: 'Other',
        type: 'process',
        position: { x: 100, y: 300 },
        width: 120,
        height: 80,
        data: { label: '旁路节点', type: 'process' },
      };

      const edges: FlowEdge[] = [
        {
          id: 'edge-AB',
          source: 'A',
          target: 'B',
          data: { label: '是' },
        },
        {
          id: 'edge-BC',
          source: 'B',
          target: 'C',
        },
        {
          id: 'edge-AOther',
          source: 'A',
          target: 'Other',
          data: { label: '否' },
        },
      ];

      // 在 A 与 B 之间插入新节点 New
      const newNode: FlowNode = {
        id: 'New',
        type: 'process',
        position: { x: 240, y: 100 },
        width: 100,
        height: 80,
        data: { label: '新插入步骤', type: 'process' },
      };

      const result = splitEdgeAndInsertNode({
        nodes: [nodeA, nodeB, nodeC, upstreamOther],
        edges,
        targetEdge: edges[0],
        newNode,
        safetyGap: 60,
      });

      // 1. 原连线 edge-AB 被拆分
      expect(result.nextEdges.find((e) => e.id === 'edge-AB')).toBeUndefined();

      // 2. A -> New 继承了原连线的 "是" 标签
      const inEdge = result.nextEdges.find((e) => e.source === 'A' && e.target === 'New');
      expect(inEdge).toBeDefined();
      expect(inEdge?.data?.label).toBe('是');

      // 3. New -> B 建立
      const outEdge = result.nextEdges.find((e) => e.source === 'New' && e.target === 'B');
      expect(outEdge).toBeDefined();

      // 4. 下游节点 B 与 C 被顺推
      expect(result.pushedNodeIds).toContain('B');
      expect(result.pushedNodeIds).toContain('C');

      const nextB = result.nextNodes.find((n) => n.id === 'B')!;
      const nextC = result.nextNodes.find((n) => n.id === 'C')!;
      const nextOther = result.nextNodes.find((n) => n.id === 'Other')!;
      const nextA = result.nextNodes.find((n) => n.id === 'A')!;

      // B 与 C 沿 X 轴向右顺推
      expect(nextB.position.x).toBeGreaterThan(300);
      expect(nextC.position.x).toBeGreaterThan(500);

      // 上游 A 与旁路 Other 坐标 100% 保持不动
      expect(nextA.position.x).toBe(100);
      expect(nextOther.position.x).toBe(100);
      expect(nextOther.position.y).toBe(300);
    });
  });

  describe('healOnDelete: 愈合式删除', () => {
    it('单入单出节点删除时，自动将上游与下游重新直连', () => {
      const nodes: FlowNode[] = [
        { id: '1', type: 'start-end', position: { x: 0, y: 0 }, data: { label: '开始', type: 'start-end' } },
        { id: '2', type: 'process', position: { x: 200, y: 0 }, data: { label: '中间', type: 'process' } },
        { id: '3', type: 'process', position: { x: 400, y: 0 }, data: { label: '结束', type: 'process' } },
      ];

      const edges: FlowEdge[] = [
        { id: 'e1', source: '1', target: '2', data: { label: '发起' } },
        { id: 'e2', source: '2', target: '3' },
      ];

      const res = healOnDelete('2', nodes, edges);
      expect(res.canHeal).toBe(true);
      expect(res.nextNodes.find((n) => n.id === '2')).toBeUndefined();
      expect(res.nextNodes.length).toBe(2);

      // 检查直连连线
      const healed = res.nextEdges.find((e) => e.source === '1' && e.target === '3');
      expect(healed).toBeDefined();
      expect(healed?.data?.label).toBe('发起');
    });

    it('多入或多出节点不执行自动愈合', () => {
      const nodes: FlowNode[] = [
        { id: '1', type: 'start-end', position: { x: 0, y: 0 }, data: { label: '1', type: 'start-end' } },
        { id: '2', type: 'decision', position: { x: 200, y: 0 }, data: { label: '2', type: 'decision' } },
        { id: '3', type: 'process', position: { x: 400, y: -50 }, data: { label: '3', type: 'process' } },
        { id: '4', type: 'process', position: { x: 400, y: 50 }, data: { label: '4', type: 'process' } },
      ];

      const edges: FlowEdge[] = [
        { id: 'e1', source: '1', target: '2' },
        { id: 'e2', source: '2', target: '3' },
        { id: 'e3', source: '2', target: '4' },
      ];

      const res = healOnDelete('2', nodes, edges);
      expect(res.canHeal).toBe(false);
    });
  });
});

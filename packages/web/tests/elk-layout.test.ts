import { describe, it, expect } from 'vitest';
import { layoutDiagram } from '../src/features/canvas/layout/elk-layout.js';
import type { FlowNode, FlowEdge } from '@flowstudio/shared';

describe('elk-layout: Flowchart & Swimlane Auto-Layout Engine', () => {
  it('handles empty and single-node diagrams gracefully', async () => {
    const emptyResult = await layoutDiagram([], []);
    expect(emptyResult.nodes).toEqual([]);
    expect(emptyResult.edges).toEqual([]);

    const singleNode: FlowNode = {
      id: 'node-1',
      type: 'start-end',
      position: { x: 10, y: 10 },
      data: { label: '起点', type: 'start-end' },
    };
    const singleResult = await layoutDiagram([singleNode], []);
    expect(singleResult.nodes.length).toBe(1);
    expect(singleResult.nodes[0].id).toBe('node-1');
  });

  it('performs layered layout on a serial flowchart from left to right (RIGHT)', async () => {
    const nodes: FlowNode[] = [
      { id: 'start', type: 'start-end', position: { x: 0, y: 0 }, width: 120, height: 60, data: { label: '开始', type: 'start-end' } },
      { id: 'proc', type: 'process', position: { x: 0, y: 0 }, width: 160, height: 80, data: { label: '执行', type: 'process' } },
      { id: 'dec', type: 'decision', position: { x: 0, y: 0 }, width: 140, height: 100, data: { label: '判断', type: 'decision' } },
      { id: 'end', type: 'start-end', position: { x: 0, y: 0 }, width: 120, height: 60, data: { label: '结束', type: 'start-end' } },
    ];

    const edges: FlowEdge[] = [
      { id: 'e1', source: 'start', target: 'proc' },
      { id: 'e2', source: 'proc', target: 'dec' },
      { id: 'e3', source: 'dec', target: 'end' },
    ];

    const { nodes: layoutedNodes } = await layoutDiagram(nodes, edges, { direction: 'RIGHT' });

    const startNode = layoutedNodes.find((n) => n.id === 'start')!;
    const procNode = layoutedNodes.find((n) => n.id === 'proc')!;
    const decNode = layoutedNodes.find((n) => n.id === 'dec')!;
    const endNode = layoutedNodes.find((n) => n.id === 'end')!;

    // 横向排版中，连线方向上的 X 坐标递增
    expect(procNode.position.x).toBeGreaterThan(startNode.position.x);
    expect(decNode.position.x).toBeGreaterThan(procNode.position.x);
    expect(endNode.position.x).toBeGreaterThan(decNode.position.x);
  });

  it('performs swimlane-aware partitioning layout for horizontal Pool & Lanes', async () => {
    const nodes: FlowNode[] = [
      {
        id: 'pool-main',
        type: 'pool',
        position: { x: 100, y: 100 },
        data: {
          label: '用户注册流程泳道池',
          type: 'pool',
          orientation: 'horizontal',
          laneOrder: ['lane-user', 'lane-system'],
        },
      },
      {
        id: 'lane-user',
        type: 'lane',
        parentId: 'pool-main',
        position: { x: 0, y: 40 },
        data: { label: '用户端', type: 'lane' },
      },
      {
        id: 'lane-system',
        type: 'lane',
        parentId: 'pool-main',
        position: { x: 0, y: 240 },
        data: { label: '后端系统', type: 'lane' },
      },
      // 泳道 1 内的子节点
      {
        id: 'u-1',
        type: 'start-end',
        parentId: 'lane-user',
        position: { x: 10, y: 10 },
        width: 120,
        height: 60,
        data: { label: '填写手机号', type: 'start-end' },
      },
      {
        id: 'u-2',
        type: 'process',
        parentId: 'lane-user',
        position: { x: 20, y: 20 },
        width: 160,
        height: 80,
        data: { label: '输入验证码', type: 'process' },
      },
      // 泳道 2 内的子节点
      {
        id: 's-1',
        type: 'process',
        parentId: 'lane-system',
        position: { x: 30, y: 30 },
        width: 160,
        height: 80,
        data: { label: '发送短信验证码', type: 'process' },
      },
      {
        id: 's-2',
        type: 'database',
        parentId: 'lane-system',
        position: { x: 40, y: 40 },
        width: 120,
        height: 100,
        data: { label: '写入用户库', type: 'database' },
      },
    ];

    const edges: FlowEdge[] = [
      { id: 'e-1', source: 'u-1', target: 's-1' },
      { id: 'e-2', source: 's-1', target: 'u-2' },
      { id: 'e-3', source: 'u-2', target: 's-2' },
    ];

    const { nodes: layoutedNodes } = await layoutDiagram(nodes, edges);

    const pool = layoutedNodes.find((n) => n.id === 'pool-main')!;
    const laneUser = layoutedNodes.find((n) => n.id === 'lane-user')!;
    const laneSystem = layoutedNodes.find((n) => n.id === 'lane-system')!;

    // 1. Pool 尺寸根据泳道堆叠高度自动撑开
    expect(pool.width).toBeGreaterThanOrEqual(750);
    expect(pool.height).toBeGreaterThanOrEqual(400);

    // 2. 横向泳道堆叠：laneSystem 位于 laneUser 下方
    expect(laneSystem.position.y).toBeGreaterThan(laneUser.position.y);

    // 3. 泳道内子节点的相对坐标落在各自有效内边距以内
    const u1 = layoutedNodes.find((n) => n.id === 'u-1')!;
    const u2 = layoutedNodes.find((n) => n.id === 'u-2')!;
    expect(u1.position.x).toBeGreaterThanOrEqual(30);
    expect(u1.position.y).toBeGreaterThanOrEqual(30);
    expect(u2.position.x).toBeGreaterThan(u1.position.x);
  });

  it('纵向泳道自动排版从 x=0, y=40 起排不压池表头且支持 tree 模式纯直线展开', async () => {
    const vPool: FlowNode = {
      id: 'vp',
      type: 'pool',
      position: { x: 0, y: 0 },
      width: 480,
      height: 520,
      data: { label: '竖向池', type: 'pool', orientation: 'vertical', headerSize: 40, laneOrder: ['vl1', 'vl2'] },
    };
    const vl1: FlowNode = { id: 'vl1', type: 'lane', parentId: 'vp', position: { x: 0, y: 40 }, width: 240, height: 480, data: { label: '端A', type: 'lane' } };
    const vl2: FlowNode = { id: 'vl2', type: 'lane', parentId: 'vp', position: { x: 240, y: 40 }, width: 240, height: 480, data: { label: '端B', type: 'lane' } };
    const vn1: FlowNode = { id: 'vn1', type: 'process', parentId: 'vl1', position: { x: 40, y: 60 }, width: 160, height: 80, data: { label: 'A1', type: 'process' } };
    const vn2: FlowNode = { id: 'vn2', type: 'process', parentId: 'vl2', position: { x: 40, y: 200 }, width: 160, height: 80, data: { label: 'B1', type: 'process' } };
    const { nodes: vNodes } = await layoutDiagram([vPool, vl1, vl2, vn1, vn2], [{ id: 've1', source: 'vn1', target: 'vn2' }]);
    expect(vNodes.find((n) => n.id === 'vl1')!.position).toEqual({ x: 0, y: 40 });
    expect(vNodes.find((n) => n.id === 'vl2')!.position.y).toBe(40);
    expect(vNodes.find((n) => n.id === 'vl2')!.position.x).toBeGreaterThanOrEqual(240);

    const tNodes: FlowNode[] = [
      { id: 'r', type: 'process', position: { x: 0, y: 0 }, width: 160, height: 80, data: { label: 'R', type: 'process' } },
      { id: 'c1', type: 'process', position: { x: 0, y: 0 }, width: 160, height: 80, data: { label: 'C1', type: 'process' } },
      { id: 'c2', type: 'process', position: { x: 0, y: 0 }, width: 160, height: 80, data: { label: 'C2', type: 'process' } },
      { id: 'db', type: 'database', position: { x: 0, y: 0 }, width: 140, height: 90, data: { label: 'DB', type: 'database' } },
    ];
    const tEdges: FlowEdge[] = [
      { id: 'te1', source: 'r', target: 'c1', type: 'straight', data: { routingType: 'straight', waypoints: [{ x: 1, y: 1 }] } },
      { id: 'te2', source: 'r', target: 'c2', type: 'straight', data: { routingType: 'straight' } },
      { id: 'te3', source: 'c1', target: 'db', type: 'straight', data: { routingType: 'straight' } },
      { id: 'te4', source: 'c2', target: 'db', type: 'straight', data: { routingType: 'straight' } },
    ];
    const treeRes = await layoutDiagram(tNodes, tEdges, { mode: 'tree' });
    const lr = treeRes.nodes.find((n) => n.id === 'r')!;
    const lc1 = treeRes.nodes.find((n) => n.id === 'c1')!;
    const ldb = treeRes.nodes.find((n) => n.id === 'db')!;
    expect(lc1.position.y).toBeGreaterThan(lr.position.y);
    expect(ldb.position.y).toBeGreaterThan(lc1.position.y);
    expect(treeRes.edges.every((e) => !e.data?.waypoints)).toBe(true);
    expect(treeRes.edges[0].sourceHandle).toContain('bottom');
  });
});

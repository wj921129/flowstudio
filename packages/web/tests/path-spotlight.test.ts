import { describe, it, expect } from 'vitest';
import type { FlowNode, FlowEdge } from '@flowstudio/shared';
import {
  computePathSpotlight,
  computeGlobalPathSpotlight,
  getDecisionBranches,
} from '../src/features/canvas/utils/path-spotlight.js';

describe('path-spotlight: 因果链路双向 BFS 与分支过滤', () => {
  const nodes: FlowNode[] = [
    { id: 'start', type: 'start-end', position: { x: 0, y: 0 }, data: { label: '开始', type: 'start-end' } },
    { id: 'dec', type: 'decision', position: { x: 200, y: 0 }, data: { label: '审核', type: 'decision' } },
    { id: 'pass', type: 'process', position: { x: 400, y: -50 }, data: { label: '通过', type: 'process' }, parentId: 'lane-1' },
    { id: 'reject', type: 'process', position: { x: 400, y: 50 }, data: { label: '驳回', type: 'process' }, parentId: 'lane-2' },
    { id: 'endPass', type: 'start-end', position: { x: 600, y: -50 }, data: { label: '完成', type: 'start-end' } },
    { id: 'unrelated', type: 'process', position: { x: 200, y: 200 }, data: { label: '孤立节点', type: 'process' } },
    { id: 'lane-1', type: 'lane', position: { x: 0, y: 0 }, data: { label: '运营泳道', type: 'lane' } },
    { id: 'lane-2', type: 'lane', position: { x: 0, y: 100 }, data: { label: '法务泳道', type: 'lane' } },
  ];

  const edges: FlowEdge[] = [
    { id: 'e1', source: 'start', target: 'dec' },
    { id: 'e2', source: 'dec', target: 'pass', data: { label: '是' } },
    { id: 'e3', source: 'dec', target: 'reject', data: { label: '否' } },
    { id: 'e4', source: 'pass', target: 'endPass' },
  ];

  it('点击中间节点高亮双向完整因果链路（来路 + 去路）', () => {
    const res = computePathSpotlight(nodes, edges, 'pass');

    // 来路：start -> dec -> pass
    // 去路：pass -> endPass
    expect(res.nodeIds.has('start')).toBe(true);
    expect(res.nodeIds.has('dec')).toBe(true);
    expect(res.nodeIds.has('pass')).toBe(true);
    expect(res.nodeIds.has('endPass')).toBe(true);

    // 驳回分支与孤立节点不在此链路上
    expect(res.nodeIds.has('reject')).toBe(false);
    expect(res.nodeIds.has('unrelated')).toBe(false);

    // 连线检查
    expect(res.edgeIds.has('e1')).toBe(true);
    expect(res.edgeIds.has('e2')).toBe(true);
    expect(res.edgeIds.has('e4')).toBe(true);
    expect(res.edgeIds.has('e3')).toBe(false);

    // 途经泳道识别
    expect(res.laneIds.has('lane-1')).toBe(true);
    expect(res.laneIds.has('lane-2')).toBe(false);
  });

  it('提取 Decision 节点的外出分支标签', () => {
    const branches = getDecisionBranches('dec', edges);
    expect(branches).toEqual(['是', '否']);
  });

  it('支持 Decision 节点单分支筛选过滤', () => {
    // 聚焦在 dec 节点，但仅看 "是" 分支
    const res = computePathSpotlight(nodes, edges, 'dec', { decisionBranchFilter: '是' });

    expect(res.nodeIds.has('start')).toBe(true);
    expect(res.nodeIds.has('dec')).toBe(true);
    expect(res.nodeIds.has('pass')).toBe(true);
    expect(res.nodeIds.has('endPass')).toBe(true);

    // "否" 分支被过滤
    expect(res.nodeIds.has('reject')).toBe(false);
    expect(res.edgeIds.has('e3')).toBe(false);
  });

  it('全局链路走查高亮所有参与连线的节点、边及途经泳道，过滤孤立节点', () => {
    const res = computeGlobalPathSpotlight(nodes, edges);

    expect(res.nodeIds.has('start')).toBe(true);
    expect(res.nodeIds.has('dec')).toBe(true);
    expect(res.nodeIds.has('pass')).toBe(true);
    expect(res.nodeIds.has('reject')).toBe(true);
    expect(res.nodeIds.has('endPass')).toBe(true);
    expect(res.nodeIds.has('unrelated')).toBe(false);

    expect(res.edgeIds.size).toBe(4);
    expect(res.laneIds.has('lane-1')).toBe(true);
    expect(res.laneIds.has('lane-2')).toBe(true);
  });
});

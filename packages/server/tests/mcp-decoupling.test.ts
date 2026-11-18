import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { inspectDiagramSemantics } from '../src/mcp/diagram-inspector.js';
import {
  computeSwimlanePlacement,
  orderLaneIds,
  collectLiveLockState,
} from '../src/mcp/swimlane-geometry.js';
import { AiCollaborator } from '../src/mcp/ai-collaborator.js';

describe('MCP 巨型模块解耦子模块契约', () => {
  describe('diagram-inspector: 语义巡检子模块', () => {
    it('正确巡检孤立节点、缺少条件的判断分支与游离泳道节点', () => {
      const doc = new Y.Doc();
      const nodesMap = doc.getMap<Y.Map<unknown>>('nodes');
      const edgesMap = doc.getMap<Y.Map<unknown>>('edges');

      const addNode = (id: string, type: string, label: string, parentId?: string) => {
        const m = new Y.Map<unknown>();
        m.set('id', id);
        m.set('type', type);
        m.set('data', { label });
        if (parentId) m.set('parentId', parentId);
        nodesMap.set(id, m);
      };

      const addEdge = (id: string, source: string, target: string, label?: string) => {
        const m = new Y.Map<unknown>();
        m.set('id', id);
        m.set('source', source);
        m.set('target', target);
        m.set('data', { label: label ?? '' });
        edgesMap.set(id, m);
      };

      addNode('lane1', 'lane', '泳道一');
      addNode('n1', 'process', '步骤一', 'lane1');
      addNode('d1', 'decision', '判断一', 'lane1');
      addNode('n2', 'process', '步骤二', 'lane1');
      addNode('n3', 'process', '步骤三'); // 游离节点
      addNode('isolated', 'process', '孤立节点'); // 未连线且游离

      addEdge('e1', 'n1', 'd1');
      addEdge('e2', 'd1', 'n2', ''); // 分支缺少标签
      addEdge('e3', 'd1', 'n3', ''); // 第二分支同样缺少标签

      const warnings = inspectDiagramSemantics(nodesMap, edgesMap);
      expect(warnings.some((w) => w.includes('检测到孤立节点: 孤立节点(isolated)'))).toBe(true);
      expect(warnings.some((w) => w.includes('判断节点 判断一(d1) 有 2 条分支连线缺少条件标签'))).toBe(true);
      expect(warnings.some((w) => w.includes('泳道图中存在未归属泳道的游离节点'))).toBe(true);
    });
  });

  describe('swimlane-geometry: 泳道几何子模块', () => {
    it('正确按堆叠或预设顺序排序泳道', () => {
      const lanes = [
        { id: 'lane-b', position: { x: 0, y: 300 } },
        { id: 'lane-a', position: { x: 0, y: 100 } },
      ];
      const ordered = orderLaneIds(undefined, lanes, true);
      expect(ordered).toEqual(['lane-a', 'lane-b']);

      const customOrdered = orderLaneIds(['lane-b', 'lane-a'], lanes, true);
      expect(customOrdered).toEqual(['lane-b', 'lane-a']);
    });

    it('正确收集多级锁定链路状态', () => {
      const doc = new Y.Doc();
      const nodesMap = doc.getMap<Y.Map<unknown>>('nodes');

      const pool = new Y.Map<unknown>();
      pool.set('id', 'pool1');
      nodesMap.set('pool1', pool);

      const lane = new Y.Map<unknown>();
      lane.set('id', 'lane1');
      lane.set('parentId', 'pool1');
      nodesMap.set('lane1', lane);

      const node = new Y.Map<unknown>();
      node.set('id', 'node1');
      node.set('parentId', 'lane1');
      node.set('data', { lockMode: 'full' });
      nodesMap.set('node1', node);

      const state = collectLiveLockState(nodesMap);
      expect(state.fullProtectedIds.has('node1')).toBe(true);
      expect(state.fullProtectedIds.has('lane1')).toBe(true);
      expect(state.fullProtectedIds.has('pool1')).toBe(true);
      expect(state.hasLockedAncestor('node1', state.fullProtectedIds)).toBe(true);
      expect(state.hasLockedAncestor('node1')).toBe(false);
    });

    it('根据水平/垂直排版约束正确计算尺寸与偏移', () => {
      const placement = computeSwimlanePlacement({
        horizontal: true,
        laneIds: ['l1', 'l2'],
        children: [
          { id: 'c1', laneId: 'l1', width: 160, height: 80 },
          { id: 'c2', laneId: 'l2', width: 160, height: 80 },
        ],
        globalPositions: new Map([
          ['c1', { x: 100, y: 100 }],
          ['c2', { x: 200, y: 300 }],
        ]),
      });
      expect(placement.poolSize.width).toBeGreaterThanOrEqual(800);
      expect(placement.laneFrames.has('l1')).toBe(true);
      expect(placement.laneFrames.has('l2')).toBe(true);
      expect(placement.childPositions.has('c1')).toBe(true);
      expect(placement.childPositions.has('c2')).toBe(true);
    });
  });

  describe('ai-collaborator 门面导出接口完整性', () => {
    it('具备完整的公共方法并保持门面实例一致性', () => {
      const dummyRepo = {} as any;
      const collaborator = new AiCollaborator(dummyRepo);
      expect(typeof collaborator.listDiagrams).toBe('function');
      expect(typeof collaborator.createDiagram).toBe('function');
      expect(typeof collaborator.getDiagram).toBe('function');
      expect(typeof collaborator.getSelection).toBe('function');
      expect(typeof collaborator.scaffoldDiagram).toBe('function');
      expect(typeof collaborator.applyOps).toBe('function');
      expect(typeof collaborator.autoLayout).toBe('function');
      expect(typeof collaborator.undoAiBatch).toBe('function');
      expect(typeof collaborator.listSnapshots).toBe('function');
      expect(typeof collaborator.restoreSnapshot).toBe('function');
      expect(typeof collaborator.searchNodes).toBe('function');
      expect(typeof collaborator.renameDiagram).toBe('function');
      expect(typeof collaborator.deleteDiagram).toBe('function');
    });
  });
});

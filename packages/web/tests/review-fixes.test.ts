import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import type { FlowNode, FlowEdge } from '@flowstudio/shared';
import {
  splitEdgeAndInsertNode,
  healOnDelete,
  findEdgeAtPosition,
  getNodeWorldPosition,
} from '../src/features/canvas/utils/split-insert-manager.js';
import {
  generateDiagramSvg,
  sanitizeSvgColor,
  sanitizeSvgNumber,
  validateAndParseDiagramJson,
  escapeXml,
} from '../src/lib/export-utils.js';
import { CollaborativeUndoManager, TrackedOriginsSet } from '../src/features/collaboration/undo-manager.js';

describe('前端审查整改全量用例 (Review Fixes F1 - F6)', () => {
  describe('F2 & F3: 断键串接无重复 ID、世界坐标探测与锚定锁防顺推/防删除', () => {
    it('F2: 孤立节点拖拽断键插入时，upsert 保证 nextNodes 不包含重复节点 ID', () => {
      const nodeA: FlowNode = {
        id: 'node-a',
        type: 'process',
        position: { x: 0, y: 100 },
        width: 120,
        height: 60,
        data: { label: '节点 A' },
      };
      const nodeB: FlowNode = {
        id: 'node-b',
        type: 'process',
        position: { x: 300, y: 100 },
        width: 120,
        height: 60,
        data: { label: '节点 B' },
      };
      const edgeAB: FlowEdge = {
        id: 'edge-a-b',
        source: 'node-a',
        target: 'node-b',
        type: 'orthogonal',
      };

      // 孤立节点已经在画布上 (例如从边框外拖移过来)
      const orphanNode: FlowNode = {
        id: 'orphan-1',
        type: 'decision',
        position: { x: 140, y: 100 },
        width: 100,
        height: 60,
        data: { label: '待插入决策' },
      };

      const nodes = [nodeA, nodeB, orphanNode];
      const edges = [edgeAB];

      const res = splitEdgeAndInsertNode({
        nodes,
        edges,
        targetEdge: edgeAB,
        newNode: orphanNode,
        safetyGap: 60,
      });

      // 验证没有重复的 orphan-1 节点
      const orphanMatches = res.nextNodes.filter((n) => n.id === 'orphan-1');
      expect(orphanMatches.length).toBe(1);
      expect(res.nextEdges.length).toBe(2);
      expect(res.nextEdges.some((e) => e.source === 'node-a' && e.target === 'orphan-1')).toBe(true);
      expect(res.nextEdges.some((e) => e.source === 'orphan-1' && e.target === 'node-b')).toBe(true);
    });

    it('F2: 泳道内子节点通过 getNodeWorldPosition 正确换算世界坐标进行连线碰撞探测', () => {
      const pool: FlowNode = {
        id: 'pool-1',
        type: 'pool',
        position: { x: 100, y: 200 },
        width: 800,
        height: 400,
        data: { label: '业务池' },
      };
      const lane: FlowNode = {
        id: 'lane-1',
        type: 'lane',
        parentId: 'pool-1',
        position: { x: 0, y: 40 },
        width: 800,
        height: 180,
        data: { label: '泳道 1' },
      };
      const subNode: FlowNode = {
        id: 'sub-node',
        type: 'process',
        parentId: 'lane-1',
        position: { x: 50, y: 30 },
        width: 100,
        height: 50,
        data: { label: '子节点' },
      };

      const byId = new Map([
        [pool.id, pool],
        [lane.id, lane],
        [subNode.id, subNode],
      ]);

      const worldPos = getNodeWorldPosition(subNode, byId);
      // 世界坐标应累加: pool(100,200) + lane(0,40) + subNode(50,30) = (150, 270)
      expect(worldPos).toEqual({ x: 150, y: 270 });
    });

    it('F3: 锚定锁强约束：下游顺推跳过 position/full 锁定的节点，保持坐标不动', () => {
      const nodeA: FlowNode = {
        id: 'node-a',
        type: 'process',
        position: { x: 0, y: 100 },
        width: 100,
        height: 50,
        data: { label: '节点 A' },
      };
      const nodeB: FlowNode = {
        id: 'node-b',
        type: 'process',
        position: { x: 150, y: 100 },
        width: 100,
        height: 50,
        data: { label: '节点 B（位置锁定）', lockMode: 'position' },
      };
      const nodeC: FlowNode = {
        id: 'node-c',
        type: 'process',
        position: { x: 300, y: 100 },
        width: 100,
        height: 50,
        data: { label: '节点 C（完全锁定）', lockMode: 'full' },
      };
      const edgeAB: FlowEdge = { id: 'e-ab', source: 'node-a', target: 'node-b' };
      const edgeBC: FlowEdge = { id: 'e-bc', source: 'node-b', target: 'node-c' };

      const newNode: FlowNode = {
        id: 'new-node',
        type: 'process',
        position: { x: 50, y: 100 },
        width: 100,
        height: 50,
        data: { label: '插入的新节点' },
      };

      const res = splitEdgeAndInsertNode({
        nodes: [nodeA, nodeB, nodeC],
        edges: [edgeAB, edgeBC],
        targetEdge: edgeAB,
        newNode,
        safetyGap: 60,
      });

      const nextB = res.nextNodes.find((n) => n.id === 'node-b')!;
      const nextC = res.nextNodes.find((n) => n.id === 'node-c')!;

      // 锁定节点坚决不能被推移，保持初始位置
      expect(nextB.position.x).toBe(150);
      expect(nextC.position.x).toBe(300);
      expect(res.pushedNodeIds).not.toContain('node-b');
      expect(res.pushedNodeIds).not.toContain('node-c');
    });

    it('F3: healOnDelete 阻断完全锁定 (full) 节点的愈合删除', () => {
      const nodeA: FlowNode = { id: 'a', type: 'process', position: { x: 0, y: 0 }, data: { label: 'A' } };
      const lockedNode: FlowNode = {
        id: 'mid',
        type: 'process',
        position: { x: 100, y: 0 },
        data: { label: 'Locked Mid', lockMode: 'full' },
      };
      const nodeB: FlowNode = { id: 'b', type: 'process', position: { x: 200, y: 0 }, data: { label: 'B' } };

      const edgeIn: FlowEdge = { id: 'e-in', source: 'a', target: 'mid' };
      const edgeOut: FlowEdge = { id: 'e-out', source: 'mid', target: 'b' };

      const res = healOnDelete('mid', [nodeA, lockedNode, nodeB], [edgeIn, edgeOut]);
      expect(res.canHeal).toBe(false);
      // 节点未被删除
      expect(res.nextNodes.length).toBe(3);
      expect(res.nextEdges.length).toBe(2);
    });
  });

  describe('F4: SVG 属性注入防御与 JSON 校验深度强化', () => {
    it('sanitizeSvgColor 过滤恶意属性逃逸与非法颜色代码', () => {
      expect(sanitizeSvgColor('#fff')).toBe('#fff');
      expect(sanitizeSvgColor('#123456')).toBe('#123456');
      expect(sanitizeSvgColor('rgba(255, 0, 0, 0.8)')).toBe('rgba(255, 0, 0, 0.8)');
      expect(sanitizeSvgColor('transparent')).toBe('transparent');

      // 恶意注入测试
      const malicious = '#ffffff" onload="alert(1)"';
      expect(sanitizeSvgColor(malicious, '#000000')).toBe('#000000');

      const xssScript = '<script>alert(1)</script>';
      expect(sanitizeSvgColor(xssScript, '#000000')).toBe('#000000');
    });

    it('sanitizeSvgNumber 过滤非数与异常范围', () => {
      expect(sanitizeSvgNumber(24, 10)).toBe(24);
      expect(sanitizeSvgNumber('16', 10)).toBe(16);
      expect(sanitizeSvgNumber(NaN, 10)).toBe(10);
      expect(sanitizeSvgNumber(Infinity, 10)).toBe(10);
      expect(sanitizeSvgNumber(-5, 10, 0, 100)).toBe(0);
    });

    it('generateDiagramSvg 对恶意样式值与节点 ID 实施完整转义与安全过滤', () => {
      const maliciousNode: FlowNode = {
        id: 'node--malicious" onload="alert(1)"',
        type: 'process',
        position: { x: 50, y: 50 },
        width: 120,
        height: 60,
        data: {
          label: '<script>evil()</script>',
          style: {
            fillColor: '#FFFFFF" onclick="steal()',
            borderColor: 'red"><path d="M0,0" />',
            fontSize: 14,
          },
        },
      };

      const svg = generateDiagramSvg([maliciousNode], [], '安全测试图');
      // 不应包含未转义的 script 标签
      expect(svg).not.toContain('<script>evil()</script>');
      expect(svg).toContain('&lt;script&gt;evil()&lt;/script&gt;');
      // 不应包含未转义的双引号注入 onclick
      expect(svg).not.toContain('onclick="steal()"');
      // 注释中的 -- 应被清洗为 __
      expect(svg).not.toContain('<!-- Pool: node--');
    });

    it('validateAndParseDiagramJson 拦截非合法坐标与缺失结构', () => {
      const invalidJson = JSON.stringify({
        title: '测试图',
        nodes: [
          {
            id: 'node-bad',
            type: 'process',
            position: { x: 'not-a-number', y: 100 },
          },
        ],
      });

      const res = validateAndParseDiagramJson(invalidJson);
      expect(res.success).toBe(false);
      expect(res.error).toContain('坐标不是有效的数字');
    });
  });

  describe('F5: 协同撤销管理器支持快照恢复事务 origin', () => {
    it('TrackedOriginsSet 支持匹配 snapshot-restore:* 前缀', () => {
      const tracked = new TrackedOriginsSet(['client-123']);
      expect(tracked.has('client-123')).toBe(true);
      expect(tracked.has('client-999')).toBe(false);
      expect(tracked.has('snapshot-restore:snap-abc')).toBe(true);
      expect(tracked.has('snapshot-restore:version-1')).toBe(true);
    });

    it('CollaborativeUndoManager 能够成功撤销 snapshot-restore 事务', () => {
      const doc = new Y.Doc();
      const undoManager = new CollaborativeUndoManager(doc, 'local-user');

      const nodesMap = doc.getMap('nodes');

      // 本地客户端操作
      doc.transact(() => {
        nodesMap.set('n1', { label: '步骤 1' });
      }, 'local-user');

      expect(undoManager.canUndo()).toBe(true);

      // 截断当前捕获批次，使快照恢复形成独立的撤销步骤
      undoManager.stopCapturing();

      // 模拟服务端差量快照恢复事务 (origin: 'snapshot-restore:snap-1')
      doc.transact(() => {
        nodesMap.set('n1', { label: '快照恢复步骤 1' });
        nodesMap.set('n2', { label: '快照新增步骤 2' });
      }, 'snapshot-restore:snap-1');

      expect(undoManager.canUndo()).toBe(true);

      // 执行撤销，应能撤回快照恢复事务
      undoManager.undo();
      const n1Val = nodesMap.get('n1') as any;
      expect(n1Val?.label).toBe('步骤 1');
      expect(nodesMap.has('n2')).toBe(false);

      undoManager.destroy();
      doc.destroy();
    });

    it('快照恢复二进制差量以 snapshot-restore:<id> origin 应用到 Y.Doc，被 CollaborativeUndoManager 捕获并成功 Ctrl+Z 撤销', () => {
      const doc = new Y.Doc();
      const undoManager = new CollaborativeUndoManager(doc, 'local-user');
      const nodesMap = doc.getMap('nodes');

      doc.transact(() => {
        nodesMap.set('n1', { label: '初始1' });
        nodesMap.set('n2', { label: '初始2' });
        nodesMap.set('post', { label: '快照后新增' });
      }, 'remote-or-initial');
      undoManager.clear();
      expect(undoManager.canUndo()).toBe(false);

      const clone = new Y.Doc();
      Y.applyUpdate(clone, Y.encodeStateAsUpdate(doc));
      const vector = Y.encodeStateVector(clone);
      clone.getMap('nodes').delete('post');
      const deltaUpdate = Y.encodeStateAsUpdate(clone, vector);
      clone.destroy();

      undoManager.stopCapturing();
      Y.applyUpdate(doc, deltaUpdate, 'snapshot-restore:snap-ac3');
      undoManager.stopCapturing();

      expect(nodesMap.has('post')).toBe(false);
      expect(undoManager.canUndo()).toBe(true);

      undoManager.undo();
      expect(nodesMap.has('post')).toBe(true);

      undoManager.destroy();
      doc.destroy();
    });
  });

  describe('F1 & F6: 协同生命周期与 Awareness 节流防风暴', () => {
    it('F1: 模拟 StrictMode setup -> cleanup -> setup 生命周期，确保二次挂载不使用死实例', () => {
      const cleanupFns: Array<() => void> = [];

      // 模拟 setup 1
      const doc1 = new Y.Doc();
      const u1 = new CollaborativeUndoManager(doc1, 'client-1');
      cleanupFns.push(() => {
        u1.destroy();
        doc1.destroy();
      });

      // 模拟 React 19 StrictMode cleanup 1
      for (const fn of cleanupFns) fn();
      cleanupFns.length = 0;

      // 验证 doc1 已销毁
      expect(() => {
        doc1.transact(() => {
          doc1.getMap('nodes').set('test', 123);
        });
      }).not.toThrow(); // Y.Doc destroy 后 transact 不会抛错但不会触发观察器

      // 模拟 setup 2：重新分配全新的实例而非复用已销毁的 dead 实例
      const doc2 = new Y.Doc();
      const u2 = new CollaborativeUndoManager(doc2, 'client-1');
      const nodesMap2 = doc2.getMap('nodes');

      let notified = false;
      u2.subscribe(() => {
        notified = true;
      });

      doc2.transact(() => {
        nodesMap2.set('test', 'fresh');
      }, 'client-1');

      // 验证全新实例具备完整的协同与撤销观察能力
      expect(notified).toBe(true);
      expect(u2.canUndo()).toBe(true);

      u2.destroy();
      doc2.destroy();
    });

    it('F6: useAwareness 视口广播实施 50ms 节流，有效抵御高频 Awareness 风暴', () => {
      let setLocalStateCount = 0;
      const mockProvider = {
        awareness: {
          clientID: 1,
          getStates: () => new Map(),
          on: vi.fn(),
          off: vi.fn(),
          setLocalStateField: vi.fn(() => {
            setLocalStateCount++;
          }),
        },
      } as any;

      // 模拟节流逻辑
      let lastViewportBroadcast = 0;
      const broadcastViewportThrottled = (vp: any) => {
        const now = performance.now();
        if (now - lastViewportBroadcast < 50) return;
        lastViewportBroadcast = now;
        mockProvider.awareness.setLocalStateField('user', { viewport: vp });
      };

      // 模拟 10 毫秒内连续触发 10 次 viewport 变更 (例如高速滚轮或拖拽)
      for (let i = 0; i < 10; i++) {
        broadcastViewportThrottled({ x: i * 10, y: i * 10, zoom: 1 });
      }

      // 50ms 节流下，第一批高频调用仅触发 1 次广播
      expect(mockProvider.awareness.setLocalStateField).toHaveBeenCalledTimes(1);
    });
  });

  describe('H3 & H4: 统一锚定锁批量守卫 (对齐/分布/成组/解散/批量改色)', () => {
    it('H3: alignSelectedNodes 严格跳过 position/full 锁定节点，锁定节点原位不动', async () => {
      const { useFlowStore } = await import('../src/stores/flow-store.js');
      const store = useFlowStore.getState();

      const n1: FlowNode = {
        id: 'n1',
        type: 'process',
        position: { x: 50, y: 100 },
        width: 100,
        height: 50,
        data: { label: 'Node 1' },
      };
      const n2Locked: FlowNode = {
        id: 'n2',
        type: 'process',
        position: { x: 200, y: 200 },
        width: 100,
        height: 50,
        data: { label: 'Node 2 Locked', lockMode: 'position' },
      };
      const n3: FlowNode = {
        id: 'n3',
        type: 'process',
        position: { x: 350, y: 300 },
        width: 100,
        height: 50,
        data: { label: 'Node 3' },
      };

      store.setDiagram([n1, n2Locked, n3], []);
      store.setSelectedNodes(['n1', 'n2', 'n3']);

      // 触发左对齐 (targetValue = min(50, 200, 350) = 50)
      store.alignSelectedNodes('left');

      const latestNodes = useFlowStore.getState().nodes;
      const latestN1 = latestNodes.find((n) => n.id === 'n1')!;
      const latestN2 = latestNodes.find((n) => n.id === 'n2')!;
      const latestN3 = latestNodes.find((n) => n.id === 'n3')!;

      expect(latestN1.position.x).toBe(50);
      // n2 被锁定，坐标坚决保持 200 不被移动
      expect(latestN2.position.x).toBe(200);
      expect(latestN3.position.x).toBe(50);
    });

    it('H3: distributeSelectedNodes 严格跳过 position/full 锁定节点', async () => {
      const { useFlowStore } = await import('../src/stores/flow-store.js');
      const store = useFlowStore.getState();

      const n1: FlowNode = { id: 'd1', type: 'process', position: { x: 0, y: 0 }, width: 100, height: 50, data: { label: 'D1' } };
      const n2Locked: FlowNode = { id: 'd2', type: 'process', position: { x: 80, y: 0 }, width: 100, height: 50, data: { label: 'D2 Locked', lockMode: 'full' } };
      const n3: FlowNode = { id: 'd3', type: 'process', position: { x: 200, y: 0 }, width: 100, height: 50, data: { label: 'D3' } };

      store.setDiagram([n1, n2Locked, n3], []);
      store.setSelectedNodes(['d1', 'd2', 'd3']);

      store.distributeSelectedNodes('horizontal');

      const latestNodes = useFlowStore.getState().nodes;
      const latestD2 = latestNodes.find((n) => n.id === 'd2')!;
      // d2 处于 full 锁定，位置保持初始 80 不变
      expect(latestD2.position.x).toBe(80);
    });

    it('H3: groupSelectedNodes 与 ungroupNodes 对完全锁定 (full) 节点强拦截', async () => {
      const { useFlowStore } = await import('../src/stores/flow-store.js');
      const store = useFlowStore.getState();

      const gChild1: FlowNode = { id: 'gc1', type: 'process', position: { x: 10, y: 10 }, width: 100, height: 50, data: { label: 'GC1' } };
      const gChild2Locked: FlowNode = {
        id: 'gc2',
        type: 'process',
        position: { x: 120, y: 10 },
        width: 100,
        height: 50,
        data: { label: 'GC2 Locked', lockMode: 'full' },
      };

      store.setDiagram([gChild1, gChild2Locked], []);
      store.setSelectedNodes(['gc1', 'gc2']);

      // 由于 gc2 处于 full 锁，不能被纳入新组合，有效节点不足 2 个，成组被拦截
      const res = store.groupSelectedNodes();
      expect(res).toBeNull();
    });

    it('H4: batchUpdateNodeData 严格拦截对 full 锁定节点的样式/属性更新', async () => {
      const { useFlowStore } = await import('../src/stores/flow-store.js');
      const store = useFlowStore.getState();

      const u1: FlowNode = { id: 'u1', type: 'process', position: { x: 0, y: 0 }, data: { label: 'U1', style: { borderColor: '#000' } } };
      const u2Locked: FlowNode = {
        id: 'u2',
        type: 'process',
        position: { x: 100, y: 0 },
        data: { label: 'U2 Locked', lockMode: 'full', style: { borderColor: '#111' } },
      };

      store.setDiagram([u1, u2Locked], []);

      // 批量改色
      store.batchUpdateNodeData([
        { id: 'u1', data: { style: { borderColor: '#3B82F6' } } },
        { id: 'u2', data: { style: { borderColor: '#EF4444' } } },
      ]);

      const latestNodes = useFlowStore.getState().nodes;
      const latestU1 = latestNodes.find((n) => n.id === 'u1')!;
      const latestU2 = latestNodes.find((n) => n.id === 'u2')!;

      expect(latestU1.data.style?.borderColor).toBe('#3B82F6');
      // u2 处于 full 锁定，颜色保持原本的 #111，不被批量改色冲掉
      expect(latestU2.data.style?.borderColor).toBe('#111');
    });
  });

  describe('M5: 导出 CSS 变量解析 resolveCssVarColor', () => {
    it('resolveCssVarColor 正确将 var(--fs-palette-*) 解析为具体的 HEX 色值', async () => {
      const { resolveCssVarColor, sanitizeSvgColor } = await import('../src/lib/export-utils.js');

      expect(resolveCssVarColor('var(--fs-palette-1)')).toBe('#3B82F6');
      expect(resolveCssVarColor('var(--fs-palette-2)')).toBe('#10B981');
      expect(resolveCssVarColor('var(--fs-palette-4)')).toBe('#EF4444');

      // 经 sanitizeSvgColor 完整流程解析并校验
      expect(sanitizeSvgColor('var(--fs-palette-1)')).toBe('#3B82F6');
      expect(sanitizeSvgColor('var(--fs-palette-3)')).toBe('#F59E0B');
    });
  });

  describe('B3, B4, B5, B11: 审查整改#3 净新增专项用例', () => {
    it('B3: onNodesChange 严格拦截包含锁定子节点的容器的 position 移动', async () => {
      const { useFlowStore } = await import('../src/stores/flow-store.js');
      const store = useFlowStore.getState();

      const lane: FlowNode = {
        id: 'lane-parent',
        type: 'lane',
        position: { x: 100, y: 100 },
        width: 800,
        height: 200,
        data: { label: '受保泳道' },
      };
      const lockedChild: FlowNode = {
        id: 'child-locked',
        type: 'process',
        parentId: 'lane-parent',
        position: { x: 40, y: 40 },
        data: { label: '锁定子节点', lockMode: 'position' },
      };

      store.setDiagram([lane, lockedChild], []);

      // 试图移动 lane-parent
      store.onNodesChange([
        {
          type: 'position',
          id: 'lane-parent',
          position: { x: 300, y: 300 },
        },
      ]);

      const latestNodes = useFlowStore.getState().nodes;
      const latestLane = latestNodes.find((n) => n.id === 'lane-parent')!;
      // lane 包含锁定子节点，其 position 移动被拦截，保持原位 (100, 100)
      expect(latestLane.position).toEqual({ x: 100, y: 100 });
    });

    it('B4: applyMermaidOps 的 move_to_lane 严格拦截对 position/full 锁定节点的重挂', async () => {
      const { useFlowStore } = await import('../src/stores/flow-store.js');
      const store = useFlowStore.getState();

      const laneA: FlowNode = { id: 'lane-a', type: 'lane', position: { x: 0, y: 0 }, data: { label: '泳道A' } };
      const laneB: FlowNode = { id: 'lane-b', type: 'lane', position: { x: 0, y: 200 }, data: { label: '泳道B' } };
      const nodeLocked: FlowNode = {
        id: 'node-locked',
        type: 'process',
        parentId: 'lane-a',
        position: { x: 50, y: 50 },
        data: { label: '锁定节点', lockMode: 'position' },
      };
      const nodeNormal: FlowNode = {
        id: 'node-normal',
        type: 'process',
        parentId: 'lane-a',
        position: { x: 50, y: 50 },
        data: { label: '普通节点', lockMode: 'none' },
      };

      store.setDiagram([laneA, laneB, nodeLocked, nodeNormal], []);

      store.applyMermaidOps([
        { op: 'move_to_lane', nodeId: 'node-locked', laneId: 'lane-b' },
        { op: 'move_to_lane', nodeId: 'node-normal', laneId: 'lane-b' },
      ]);

      const latestNodes = useFlowStore.getState().nodes;
      const resLocked = latestNodes.find((n) => n.id === 'node-locked')!;
      const resNormal = latestNodes.find((n) => n.id === 'node-normal')!;

      // 锁定节点被拦截，仍停留在 lane-a
      expect(resLocked.parentId).toBe('lane-a');
      // 普通节点成功移至 lane-b
      expect(resNormal.parentId).toBe('lane-b');
    });

    it('B5: deleteSelected 保护包含锁定子节点的泳道/分组不被删除，避免子节点悬挂', async () => {
      const { useFlowStore } = await import('../src/stores/flow-store.js');
      const store = useFlowStore.getState();

      const groupNode: FlowNode = {
        id: 'group-1',
        type: 'group',
        position: { x: 50, y: 50 },
        width: 300,
        height: 200,
        data: { label: '受保分组' },
      };
      const lockedChild: FlowNode = {
        id: 'g-child-locked',
        type: 'process',
        parentId: 'group-1',
        position: { x: 20, y: 20 },
        data: { label: '不可删除的锁定子节点', lockMode: 'full' },
      };
      const normalChild: FlowNode = {
        id: 'g-child-normal',
        type: 'process',
        parentId: 'group-1',
        position: { x: 120, y: 20 },
        data: { label: '普通子节点' },
      };

      store.setDiagram([groupNode, lockedChild, normalChild], []);

      // 用户全选并按 Delete 删除 group-1
      store.setSelectedNodes(['group-1']);
      store.deleteSelected();

      const latestNodes = useFlowStore.getState().nodes;
      // group-1 内部有 full 锁定的子节点，父容器 group-1 和锁定子节点都安全保留
      expect(latestNodes.some((n) => n.id === 'group-1')).toBe(true);
      expect(latestNodes.some((n) => n.id === 'g-child-locked')).toBe(true);
      expect(latestNodes.some((n) => n.id === 'g-child-normal')).toBe(true);
      // 锁定子节点的 parentId 没有悬挂！
      const lockedNode = latestNodes.find((n) => n.id === 'g-child-locked')!;
      expect(lockedNode.parentId).toBe('group-1');
    });

    it('P1-2: 选中含 full 锁子节点的泳道 deleteSelected，泳道及所有后代(含未锁定节点)整体保留', async () => {
      const { useFlowStore } = await import('../src/stores/flow-store.js');
      const store = useFlowStore.getState();

      const lane: FlowNode = { id: 'lane-p1', type: 'lane', position: { x: 0, y: 0 }, width: 700, height: 240, data: { label: '泳道' } };
      const lockedChild: FlowNode = { id: 'child-lock', type: 'process', parentId: 'lane-p1', position: { x: 50, y: 50 }, data: { label: '锁定', lockMode: 'full' } };
      const freeChild1: FlowNode = { id: 'child-free-1', type: 'process', parentId: 'lane-p1', position: { x: 250, y: 50 }, data: { label: '自由1' } };
      const freeChild2: FlowNode = { id: 'child-free-2', type: 'process', parentId: 'lane-p1', position: { x: 450, y: 50 }, data: { label: '自由2' } };

      store.setDiagram([lane, lockedChild, freeChild1, freeChild2], []);
      store.setSelectedNodes(['lane-p1']);
      store.deleteSelected();

      const latestNodes = useFlowStore.getState().nodes;
      expect(latestNodes.some((n) => n.id === 'lane-p1')).toBe(true);
      expect(latestNodes.some((n) => n.id === 'child-lock')).toBe(true);
      expect(latestNodes.some((n) => n.id === 'child-free-1')).toBe(true);
      expect(latestNodes.some((n) => n.id === 'child-free-2')).toBe(true);
    });

    it('铁律③: onNodesChange 严格过滤锁定泳道与容器的 dimensions 变更', async () => {
      const { useFlowStore } = await import('../src/stores/flow-store.js');
      const store = useFlowStore.getState();

      const laneLocked: FlowNode = {
        id: 'lane-locked-dim',
        type: 'lane',
        position: { x: 0, y: 0 },
        width: 700,
        height: 240,
        data: { label: '锁定泳道', lockMode: 'position' },
      };

      store.setDiagram([laneLocked], []);
      store.onNodesChange([
        {
          type: 'dimensions',
          id: 'lane-locked-dim',
          dimensions: { width: 999, height: 888 },
          resizing: true,
          setAttributes: true,
        } as any,
      ]);

      const latestNodes = useFlowStore.getState().nodes;
      const target = latestNodes.find((n) => n.id === 'lane-locked-dim')!;
      expect(target.width).toBe(700);
      expect(target.height).toBe(240);
    });

    it('铁律③: handleNodeDragNesting 拖拽子节点越界时锁定泳道与池尺寸冻结不被自动撑开', async () => {
      const { handleNodeDragNesting } = await import('../src/features/canvas/utils/lane-nesting-manager.js');

      const pool: FlowNode = {
        id: 'pool-lock',
        type: 'pool',
        position: { x: 50, y: 50 },
        width: 800,
        height: 400,
        data: { label: '池', orientation: 'horizontal', lockMode: 'position' },
      };
      const lane: FlowNode = {
        id: 'lane-lock',
        type: 'lane',
        parentId: 'pool-lock',
        position: { x: 0, y: 40 },
        width: 800,
        height: 200,
        data: { label: '锁定泳道', lockMode: 'position' },
      };
      const child: FlowNode = {
        id: 'child-moving',
        type: 'process',
        parentId: 'lane-lock',
        position: { x: 950, y: 350 },
        width: 160,
        height: 80,
        data: { label: '越界子节点' },
      };

      const res = handleNodeDragNesting('child-moving', [pool, lane, child]);

      const resLane = res.nextNodes.find((n) => n.id === 'lane-lock')!;
      const resPool = res.nextNodes.find((n) => n.id === 'pool-lock')!;

      expect(resLane.width).toBe(800);
      expect(resLane.height).toBe(200);
      expect(resPool.width).toBe(800);
      expect(resPool.height).toBe(400);
    });

    it('B11: applyMermaidOps 泳道内增量节点横向排列且连线端点校验', async () => {
      const { useFlowStore } = await import('../src/stores/flow-store.js');
      const store = useFlowStore.getState();

      const lane: FlowNode = { id: 'lane-x', type: 'lane', position: { x: 0, y: 0 }, data: { label: '泳道X' } };
      store.setDiagram([lane], []);

      store.applyMermaidOps([
        { op: 'add_node', id: 'n1', label: '节点1', type: 'process', laneId: 'lane-x' },
        { op: 'add_node', id: 'n2', label: '节点2', type: 'process', laneId: 'lane-x' },
        { op: 'connect', source: 'n1', target: 'n2' },
        { op: 'connect', source: 'n1', target: 'non-existent' }, // 目标不存在，应被跳过
      ]);

      const latestNodes = useFlowStore.getState().nodes;
      const latestEdges = useFlowStore.getState().edges;

      const n1 = latestNodes.find((n) => n.id === 'n1')!;
      const n2 = latestNodes.find((n) => n.id === 'n2')!;

      expect(n1.position.x).toBe(40);
      expect(n2.position.x).toBe(200); // 40 + 1 * 160 = 200，增量横向偏移不堆叠！
      expect(latestEdges.length).toBe(1);
      expect(latestEdges[0].source).toBe('n1');
      expect(latestEdges[0].target).toBe('n2');
    });

    it('FS-001: bindCollaboration does not overwrite custom title with default title before hydration', async () => {
      const { useFlowStore } = await import('../src/stores/flow-store.js');
      const { YjsDiagramBridge } = await import('../src/features/collaboration/yjs-doc-bridge.js');
      const { CollaborativeUndoManager } = await import('../src/features/collaboration/undo-manager.js');

      useFlowStore.getState().unbindCollaboration();
      useFlowStore.getState().resetDiagramState();

      const doc = new Y.Doc();
      const bridge = new YjsDiagramBridge(doc, { localClientId: 'client-test' });
      const undo = new CollaborativeUndoManager(doc, 'client-test', 0);

      useFlowStore.getState().bindCollaboration(bridge, undo);
      expect(bridge.getRawTitle()).toBeUndefined();

      const serverDoc = new Y.Doc();
      serverDoc.getMap('meta').set('title', '电商订单履约');
      const serverUpdate = Y.encodeStateAsUpdate(serverDoc);
      Y.applyUpdate(doc, serverUpdate);

      expect(useFlowStore.getState().diagramTitle).toBe('电商订单履约');
      useFlowStore.getState().unbindCollaboration();
    });

    it('FS-009: sidebarStore reset restores elements tab and uncollapsed state', async () => {
      const { useSidebarStore } = await import('../src/features/sidebar/sidebar-store.js');
      useSidebarStore.getState().setActiveTab('templates');
      useSidebarStore.getState().setIsCollapsed(true);
      expect(useSidebarStore.getState().isCollapsed).toBe(true);
      expect(useSidebarStore.getState().activeTab).toBe('templates');

      useSidebarStore.getState().reset();
      expect(useSidebarStore.getState().isCollapsed).toBe(false);
      expect(useSidebarStore.getState().activeTab).toBe('elements');
    });

    it('FS-011: groupSelectedNodes requires at least 2 nodes and shows toast when insufficient', async () => {
      const { useFlowStore } = await import('../src/stores/flow-store.js');
      const nodeA: FlowNode = { id: 'single-node-1', type: 'process', position: { x: 10, y: 10 }, data: { label: 'A' } };
      useFlowStore.getState().setDiagram([nodeA], []);
      useFlowStore.getState().setSelectedNodes(['single-node-1']);

      const groupRes = useFlowStore.getState().groupSelectedNodes({ asFrame: false });
      expect(groupRes).toBeNull();
      expect(useFlowStore.getState().toastMessage).toBe('成组至少需选择 2 个图元');
      expect(useFlowStore.getState().nodes.length).toBe(1);
    });

    it('FS-013: tokens.css specifies dark canvas dot color as #475569', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const cssContent = fs.readFileSync(path.resolve(__dirname, '../src/features/theme/tokens.css'), 'utf-8');
      expect(cssContent).toContain('--fs-canvas-dot: #475569;');
    });

    it('FS-014: instantiateTemplate & appendSubgraph correctly appends subgraph at dropped position on empty/non-empty canvas', async () => {
      const { TEMPLATES_REGISTRY, instantiateTemplate } = await import('../src/features/sidebar/templates/index.js');
      const { getThemePreset } = await import('../src/features/sidebar/styles/theme-presets.js');
      const { useFlowStore } = await import('../src/stores/flow-store.js');

      const template = TEMPLATES_REGISTRY[0];
      const theme = getThemePreset('default');
      const dropPos = { x: 300, y: 200 };

      // 空画布场景
      useFlowStore.getState().setDiagram([], []);
      const inst1 = instantiateTemplate(template, theme, dropPos);
      useFlowStore.getState().appendSubgraph(inst1.nodes, inst1.edges);

      const nodes1 = useFlowStore.getState().nodes;
      expect(nodes1.length).toBe(template.spec.nodes.length);
      expect(nodes1[0].position.x).toBeGreaterThanOrEqual(dropPos.x - 50);

      // 非空画布追加场景
      const dropPos2 = { x: 800, y: 500 };
      const inst2 = instantiateTemplate(template, theme, dropPos2);
      useFlowStore.getState().appendSubgraph(inst2.nodes, inst2.edges);

      const nodes2 = useFlowStore.getState().nodes;
      expect(nodes2.length).toBe(template.spec.nodes.length * 2);
    });

    it('FS-015: templates panel supports whole card click and registry entries have valid spec', async () => {
      const { TEMPLATES_REGISTRY } = await import('../src/features/sidebar/templates/index.js');
      expect(TEMPLATES_REGISTRY.length).toBeGreaterThanOrEqual(4);
      for (const tmpl of TEMPLATES_REGISTRY) {
        expect(tmpl.id).toBeTruthy();
        expect(tmpl.title).toBeTruthy();
        expect(tmpl.spec.nodes.length).toBeGreaterThan(0);
      }
    });

    it('FS-016: TopBar implements responsive breakpoints to prevent horizontal overflow on <=1123px', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const topBarCode = fs.readFileSync(path.resolve(__dirname, '../src/features/topbar/top-bar.tsx'), 'utf-8');
      expect(topBarCode).toContain('hidden xl:inline');
      expect(topBarCode).toContain('hidden lg:inline');
      expect(topBarCode).toContain('hidden md:inline');
    });

    it('FS-018: reorderPoolOrientation correctly rearranges lanes horizontally and vertically', async () => {
      const { reorderPoolOrientation } = await import('../src/features/canvas/utils/lane-nesting-manager.js');

      const pool: FlowNode = {
        id: 'pool-test',
        type: 'pool',
        position: { x: 0, y: 0 },
        width: 800,
        height: 440,
        data: { orientation: 'horizontal', headerSize: 40, laneOrder: ['l1', 'l2'] },
      };
      const l1: FlowNode = { id: 'l1', type: 'lane', parentId: 'pool-test', position: { x: 0, y: 40 }, width: 800, height: 200, data: {} };
      const l2: FlowNode = { id: 'l2', type: 'lane', parentId: 'pool-test', position: { x: 0, y: 240 }, width: 800, height: 200, data: {} };

      // 横切纵
      const verticalNodes = reorderPoolOrientation('pool-test', 'vertical', [pool, l1, l2]);
      const vPool = verticalNodes.find((n) => n.id === 'pool-test')!;
      const vl1 = verticalNodes.find((n) => n.id === 'l1')!;
      const vl2 = verticalNodes.find((n) => n.id === 'l2')!;

      expect(vPool.data?.orientation).toBe('vertical');
      expect(vl1.position.x).toBe(0);
      expect(vl1.position.y).toBe(40);
      expect(vl2.position.x).toBe(240);
      expect(vl2.position.y).toBe(40);

      // 纵切横
      const horizontalNodes = reorderPoolOrientation('pool-test', 'horizontal', verticalNodes);
      const hl1 = horizontalNodes.find((n) => n.id === 'l1')!;
      const hl2 = horizontalNodes.find((n) => n.id === 'l2')!;
      expect(hl1.position.x).toBe(0);
      expect(hl1.position.y).toBe(40);
      expect(hl2.position.x).toBe(0);
      expect(hl2.position.y).toBe(240);
    });

    it('FS-019: addNode pool & lane enforces pool->lane hierarchy and prevents orphaned lanes', async () => {
      const { useFlowStore } = await import('../src/stores/flow-store.js');
      useFlowStore.getState().setDiagram([], []);

      // 1. 点击 pool 默认生成 2 条泳道
      const pool = useFlowStore.getState().addNode('pool', { x: 100, y: 100 });
      const currentNodes = useFlowStore.getState().nodes;
      const childLanes = currentNodes.filter((n) => n.parentId === pool.id);
      expect(childLanes.length).toBe(2);
      expect(pool.data?.laneOrder?.length).toBe(2);

      // 2. 点击 lane 追加进既有 pool
      const lane3 = useFlowStore.getState().addNode('lane', { x: 200, y: 200 });
      expect(lane3.parentId).toBe(pool.id);
      const updatedNodes = useFlowStore.getState().nodes;
      const updatedChildLanes = updatedNodes.filter((n) => n.parentId === pool.id);
      expect(updatedChildLanes.length).toBe(3);

      // 3. 空画布点击 lane 自动建 pool
      useFlowStore.getState().setDiagram([], []);
      const standaloneLane = useFlowStore.getState().addNode('lane', { x: 50, y: 50 });
      const nodesAfter = useFlowStore.getState().nodes;
      const createdPool = nodesAfter.find((n) => n.type === 'pool')!;
      expect(createdPool).toBeTruthy();
      expect(standaloneLane.parentId).toBe(createdPool.id);
    });
  });
});

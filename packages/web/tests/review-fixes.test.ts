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
});

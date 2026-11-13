import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { layoutDiagram } from '../src/features/canvas/layout/elk-layout.js';
import { handleNodeDragNesting } from '../src/features/canvas/utils/lane-nesting-manager.js';
import { YjsDiagramBridge } from '../src/features/collaboration/yjs-doc-bridge.js';
import { CollaborativeUndoManager } from '../src/features/collaboration/undo-manager.js';
import type { FlowNode, FlowEdge } from '@flowstudio/shared';

describe('M3 Quality Gate: Swimlane, Auto-Layout & Collaboration Convergence', () => {
  it('passes M3 end-to-end quality gate: build swimlane -> drag nest -> auto layout -> sync to Yjs -> isolate undo', async () => {
    // 1. 初始化泳道图结构：1 个 Pool + 2 个 Lane
    const poolId = 'pool-order';
    const laneUser = 'lane-user';
    const laneAdmin = 'lane-admin';

    const pool: FlowNode = {
      id: poolId,
      type: 'pool',
      position: { x: 50, y: 50 },
      width: 800,
      height: 440,
      data: {
        label: '电商订单履约泳道池',
        type: 'pool',
        orientation: 'horizontal',
        laneOrder: [laneUser, laneAdmin],
        headerSize: 40,
      },
    };

    const lane1: FlowNode = {
      id: laneUser,
      type: 'lane',
      parentId: poolId,
      extent: 'parent',
      position: { x: 0, y: 40 },
      width: 800,
      height: 200,
      data: { label: '买家端', type: 'lane', laneTitle: '买家端' },
    };

    const lane2: FlowNode = {
      id: laneAdmin,
      type: 'lane',
      parentId: poolId,
      extent: 'parent',
      position: { x: 0, y: 240 },
      width: 800,
      height: 200,
      data: { label: '运营后台', type: 'lane', laneTitle: '运营后台' },
    };

    // 2. 模拟用户将外部独立节点拖入买家泳道
    const nodeSubmit: FlowNode = {
      id: 'step-submit',
      type: 'process',
      position: { x: 120, y: 110 }, // 落在 lane1 的全局包围盒内 [50, 90, 850, 290]
      width: 160,
      height: 80,
      data: { label: '提交订单', type: 'process' },
    };

    const initialNodes = [pool, lane1, lane2, nodeSubmit];
    const { updated, nextNodes } = handleNodeDragNesting('step-submit', initialNodes);

    expect(updated).toBe(true);
    const nestedSubmit = nextNodes.find((n) => n.id === 'step-submit')!;
    expect(nestedSubmit.parentId).toBe(laneUser);
    expect(nestedSubmit.extent).toBeUndefined();

    // 3. 补充运营后台审批节点并创建跨泳道连线
    const nodeAudit: FlowNode = {
      id: 'step-audit',
      type: 'decision',
      parentId: laneAdmin,
      extent: 'parent',
      position: { x: 50, y: 50 },
      width: 140,
      height: 100,
      data: { label: '人工风控审核', type: 'decision' },
    };

    const allNodes = [...nextNodes, nodeAudit];
    const allEdges: FlowEdge[] = [
      {
        id: 'edge-submit-to-audit',
        source: 'step-submit',
        target: 'step-audit',
      },
    ];

    // 4. 执行基于 elkjs 的泳道感知自动排版
    const layoutRes = await layoutDiagram(allNodes, allEdges);
    expect(layoutRes.nodes.length).toBe(5);

    const layoutedPool = layoutRes.nodes.find((n) => n.id === poolId)!;
    const layoutedLane1 = layoutRes.nodes.find((n) => n.id === laneUser)!;
    const layoutedLane2 = layoutRes.nodes.find((n) => n.id === laneAdmin)!;
    const layoutedSubmit = layoutRes.nodes.find((n) => n.id === 'step-submit')!;
    const layoutedAudit = layoutRes.nodes.find((n) => n.id === 'step-audit')!;

    // 验证排版几何约束
    expect(layoutedPool.width).toBeGreaterThanOrEqual(750);
    expect(layoutedLane2.position.y).toBeGreaterThan(layoutedLane1.position.y);
    expect(layoutedAudit.position.x).toBeGreaterThan(layoutedSubmit.position.x);

    // 5. 将排版结果写入 Yjs 协同引擎，验证 CRDT 状态收敛与拓扑保序
    const ydoc = new Y.Doc();
    const bridge = new YjsDiagramBridge(ydoc, { localClientId: 'client-local-tester' });
    const undoManager = new CollaborativeUndoManager(ydoc, 'client-local-tester');

    bridge.setDiagram(layoutRes.nodes, layoutRes.edges);

    // 反向拉取验证拓扑排序：pool 必须先于 lane，lane 必须先于其子节点
    const stored = bridge.toReactFlowState();
    expect(stored.nodes.length).toBe(5);

    const poolIndex = stored.nodes.findIndex((n) => n.id === poolId);
    const lane1Index = stored.nodes.findIndex((n) => n.id === laneUser);
    const submitIndex = stored.nodes.findIndex((n) => n.id === 'step-submit');

    expect(poolIndex).toBeLessThan(lane1Index);
    expect(lane1Index).toBeLessThan(submitIndex);

    // 6. 验证协同独立撤销重做：撤销本次修改后恢复初始
    expect(undoManager.canUndo()).toBe(true);
    undoManager.undo();

    const afterUndo = bridge.toReactFlowState();
    expect(afterUndo.nodes.length).toBe(0); // 撤销了初次全量提交

    expect(undoManager.canRedo()).toBe(true);
    undoManager.redo();

    const afterRedo = bridge.toReactFlowState();
    expect(afterRedo.nodes.length).toBe(5);

    bridge.destroy();
    undoManager.destroy();
  });
});

import { describe, it, expect } from 'vitest';
import {
  flowNodeSchema,
  flowEdgeSchema,
  createDiagramInputSchema,
  updateDiagramInputSchema,
  awarenessUserStateSchema,
  FLOW_NODE_TYPES,
  isFlowNodeType,
  getNodeRegistryEntry,
} from '../src/index.js';

describe('@flowstudio/shared schemas', () => {
  it('validates a standard FlowNode and rejects unknown node types', () => {
    const valid = flowNodeSchema.safeParse({
      id: 'node-1',
      type: 'process',
      position: { x: 120, y: 90 },
      data: { label: '订单校验', type: 'process' },
    });
    expect(valid.success).toBe(true);

    const invalid = flowNodeSchema.safeParse({
      id: 'node-2',
      type: 'invalid-type',
      position: { x: 0, y: 0 },
      data: { label: '错误', type: 'invalid-type' },
    });
    expect(invalid.success).toBe(false);
  });

  it('validates pool and lane swimlane nodes with hierarchical relationships', () => {
    expect(FLOW_NODE_TYPES).toContain('pool');
    expect(FLOW_NODE_TYPES).toContain('lane');
    expect(isFlowNodeType('pool')).toBe(true);
    expect(isFlowNodeType('lane')).toBe(true);

    const poolEntry = getNodeRegistryEntry('pool');
    expect(poolEntry?.defaultSize.width).toBeGreaterThan(400);

    const poolNode = flowNodeSchema.safeParse({
      id: 'pool-1',
      type: 'pool',
      position: { x: 50, y: 50 },
      width: 900,
      height: 500,
      data: {
        label: '业务协同泳道池',
        type: 'pool',
        orientation: 'horizontal',
        laneOrder: ['lane-frontend', 'lane-backend'],
        headerColor: '#4F46E5',
      },
    });
    expect(poolNode.success).toBe(true);

    const laneNode = flowNodeSchema.safeParse({
      id: 'lane-frontend',
      type: 'lane',
      position: { x: 0, y: 0 },
      parentId: 'pool-1',
      extent: 'parent',
      data: {
        label: '前端组',
        type: 'lane',
        laneTitle: '前端组',
      },
    });
    expect(laneNode.success).toBe(true);
  });

  it('validates createDiagramInputSchema and rejects blank title', () => {
    expect(createDiagramInputSchema.safeParse({ title: '支付清算流程' }).success).toBe(true);
    expect(createDiagramInputSchema.safeParse({ title: '   ' }).success).toBe(false);
  });

  it('validates awarenessUserStateSchema with clientId, nickname, color, cursor, selectedNodeIds', () => {
    const state = {
      clientId: 'client-abc-123',
      nickname: '王工',
      color: '#6366F1',
      cursor: { x: 300, y: 450 },
      selectedNodeIds: ['node-1'],
    };
    expect(awarenessUserStateSchema.safeParse(state).success).toBe(true);
  });
});

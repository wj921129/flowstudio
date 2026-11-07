import { describe, it, expect } from 'vitest';
import {
  flowNodeSchema,
  flowEdgeSchema,
  createDiagramInputSchema,
  updateDiagramInputSchema,
  awarenessUserStateSchema,
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

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { FLOW_NODE_TYPES, type FlowNodeType } from '@flowstudio/shared';
import { mcpOpSchema, applyOpsInputSchema } from '../src/mcp/op-schemas.js';

describe('工单14：服务端 mcpOpSchema 与共享节点类型 SSOT 契约对齐', () => {
  it('add_node 支持全部 21 种 FLOW_NODE_TYPES 节点类型', () => {
    for (const nodeType of FLOW_NODE_TYPES) {
      const parsed = mcpOpSchema.safeParse({
        op: 'add_node',
        label: `测试节点-${nodeType}`,
        type: nodeType,
      });
      expect(parsed.success, `add_node 应支持节点类型 ${nodeType}`).toBe(true);
    }
  });

  it('拒绝非法未知的节点类型', () => {
    const parsed = mcpOpSchema.safeParse({
      op: 'add_node',
      label: '非法节点',
      type: 'invalid-alien-type',
    });
    expect(parsed.success).toBe(false);
  });

  it('mcpOpSchema 的 flowNodeType 枚举基于 FLOW_NODE_TYPES 派生并全量覆盖', () => {
    const addNodeSchema = mcpOpSchema.options.find((o) => (o as any).shape?.op?.value === 'add_node');
    expect(addNodeSchema).toBeDefined();

    for (const nodeType of FLOW_NODE_TYPES) {
      const res = addNodeSchema!.safeParse({
        op: 'add_node',
        label: `节点-${nodeType}`,
        type: nodeType,
      });
      expect(res.success).toBe(true);
    }
  });
});

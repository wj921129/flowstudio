import { describe, it, expect } from 'vitest';
import {
  FLOW_NODE_TYPES,
  type FlowNodeType,
  flowNodeTypeSchema,
  NODE_REGISTRY_RECORD,
  getAllNodeRegistryEntries,
} from '../src/index.js';

describe('工单14：节点类型契约单一来源与全量对齐测试', () => {
  it('FLOW_NODE_TYPES 包含全部 21 种节点类型，且无重复', () => {
    const expectedTypes: FlowNodeType[] = [
      'start-end',
      'process',
      'decision',
      'io',
      'document',
      'subprocess',
      'database',
      'comment',
      'group',
      'pool',
      'lane',
      'uml-lifeline',
      'uml-activation',
      'uml-message',
      'arch-microservice',
      'arch-gateway',
      'arch-db-shard',
      'arch-cache',
      'arch-k8s-pod',
      'arch-docker',
      'rich-card',
    ];

    expect(FLOW_NODE_TYPES.length).toBe(21);
    expect(new Set(FLOW_NODE_TYPES).size).toBe(21);
    for (const t of expectedTypes) {
      expect(FLOW_NODE_TYPES).toContain(t);
    }
  });

  it('NODE_REGISTRY_RECORD 穷尽覆盖所有 FLOW_NODE_TYPES', () => {
    const entries = getAllNodeRegistryEntries();
    expect(entries.length).toBe(21);

    for (const type of FLOW_NODE_TYPES) {
      const entry = NODE_REGISTRY_RECORD[type];
      expect(entry).toBeDefined();
      expect(entry.type).toBe(type);
      expect(entry.label).toBeTruthy();
      expect(entry.category).toBeTruthy();
      expect(entry.defaultSize.width).toBeGreaterThan(0);
      expect(entry.defaultSize.height).toBeGreaterThan(0);
    }
  });

  it('flowNodeTypeSchema 成功校验所有合法节点类型并拒绝非法类型', () => {
    for (const type of FLOW_NODE_TYPES) {
      const res = flowNodeTypeSchema.safeParse(type);
      expect(res.success).toBe(true);
    }

    expect(flowNodeTypeSchema.safeParse('unknown-node-type').success).toBe(false);
    expect(flowNodeTypeSchema.safeParse('').success).toBe(false);
  });
});

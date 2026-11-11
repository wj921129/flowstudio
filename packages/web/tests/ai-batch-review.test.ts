import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFlowStore } from '../src/stores/flow-store';
import type { AiBatchRecord } from '@flowstudio/shared';

describe('AI Batch Visual Diff & Cherry-Pick Review (事后精审：逐项审阅台)', () => {
  beforeEach(() => {
    useFlowStore.getState().unbindCollaboration();
    useFlowStore.getState().resetDiagramState();
    vi.restoreAllMocks();
  });

  it('manages aiReviewActive and aiReviewBatchId state transitions', () => {
    expect(useFlowStore.getState().aiReviewActive).toBe(false);
    expect(useFlowStore.getState().aiReviewBatchId).toBeNull();

    useFlowStore.getState().setAiReviewMode(true, 'batch-ai-test-1');
    expect(useFlowStore.getState().aiReviewActive).toBe(true);
    expect(useFlowStore.getState().aiReviewBatchId).toBe('batch-ai-test-1');

    useFlowStore.getState().setAiReviewMode(false);
    expect(useFlowStore.getState().aiReviewActive).toBe(false);
    expect(useFlowStore.getState().aiReviewBatchId).toBeNull();
  });

  it('validates batch record diff payload structures for add/update/delete entities', () => {
    const mockBatch: AiBatchRecord = {
      batchId: 'batch-001',
      diagramId: 'diagram-test',
      summary: 'AI 自动优化分支与连线',
      status: 'active',
      createdAt: new Date().toISOString(),
      diffs: [
        {
          entityId: 'node-add-1',
          entityType: 'node',
          opType: 'add',
          beforeState: null,
          afterState: { id: 'node-add-1', type: 'process', data: { label: '新增节点' } },
        },
        {
          entityId: 'node-update-1',
          entityType: 'node',
          opType: 'update',
          beforeState: { id: 'node-update-1', type: 'decision', data: { label: '旧判断' } },
          afterState: { id: 'node-update-1', type: 'decision', data: { label: '新判断' } },
        },
        {
          entityId: 'node-del-1',
          entityType: 'node',
          opType: 'delete',
          beforeState: {
            id: 'node-del-1',
            type: 'comment',
            position: { x: 50, y: 80 },
            width: 120,
            height: 50,
            data: { label: '幽灵节点内容' },
          },
          afterState: null,
        },
      ],
    };

    // 验证批次中各类 diff 均有完整前后状态支持
    const adds = mockBatch.diffs.filter((d) => d.opType === 'add');
    const updates = mockBatch.diffs.filter((d) => d.opType === 'update');
    const deletes = mockBatch.diffs.filter((d) => d.opType === 'delete');

    expect(adds.length).toBe(1);
    expect(updates.length).toBe(1);
    expect(deletes.length).toBe(1);

    // 校验被删节点的幽灵预览必要属性 (位置/宽高/文案)
    const ghostNode = deletes[0].beforeState as any;
    expect(ghostNode.position.x).toBe(50);
    expect(ghostNode.width).toBe(120);
    expect(ghostNode.data.label).toBe('幽灵节点内容');
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { compareSnapshots, type FlowNode, type FlowEdge } from '@flowstudio/shared';
import { useSnapshotDiffStore } from '../src/features/snapshot/snapshot-diff-store';

describe('快照 Visual Diff 状态管理与交互流', () => {
  beforeEach(() => {
    useSnapshotDiffStore.getState().closeDiff();
  });

  it('正确启动 Visual Diff 并初始化变更摘要', () => {
    const baseNodes: FlowNode[] = [
      { id: 'n1', type: 'start-end', position: { x: 0, y: 0 }, data: { label: '开始', type: 'start-end' } },
    ];
    const targetNodes: FlowNode[] = [
      { id: 'n1', type: 'start-end', position: { x: 0, y: 0 }, data: { label: '开始', type: 'start-end' } },
      { id: 'n2', type: 'process', position: { x: 200, y: 0 }, data: { label: '处理中', type: 'process' } },
    ];
    const diff = compareSnapshots(baseNodes, [], targetNodes, [], '基线快照', '目标快照');

    useSnapshotDiffStore.getState().startDiff(diff, 'snap-1', 'snap-2');
    const state = useSnapshotDiffStore.getState();

    expect(state.isDiffActive).toBe(true);
    expect(state.baseId).toBe('snap-1');
    expect(state.targetId).toBe('snap-2');
    expect(state.diffResult?.summary.addedCount).toBe(1);
    expect(state.selectedItemId).toBe('n2');
  });

  it('支持聚焦条目与关闭比对重置状态', () => {
    const baseNodes: FlowNode[] = [
      { id: 'n1', type: 'start-end', position: { x: 0, y: 0 }, data: { label: '开始', type: 'start-end' } },
    ];
    const targetNodes: FlowNode[] = [
      { id: 'n1', type: 'start-end', position: { x: 50, y: 50 }, data: { label: '开始', type: 'start-end' } },
    ];
    const diff = compareSnapshots(baseNodes, [], targetNodes, []);

    useSnapshotDiffStore.getState().startDiff(diff);
    expect(useSnapshotDiffStore.getState().isDiffActive).toBe(true);

    useSnapshotDiffStore.getState().selectItem('n1');
    expect(useSnapshotDiffStore.getState().selectedItemId).toBe('n1');

    useSnapshotDiffStore.getState().dismissItem('n1');
    expect(useSnapshotDiffStore.getState().dismissedItemIds.has('n1')).toBe(true);

    useSnapshotDiffStore.getState().closeDiff();
    expect(useSnapshotDiffStore.getState().isDiffActive).toBe(false);
    expect(useSnapshotDiffStore.getState().diffResult).toBeNull();
  });
});

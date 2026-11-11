import { create } from 'zustand';
import type { SnapshotDiffResult } from '@flowstudio/shared';

export interface SnapshotDiffState {
  isDiffActive: boolean;
  diffResult: SnapshotDiffResult | null;
  baseId: string | null;
  targetId: string | null;
  selectedItemId: string | null;
  dismissedItemIds: Set<string>;
  startDiff: (diffResult: SnapshotDiffResult, baseId?: string, targetId?: string) => void;
  closeDiff: () => void;
  selectItem: (id: string | null) => void;
  dismissItem: (id: string) => void;
}

export const useSnapshotDiffStore = create<SnapshotDiffState>((set) => ({
  isDiffActive: false,
  diffResult: null,
  baseId: null,
  targetId: null,
  selectedItemId: null,
  dismissedItemIds: new Set(),
  startDiff: (diffResult, baseId = 'base', targetId = 'target') =>
    set({
      isDiffActive: true,
      diffResult,
      baseId,
      targetId,
      selectedItemId: diffResult.items[0]?.id ?? null,
      dismissedItemIds: new Set(),
    }),
  closeDiff: () =>
    set({
      isDiffActive: false,
      diffResult: null,
      baseId: null,
      targetId: null,
      selectedItemId: null,
      dismissedItemIds: new Set(),
    }),
  selectItem: (id) => set({ selectedItemId: id }),
  dismissItem: (id) =>
    set((state) => {
      const next = new Set(state.dismissedItemIds);
      next.add(id);
      return { dismissedItemIds: next };
    }),
}));

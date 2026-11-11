import React, { useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { X, ArrowRight, Eye, CheckCircle2, ChevronRight, Layers } from 'lucide-react';
import type { VisualDiffOpType } from '@flowstudio/shared';
import { useFlowStore } from '../../stores/flow-store';
import { useSnapshotDiffStore } from './snapshot-diff-store';

export const SnapshotDiffSidebar: React.FC = () => {
  const isDiffActive = useSnapshotDiffStore((s) => s.isDiffActive);
  const diffResult = useSnapshotDiffStore((s) => s.diffResult);
  const selectedItemId = useSnapshotDiffStore((s) => s.selectedItemId);
  const selectItem = useSnapshotDiffStore((s) => s.selectItem);
  const closeDiff = useSnapshotDiffStore((s) => s.closeDiff);

  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const reactFlow = useReactFlow();

  const [filterType, setFilterType] = useState<VisualDiffOpType | 'all'>('all');

  if (!isDiffActive || !diffResult) return null;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const edgeMap = new Map(edges.map((e) => [e.id, e]));

  const filteredItems =
    filterType === 'all' ? diffResult.items : diffResult.items.filter((i) => i.opType === filterType);

  const handleFocusItem = (id: string) => {
    selectItem(id);
    const item = diffResult.items.find((i) => i.id === id);
    if (!item) return;

    if (item.entityType === 'node') {
      const node = nodeMap.get(id) || (item.after as any) || (item.before as any);
      if (node?.position) {
        const cx = node.position.x + (node.width ?? 160) / 2;
        const cy = node.position.y + (node.height ?? 80) / 2;
        reactFlow.setCenter(cx, cy, { zoom: 1.1, duration: 350 });
      }
    } else {
      const edge = edgeMap.get(id) || (item.after as any) || (item.before as any);
      if (edge) {
        const s = nodeMap.get(edge.source);
        const t = nodeMap.get(edge.target);
        if (s?.position && t?.position) {
          const cx = (s.position.x + t.position.x) / 2;
          const cy = (s.position.y + t.position.y) / 2;
          reactFlow.setCenter(cx, cy, { zoom: 1.1, duration: 350 });
        }
      }
    }
  };

  return (
    <div className="absolute right-4 top-16 z-40 w-80 max-h-[calc(100vh-80px)] flex flex-col rounded-2xl border border-[var(--fs-border)] bg-[var(--fs-surface)]/95 backdrop-blur-md shadow-2xl overflow-hidden animate-in fade-in slide-in-from-right-4 duration-200">
      <div className="h-12 px-3.5 border-b border-[var(--fs-border)] flex items-center justify-between shrink-0 bg-[var(--fs-bg)]/40">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-purple-600 dark:text-purple-400" />
          <span className="text-xs font-bold text-[var(--fs-text)]">版本比对 (Visual Diff)</span>
        </div>
        <button
          type="button"
          onClick={closeDiff}
          title="退出比对"
          className="p-1 rounded-md text-[var(--fs-text-muted)] hover:text-[var(--fs-text)] hover:bg-[var(--fs-border)]/50 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-3.5 py-2.5 border-b border-[var(--fs-border)] bg-[var(--fs-surface)] flex flex-col gap-1.5 text-[11px]">
        <div className="flex items-center justify-between text-[var(--fs-text-muted)]">
          <span className="truncate max-w-[120px] font-medium" title={diffResult.baseLabel}>
            {diffResult.baseLabel}
          </span>
          <ArrowRight className="w-3 h-3 text-purple-500 shrink-0" />
          <span className="truncate max-w-[120px] font-semibold text-[var(--fs-text)]" title={diffResult.targetLabel}>
            {diffResult.targetLabel}
          </span>
        </div>

        <div className="flex items-center gap-1.5 pt-1">
          <button
            type="button"
            onClick={() => setFilterType('all')}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
              filterType === 'all'
                ? 'bg-[var(--fs-text)] text-[var(--fs-surface)]'
                : 'bg-[var(--fs-bg)] text-[var(--fs-text-muted)] hover:text-[var(--fs-text)]'
            }`}
          >
            全部 ({diffResult.items.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('add')}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
              filterType === 'add'
                ? 'bg-emerald-600 text-white'
                : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20'
            }`}
          >
            +{diffResult.summary.addedCount} 新增
          </button>
          <button
            type="button"
            onClick={() => setFilterType('update')}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
              filterType === 'update'
                ? 'bg-amber-600 text-white'
                : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20'
            }`}
          >
            ✎{diffResult.summary.updatedCount} 修改
          </button>
          <button
            type="button"
            onClick={() => setFilterType('delete')}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
              filterType === 'delete'
                ? 'bg-rose-600 text-white'
                : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20'
            }`}
          >
            ✕{diffResult.summary.deletedCount} 删除
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {filteredItems.length === 0 ? (
          <div className="h-32 flex flex-col items-center justify-center text-center p-3 text-[var(--fs-text-muted)]">
            <CheckCircle2 className="w-6 h-6 text-emerald-500 mb-1 opacity-70" />
            <span className="text-xs">该分类下无差异变更</span>
          </div>
        ) : (
          filteredItems.map((item) => {
            const isSelected = selectedItemId === item.id;
            const isAdd = item.opType === 'add';
            const isUpd = item.opType === 'update';

            const badgeCls = isAdd
              ? 'bg-emerald-500 text-white'
              : isUpd
              ? 'bg-amber-500 text-white'
              : 'bg-rose-500 text-white';

            return (
              <div
                key={item.id}
                onClick={() => handleFocusItem(item.id)}
                className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-start gap-2.5 ${
                  isSelected
                    ? 'border-purple-500 bg-purple-500/10 shadow-xs'
                    : 'border-[var(--fs-border)] bg-[var(--fs-surface)] hover:border-purple-500/40 hover:bg-[var(--fs-bg)]/40'
                }`}
              >
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 mt-0.5 ${badgeCls}`}>
                  {isAdd ? '新增' : isUpd ? '修改' : '删除'}
                </span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[var(--fs-text)] truncate">{item.label}</span>
                    <span className="text-[10px] text-[var(--fs-text-muted)] uppercase shrink-0 font-mono">
                      {item.entityType}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--fs-text-muted)] mt-0.5 line-clamp-2 leading-relaxed">
                    {item.description}
                  </p>
                </div>

                <ChevronRight className="w-3.5 h-3.5 text-[var(--fs-text-muted)] shrink-0 self-center opacity-60" />
              </div>
            );
          })
        )}
      </div>

      <div className="p-3 border-t border-[var(--fs-border)] bg-[var(--fs-bg)]/60 flex items-center justify-between text-[11px]">
        <span className="text-[var(--fs-text-muted)]">点击条目平滑平移聚焦画布</span>
        <button
          type="button"
          onClick={closeDiff}
          className="px-2.5 py-1 text-xs font-medium rounded-lg bg-[var(--fs-surface)] border border-[var(--fs-border)] hover:bg-[var(--fs-bg)] text-[var(--fs-text)] transition-colors cursor-pointer"
        >
          退出比对
        </button>
      </div>
    </div>
  );
};

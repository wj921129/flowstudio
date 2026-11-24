import React from 'react';
import { useFlowStore } from '../../stores/flow-store';
import { useCommentsStore } from '../comments';
import { usePresentationStore } from '../presentation';

export type RightPanelTabId = 'property' | 'copilot' | 'mermaid' | 'history' | 'review';

const TABS: Array<{ id: RightPanelTabId; label: string; writeOnly?: boolean }> = [
  { id: 'property', label: '属性' },
  { id: 'copilot', label: 'AI', writeOnly: true },
  { id: 'mermaid', label: 'Mermaid' },
  { id: 'history', label: '版本', writeOnly: true },
  { id: 'review', label: '评审' },
];

export const RightPanelTabs: React.FC<{ activeTab: RightPanelTabId }> = ({ activeTab }) => {
  const isReadOnly = usePresentationStore((s) => s.isReadOnly);
  const hasSelection = useFlowStore(
    (s) => s.selectedNodeIds.length > 0 || Boolean(s.selectedEdgeId)
  );

  const handleSwitch = (tab: RightPanelTabId) => {
    if (tab === activeTab) return;
    if (tab === 'property' && !hasSelection) return;
    const flow = useFlowStore.getState();
    const comments = useCommentsStore.getState();
    flow.setCopilotOpen(tab === 'copilot');
    flow.setMermaidDrawerOpen(tab === 'mermaid');
    flow.setHistoryDrawerOpen(tab === 'history');
    comments.setReviewDrawerOpen(tab === 'review');
  };

  return (
    <div className="px-2 py-1.5 border-b border-fs-border bg-fs-bg/40 flex items-center gap-1 shrink-0 select-none">
      {TABS.filter((t) => !(isReadOnly && t.writeOnly)).map((t) => {
        const isActive = t.id === activeTab;
        const disabled = t.id === 'property' && !hasSelection && !isActive;
        return (
          <button
            key={t.id}
            type="button"
            disabled={disabled}
            onClick={() => handleSwitch(t.id)}
            title={disabled ? '请先在画布中选中节点或连线' : t.label}
            className={`flex-1 py-1 px-1.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
              isActive
                ? 'bg-fs-surface text-fs-primary border border-fs-border shadow-xs'
                : disabled
                ? 'text-fs-text-muted/40 cursor-not-allowed'
                : 'text-fs-text-muted hover:text-fs-text hover:bg-fs-surface/60 cursor-pointer'
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
};

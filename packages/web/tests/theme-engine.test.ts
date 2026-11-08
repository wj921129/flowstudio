import { describe, it, expect } from 'vitest';
import { THEME_PRESETS } from '../src/features/sidebar/styles/theme-presets';
import { resolveNodeStyle } from '../src/features/sidebar/styles/style-resolver';
import { useSidebarStore } from '../src/features/sidebar/sidebar-store';

describe('Theme Engine & Sidebar Store', () => {
  it('provides 6 distinct theme presets with full semantic tokens', () => {
    expect(THEME_PRESETS.length).toBeGreaterThanOrEqual(6);
    const businessBlue = THEME_PRESETS.find((t) => t.id === 'business-blue');
    expect(businessBlue).toBeDefined();
    expect(businessBlue?.tokens.nodeBorder).toBe('#2563eb');
    expect(businessBlue?.tokens.nodeBg).toBe('#eff6ff');
    expect(businessBlue?.tokens.poolHeaderBg).toBe('#dbeafe');
  });

  it('preserves sticky note distinct yellow styling across all themes', () => {
    THEME_PRESETS.forEach((theme) => {
      const commentStyle = resolveNodeStyle('comment', theme);
      expect(commentStyle.fillColor).toMatch(/#fef/i);
      expect(commentStyle.borderColor).toBe('#ca8a04');
    });
  });

  it('resolves correct styles for standard flowchart process node', () => {
    const businessBlue = THEME_PRESETS.find((t) => t.id === 'business-blue')!;
    const style = resolveNodeStyle('process', businessBlue);
    expect(style.fillColor).toBe(businessBlue.tokens.nodeBg);
    expect(style.borderColor).toBe(businessBlue.tokens.nodeBorder);
    expect(style.fontColor).toBe(businessBlue.tokens.nodeText);
  });

  it('manages sidebar tab switching and collapse state', () => {
    const store = useSidebarStore.getState();
    store.setActiveTab('styles');
    expect(useSidebarStore.getState().activeTab).toBe('styles');

    store.toggleCollapsed();
    expect(useSidebarStore.getState().isCollapsed).toBe(true);

    store.toggleCollapsed();
    expect(useSidebarStore.getState().isCollapsed).toBe(false);

    store.setSearchKeyword('审批');
    expect(useSidebarStore.getState().searchKeyword).toBe('审批');

    store.setPreserveManualStyles(false);
    expect(useSidebarStore.getState().preserveManualStyles).toBe(false);
  });
});

import React from 'react';
import {
  LayoutTemplate,
  Shapes,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { useSidebarStore, type SidebarTab } from './sidebar-store';
import { TemplatesPanel } from './tabs/templates-panel';
import { ElementsPanel } from './tabs/elements-panel';
import { StylesPanel } from './tabs/styles-panel';
import type { DiagramTemplate } from './templates';
import type { ThemePreset } from './styles/types';

export interface SidebarDockProps {
  className?: string;
  onApplyTemplate?: (template: DiagramTemplate) => void;
  onApplyThemeToCanvas?: (theme: ThemePreset, preserveManual: boolean) => void;
}

const TABS: Array<{
  id: SidebarTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'templates', label: '图形模板', icon: LayoutTemplate },
  { id: 'elements', label: '图形元素', icon: Shapes },
  { id: 'styles', label: '元素风格', icon: Palette },
];

export const SidebarDock: React.FC<SidebarDockProps> = ({
  className = '',
  onApplyTemplate,
  onApplyThemeToCanvas,
}) => {
  const activeTab = useSidebarStore((s) => s.activeTab);
  const setActiveTab = useSidebarStore((s) => s.setActiveTab);
  const isCollapsed = useSidebarStore((s) => s.isCollapsed);
  const toggleCollapsed = useSidebarStore((s) => s.toggleCollapsed);

  const handleTabClick = (tabId: SidebarTab) => {
    if (isCollapsed) {
      setActiveTab(tabId);
    } else if (activeTab === tabId) {
      // 再次点击当前激活 tab 则收起侧边栏
      toggleCollapsed();
    } else {
      setActiveTab(tabId);
    }
  };

  return (
    <aside
      aria-label="工作区侧边坞"
      className={`h-full flex bg-fs-surface border-r border-fs-border shrink-0 select-none z-10 transition-all duration-200 ease-in-out ${className}`}
    >
      {/* 极简最左侧一级 Dock 导航条 (宽度 48px) */}
      <div className="w-12 h-full flex flex-col items-center justify-between py-2 border-r border-fs-border/60 bg-fs-bg/40 shrink-0">
        <div className="flex flex-col items-center gap-1.5 w-full">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = !isCollapsed && activeTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabClick(tab.id)}
                title={tab.label}
                aria-label={tab.label}
                aria-pressed={isActive}
                className={`relative w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
                  isActive
                    ? 'bg-fs-primary text-white shadow-xs'
                    : 'text-fs-text-muted hover:text-fs-text hover:bg-fs-surface'
                }`}
              >
                <Icon className="w-4 h-4" />
                {isActive && (
                  <span className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-1 h-3 rounded-r-full bg-fs-primary" />
                )}
              </button>
            );
          })}
        </div>

        {/* 底部展开/收起切换按钮 */}
        <button
          type="button"
          onClick={toggleCollapsed}
          title={isCollapsed ? '展开面板' : '收起面板'}
          aria-label={isCollapsed ? '展开面板' : '收起面板'}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-fs-text-muted hover:text-fs-text hover:bg-fs-surface transition-colors"
        >
          {isCollapsed ? (
            <PanelLeftOpen className="w-4 h-4" />
          ) : (
            <PanelLeftClose className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* 展开的二级功能面板容器 (宽度 250px) */}
      {!isCollapsed && (
        <div className="w-64 h-full flex flex-col overflow-hidden bg-fs-surface transition-opacity duration-150">
          {activeTab === 'templates' && (
            <TemplatesPanel onApplyTemplate={onApplyTemplate} />
          )}
          {activeTab === 'elements' && <ElementsPanel />}
          {activeTab === 'styles' && (
            <StylesPanel onApplyThemeToCanvas={onApplyThemeToCanvas} />
          )}
        </div>
      )}
    </aside>
  );
};

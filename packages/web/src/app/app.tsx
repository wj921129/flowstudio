import React from 'react';
import { VERSION } from '@flowstudio/shared';
import { Providers } from './providers';
import { ThemeToggle } from '../features/theme/theme-toggle';
import { ShapePalette } from '../features/sidebar/shape-palette';
import { FlowCanvas } from '../features/canvas/flow-canvas';
import { usePersistence } from '../hooks/use-persistence';

export const AppContent: React.FC = () => {
  // 启用自动水合与防抖持久化
  usePersistence();

  return (
    <div className="app-container h-screen flex flex-col bg-fs-bg text-fs-text overflow-hidden transition-colors">
      {/* 顶部应用导航栏 */}
      <header className="h-14 px-4 flex items-center justify-between border-b border-fs-border bg-fs-surface shrink-0 z-10 shadow-xs">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-bold tracking-tight">FlowStudio 流程画板</h1>
          <span className="text-xs text-fs-text-muted hidden sm:inline">
            新一代协同图表与流程可视化工作台
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs px-2.5 py-1 rounded-md bg-fs-bg border border-fs-border text-fs-text-muted">
            内核版本: {VERSION}
          </span>
          <ThemeToggle />
        </div>
      </header>

      {/* 画布核心工作区：左侧图形库侧边栏 + 右侧流程图主画布 */}
      <main className="flex-1 w-full relative overflow-hidden flex">
        <ShapePalette />
        <div className="flex-1 h-full relative overflow-hidden">
          <FlowCanvas />
        </div>
      </main>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <Providers>
      <AppContent />
    </Providers>
  );
};

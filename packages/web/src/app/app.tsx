import React from 'react';
import { VERSION } from '@flowstudio/shared';
import { Providers } from './providers';
import { ThemeToggle } from '../features/theme/theme-toggle';

export const AppContent: React.FC = () => {
  return (
    <div className="app-container min-h-screen bg-fs-bg text-fs-text p-6 transition-colors">
      <header className="flex items-center justify-between pb-4 border-b border-fs-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">FlowStudio 流程画板</h1>
          <p className="text-sm text-fs-text-muted mt-1">
            新一代协同图表与流程可视化工作台
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs px-2.5 py-1 rounded-md bg-fs-surface border border-fs-border text-fs-text-muted">
            内核版本: {VERSION}
          </span>
          <ThemeToggle />
        </div>
      </header>

      <main className="mt-8">
        <div className="p-6 rounded-xl border border-fs-border bg-fs-surface shadow-sm max-w-lg">
          <h2 className="text-base font-semibold mb-2">设计令牌与主题系统已就绪</h2>
          <p className="text-sm text-fs-text-muted">
            已成功接入深色/浅色模式切换与 Figma / Linear 风格设计令牌。
          </p>
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

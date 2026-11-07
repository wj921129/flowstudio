/**
 * @fileoverview FlowStudio 应用顶层主布局组件
 * @description 组装 TopBar 顶部导航栏、ShapePalette 左侧图形库、FlowCanvas 核心画布区与 PropertyPanel 右侧属性面板
 */

import React from 'react';
import { Providers } from './providers';
import { TopBar } from '../features/topbar/top-bar';
import { ShapePalette } from '../features/sidebar/shape-palette';
import { PropertyPanel } from '../features/sidebar/property-panel';
import { FlowCanvas } from '../features/canvas/flow-canvas';
import { usePersistence } from '../hooks/use-persistence';

/**
 * 编辑器主应用内容结构
 */
export const AppContent: React.FC = () => {
  // 启用自动水合与防抖持久化
  usePersistence();

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-fs-bg text-fs-text">
      <TopBar />
      <div className="relative flex flex-1 overflow-hidden">
        <ShapePalette />
        <main className="relative flex-1 overflow-hidden">
          <FlowCanvas />
        </main>
        <PropertyPanel />
      </div>
    </div>
  );
};

/**
 * 根组件（外层包裹全局 Provider）
 */
export const App: React.FC = () => {
  return (
    <Providers>
      <AppContent />
    </Providers>
  );
};

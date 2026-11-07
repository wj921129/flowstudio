/**
 * @fileoverview FlowStudio 应用顶层主布局组件与路由分发
 * @description 支持 #/ 看板首页 与 #/diagram/:id 协同编辑器双模式分发
 */

import React, { useState, useEffect, useRef } from 'react';
import { Providers } from './providers';
import { TopBar } from '../features/topbar/top-bar';
import { ShapePalette } from '../features/sidebar/shape-palette';
import { PropertyPanel } from '../features/sidebar/property-panel';
import { FlowCanvas } from '../features/canvas/flow-canvas';
import { CollaborationProvider } from '../features/collaboration/collaboration-provider';
import { DashboardPage } from '../features/dashboard/dashboard-page';
import { apiClient, generateMiniSvgThumbnail } from '../lib/api-client';
import { useFlowStore } from '../stores/flow-store';

/**
 * 协同编辑器内容工作区
 */
const EditorWorkspace: React.FC<{ diagramId: string }> = ({ diagramId }) => {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 节点变化防抖上报缩略图至服务端
  useEffect(() => {
    if (nodes.length === 0) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const thumbnail = generateMiniSvgThumbnail(nodes, edges);
        await apiClient.updateDiagram(diagramId, { thumbnail });
      } catch (err) {
        console.warn('[EditorWorkspace] 自动同步缩略图异常:', err);
      }
    }, 2000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [nodes, edges, diagramId]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-fs-bg text-fs-text">
      <TopBar diagramId={diagramId} />
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
 * 根应用组件（Hash 路由切换）
 */
export const App: React.FC = () => {
  const [currentHash, setCurrentHash] = useState(() => window.location.hash || '#/');

  useEffect(() => {
    const handleHashChange = () => {
      setCurrentHash(window.location.hash || '#/');
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // 解析路由参数
  const isDiagramRoute = currentHash.startsWith('#/diagram/');
  const diagramId = isDiagramRoute ? currentHash.replace('#/diagram/', '').split('?')[0] : null;

  return (
    <Providers>
      {isDiagramRoute && diagramId ? (
        <CollaborationProvider diagramId={diagramId}>
          <EditorWorkspace diagramId={diagramId} />
        </CollaborationProvider>
      ) : (
        <DashboardPage />
      )}
    </Providers>
  );
};

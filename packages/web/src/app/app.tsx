/**
 * @fileoverview FlowStudio 应用顶层主布局组件与路由分发
 * @description 支持 #/ 看板首页 与 #/diagram/:id 协同编辑器双模式分发
 */

import React, { useState, useEffect, useRef } from 'react';
import { Providers } from './providers';
import { TopBar } from '../features/topbar/top-bar';
import { SidebarDock } from '../features/sidebar/sidebar-dock';
import { PropertyPanel } from '../features/sidebar/property-panel';
import { FlowCanvas } from '../features/canvas/flow-canvas';
import { CollaborationProvider, useCollaboration } from '../features/collaboration/collaboration-provider';
import { DashboardPage } from '../features/dashboard/dashboard-page';
import { apiClient, generateMiniSvgThumbnail } from '../lib/api-client';
import { useFlowStore } from '../stores/flow-store';
import { useSidebarStore } from '../features/sidebar/sidebar-store';
import { getThemePreset, type ThemePreset } from '../features/sidebar/styles/theme-presets';
import { instantiateTemplate, type DiagramTemplate } from '../features/sidebar/templates';
import { TemplateConfirmModal } from '../features/sidebar/components/template-confirm-modal';
import { CopilotPanel } from '../features/copilot/copilot-panel';

/**
 * 协同编辑器内容工作区
 */
const EditorWorkspace: React.FC<{ diagramId: string }> = ({ diagramId }) => {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collab = useCollaboration();

  const [pendingTemplate, setPendingTemplate] = useState<DiagramTemplate | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

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

  const handleApplyTemplate = (template: DiagramTemplate) => {
    if (nodes.length === 0) {
      // 空白画布直接载入
      const activeThemeId = useSidebarStore.getState().activeThemeId;
      const currentTheme = getThemePreset(activeThemeId);
      const instance = instantiateTemplate(template, currentTheme);
      useFlowStore.getState().setDiagram(instance.nodes, instance.edges);

      const currentTitle = useFlowStore.getState().diagramTitle;
      if (!currentTitle || currentTitle === '未命名流程图') {
        useFlowStore.getState().setDiagramTitle(template.title);
        apiClient.updateDiagram(diagramId, { title: template.title }).catch(console.warn);
      }
    } else {
      // 非空白画布弹窗确认
      setPendingTemplate(template);
      setIsConfirmOpen(true);
    }
  };

  const handleConfirmOverwrite = async () => {
    if (!pendingTemplate) return;
    try {
      // 自动创建安全备份快照
      await apiClient.createSnapshot(diagramId, `[系统安全备份] 应用模板「${pendingTemplate.title}」前`);
    } catch (err) {
      console.warn('[EditorWorkspace] 创建自动安全快照失败:', err);
    }

    const activeThemeId = useSidebarStore.getState().activeThemeId;
    const currentTheme = getThemePreset(activeThemeId);
    const instance = instantiateTemplate(pendingTemplate, currentTheme);
    useFlowStore.getState().setDiagram(instance.nodes, instance.edges);

    const currentTitle = useFlowStore.getState().diagramTitle;
    if (!currentTitle || currentTitle === '未命名流程图') {
      useFlowStore.getState().setDiagramTitle(pendingTemplate.title);
      apiClient.updateDiagram(diagramId, { title: pendingTemplate.title }).catch(console.warn);
    }
  };

  const handleConfirmAppend = () => {
    if (!pendingTemplate) return;
    const activeThemeId = useSidebarStore.getState().activeThemeId;
    const currentTheme = getThemePreset(activeThemeId);
    const maxX = nodes.reduce((max, n) => Math.max(max, n.position.x + (n.width ?? 160)), 0);
    const offset = { x: maxX > 0 ? maxX + 100 : 80, y: 60 };
    const instance = instantiateTemplate(pendingTemplate, currentTheme, offset);
    useFlowStore.getState().appendSubgraph(instance.nodes, instance.edges);
  };

  const handleApplyThemeToCanvas = (theme: ThemePreset, preserveManual: boolean) => {
    if (collab?.bridge) {
      collab.bridge.applyTheme(theme, preserveManual);
    }
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-fs-bg text-fs-text">
      <TopBar diagramId={diagramId} />
      <div className="relative flex flex-1 overflow-hidden">
        <SidebarDock
          onApplyTemplate={handleApplyTemplate}
          onApplyThemeToCanvas={handleApplyThemeToCanvas}
        />
        <main className="relative flex-1 overflow-hidden">
          <FlowCanvas />
        </main>
        <PropertyPanel />
        <CopilotPanel />
      </div>

      <TemplateConfirmModal
        isOpen={isConfirmOpen}
        template={pendingTemplate}
        onClose={() => setIsConfirmOpen(false)}
        onOverwrite={handleConfirmOverwrite}
        onAppend={handleConfirmAppend}
      />
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

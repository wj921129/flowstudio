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
import { instantiateTemplate, TEMPLATES_REGISTRY, type DiagramTemplate } from '../features/sidebar/templates';
import { TemplateConfirmModal } from '../features/sidebar/components/template-confirm-modal';
import { CopilotPanel } from '../features/copilot/copilot-panel';
import { usePresentationStore, parseReadOnlyFromLocation } from '../features/presentation';
import { ErrorBoundary, exportEmergencyDiagramJson } from '../components/error-boundary';

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
  const appliedUrlTemplateRef = useRef(false);

  // 节点变化防抖上报缩略图至服务端（含清空画布时清空陈旧缩略图）
  const isSynced = collab?.isSynced ?? false;
  useEffect(() => {
    if (!isSynced) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const thumbnail = nodes.length === 0 ? '' : generateMiniSvgThumbnail(nodes, edges);
        await apiClient.updateDiagram(diagramId, { thumbnail });
      } catch (err) {
        console.warn('[EditorWorkspace] 自动同步缩略图异常:', err);
      }
    }, 2000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [nodes, edges, diagramId, isSynced]);

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

  useEffect(() => {
    if (!isSynced || appliedUrlTemplateRef.current) return;
    const hash = window.location.hash;
    const qIdx = hash.indexOf('?');
    if (qIdx === -1) return;
    const params = new URLSearchParams(hash.slice(qIdx + 1));
    const templateId = params.get('template');
    if (!templateId) return;
    appliedUrlTemplateRef.current = true;
    const matched = TEMPLATES_REGISTRY.find((t) => t.id === templateId);
    if (matched && useFlowStore.getState().nodes.length === 0) {
      handleApplyTemplate(matched);
    }
    params.delete('template');
    const qs = params.toString();
    const nextHash = qs ? `${hash.slice(0, qIdx)}?${qs}` : hash.slice(0, qIdx);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${nextHash}`);
  }, [isSynced, diagramId]);

  const handleConfirmOverwrite = async () => {
    if (!pendingTemplate) return;
    try {
      // 自动创建安全备份快照
      await apiClient.createSnapshot(diagramId, `[系统安全备份] 应用模板「${pendingTemplate.title}」前`, 'auto');
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

  const isPresenting = usePresentationStore((s) => s.isPresenting);
  const isReadOnly = usePresentationStore((s) => s.isReadOnly);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-fs-bg text-fs-text">
      {!isPresenting && <TopBar diagramId={diagramId} />}
      <div className="relative flex flex-1 overflow-hidden">
        {!isPresenting && !isReadOnly && (
          <ErrorBoundary
            title="侧边栏渲染异常"
            description="图形模板与元素面板遇到意外错误，画布与顶栏仍可正常使用。"
            variant="panel"
            className="border-r border-fs-border"
            resetKey={diagramId}
            onEmergencyExport={exportEmergencyDiagramJson}
          >
            <SidebarDock
              onApplyTemplate={handleApplyTemplate}
              onApplyThemeToCanvas={handleApplyThemeToCanvas}
            />
          </ErrorBoundary>
        )}
        <main className="relative flex-1 overflow-hidden">
          <ErrorBoundary
            title="画布渲染异常"
            description="当前部分图元或连线渲染失败，您可以点击重试，或先紧急导出当前画布数据。"
            variant="canvas"
            resetKey={diagramId}
            onEmergencyExport={exportEmergencyDiagramJson}
          >
            <FlowCanvas />
          </ErrorBoundary>
        </main>
        {!isPresenting && (
          <ErrorBoundary
            title="属性面板渲染异常"
            description="右侧属性检查器遇到意外错误，不影响画布编辑与数据保存。"
            variant="panel"
            className="border-l border-fs-border"
            resetKey={diagramId}
            onEmergencyExport={exportEmergencyDiagramJson}
          >
            <PropertyPanel />
          </ErrorBoundary>
        )}
        {!isPresenting && !isReadOnly && <CopilotPanel />}
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
      usePresentationStore.getState().setReadOnly(parseReadOnlyFromLocation());
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // 解析路由参数
  const isDiagramRoute = currentHash.startsWith('#/diagram/');
  const diagramId = isDiagramRoute ? currentHash.replace('#/diagram/', '').split('?')[0] : null;

  return (
    <ErrorBoundary
      title="应用发生意外错误"
      description="页面渲染遇到未知异常，您可以点击重试恢复，或先紧急导出当前图表 JSON 备份。"
      variant="fullscreen"
      onEmergencyExport={exportEmergencyDiagramJson}
    >
      <Providers>
        {isDiagramRoute && diagramId ? (
          <CollaborationProvider diagramId={diagramId}>
            <EditorWorkspace diagramId={diagramId} />
          </CollaborationProvider>
        ) : (
          <DashboardPage />
        )}
      </Providers>
    </ErrorBoundary>
  );
};

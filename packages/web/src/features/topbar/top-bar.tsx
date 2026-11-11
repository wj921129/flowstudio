/**
 * @fileoverview 顶部导航栏组件 (TopBar)
 * @description 48px 高度毛玻璃风格顶部导航栏，包含返回看板、可编辑图表标题、在线协作者头像、分享链接、统计徽标、导出菜单与主题切换
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowLeft,
  Download,
  ChevronDown,
  Image,
  FileCode,
  FileJson,
  FileOutput,
  Globe,
  Check,
  Share2,
  Sparkles,
  History,
  Compass,
  Upload,
  Code2,
  Bot,
  Tv,
  Shield,
  Lock,
  Copy,
} from 'lucide-react';
import { DEFAULT_DIAGRAM_TITLE, parseDrawioXml, parseBpmnXml, diagramToBpmnXml } from '@flowstudio/shared';
import { useFlowStore } from '../../stores/flow-store';
import { usePresentationStore } from '../presentation';
import { ThemeToggle } from '../theme/theme-toggle';
import { sanitizeNodes, sanitizeEdges } from '../../lib/storage';
import { CollaboratorAvatars } from '../collaboration/collaborator-avatars';
import { apiClient } from '../../lib/api-client';
import { layoutDiagram } from '../canvas/layout/elk-layout';
import { SnapshotDrawer } from '../snapshot/snapshot-drawer';
import { MermaidDrawer } from '../mermaid/mermaid-drawer';
import { buildStandaloneHtml } from '../../lib/standalone-html';
import {
  exportToPng,
  exportToSvg,
  exportToJson,
  downloadFile,
  validateAndParseDiagramJson,
} from '../../lib/export-utils';

export interface TopBarProps {
  /** 当前图表 ID */
  diagramId?: string;
  /** 附加样式类名 */
  className?: string;
}

export const TopBar: React.FC<TopBarProps> = ({ diagramId, className = '' }) => {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const storeTitle = useFlowStore((s) => s.diagramTitle);
  const setDiagramTitle = useFlowStore((s) => s.setDiagramTitle);
  const setDiagram = useFlowStore((s) => s.setDiagram);
  const spotlightActive = useFlowStore((s) => s.spotlightActive);
  const toggleSpotlightMode = useFlowStore((s) => s.toggleSpotlightMode);
  const mermaidDrawerOpen = useFlowStore((s) => s.mermaidDrawerOpen);
  const setMermaidDrawerOpen = useFlowStore((s) => s.setMermaidDrawerOpen);
  const copilotOpen = useFlowStore((s) => s.copilotOpen);
  const setCopilotOpen = useFlowStore((s) => s.setCopilotOpen);

  const isReadOnly = usePresentationStore((s) => s.isReadOnly);
  const isWatermarkEnabled = usePresentationStore((s) => s.isWatermarkEnabled);
  const toggleWatermark = usePresentationStore((s) => s.toggleWatermark);
  const startPresentation = usePresentationStore((s) => s.startPresentation);

  const [editingTitle, setEditingTitle] = useState(storeTitle);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isLayouting, setIsLayouting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const exportDropdownRef = useRef<HTMLDivElement>(null);
  const shareDropdownRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const jsonFileInputRef = useRef<HTMLInputElement>(null);
  const isEscapingRef = useRef(false);

  // 当外部/远端 storeTitle 变化时同步更新编辑缓存
  useEffect(() => {
    setEditingTitle(storeTitle);
  }, [storeTitle]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditingTitle(e.target.value);
  };

  const handleTitleBlur = async () => {
    if (isEscapingRef.current) {
      isEscapingRef.current = false;
      return;
    }
    const finalTitle = editingTitle.trim() || DEFAULT_DIAGRAM_TITLE;
    setEditingTitle(finalTitle);
    setDiagramTitle(finalTitle);

    if (diagramId) {
      try {
        await apiClient.updateDiagram(diagramId, { title: finalTitle });
      } catch (err) {
        console.error('[TopBar] 同步标题失败:', err);
      }
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      titleInputRef.current?.blur();
    } else if (e.key === 'Escape') {
      isEscapingRef.current = true;
      setEditingTitle(storeTitle);
      titleInputRef.current?.blur();
    }
  };

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2500);
  }, []);

  const handleCopyEditLink = async () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('readonly');
      url.searchParams.delete('mode');
      url.searchParams.delete('view');
      const cleanUrl = url.toString().replace('?readonly=true', '').replace('&readonly=true', '');
      await navigator.clipboard.writeText(cleanUrl);
      showToast('已复制局域网协作编辑链接');
      setIsShareOpen(false);
    } catch {
      showToast('复制失败，请手动复制浏览器地址栏');
    }
  };

  const handleCopyReadOnlyLink = async () => {
    try {
      const currentUrl = window.location.href;
      let targetUrl = currentUrl;
      if (!targetUrl.includes('readonly=true')) {
        targetUrl = targetUrl.includes('?')
          ? `${targetUrl}&readonly=true`
          : targetUrl.includes('#')
          ? `${targetUrl}?readonly=true`
          : `${targetUrl}?readonly=true`;
      }
      await navigator.clipboard.writeText(targetUrl);
      showToast('已复制只读安全分享链接 (?readonly=true)');
      setIsShareOpen(false);
    } catch {
      showToast('复制失败，请手动复制浏览器地址栏');
    }
  };

  const handleAutoLayout = async () => {
    if (nodes.length === 0 || isLayouting) return;
    try {
      setIsLayouting(true);
      const res = await layoutDiagram(nodes, edges);
      setDiagram(res.nodes, res.edges);
      showToast('自动排版已完成');
    } catch (err) {
      console.error('[TopBar] 自动排版失败:', err);
      showToast('自动排版异常，已保留原样');
    } finally {
      setIsLayouting(false);
    }
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isReadOnly) {
      showToast('当前处于只读安全模式，禁止导入修改画布');
      e.target.value = '';
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      const lowerName = file.name.toLowerCase();

      try {
        if (lowerName.endsWith('.drawio') || /<mxfile|<mxGraphModel/i.test(content)) {
          const res = await parseDrawioXml(content);
          if (nodes.length > 0) {
            const ok = window.confirm(
              `当前画布已有 ${nodes.length} 个节点。\n点击「确定」将覆盖当前画布内容；点击「取消」中止操作。`
            );
            if (!ok) return;
          }
          setDiagram(res.nodes, res.edges);
          showToast(`已成功从 Draw.io 导入 ${res.nodes.length} 个节点`);
          return;
        }

        if (lowerName.endsWith('.bpmn') || (/<(?:bpmn:)?definitions/i.test(content) && /<process/i.test(content))) {
          const res = parseBpmnXml(content);
          if (nodes.length > 0) {
            const ok = window.confirm(
              `当前画布已有 ${nodes.length} 个节点。\n点击「确定」将覆盖当前画布内容；点击「取消」中止操作。`
            );
            if (!ok) return;
          }
          setDiagram(res.nodes, res.edges);
          showToast(`已成功从 BPMN 导入 ${res.nodes.length} 个节点`);
          return;
        }

        const res = validateAndParseDiagramJson(content);
        if (res.success) {
          if (nodes.length > 0) {
            const ok = window.confirm(
              `当前画布已有 ${nodes.length} 个节点。\n点击「确定」将覆盖当前画布内容并导入；点击「取消」中止操作。`
            );
            if (!ok) return;
          }

          setDiagram(res.nodes || [], res.edges || []);
          if (res.title) {
            setDiagramTitle(res.title);
          }
          showToast('已成功导入图表工程');
          return;
        }

        showToast(res.error || '未识别的文件格式，仅支持 JSON / Draw.io / BPMN 2.0');
      } catch (err: any) {
        showToast(`导入失败: ${err?.message || '文件解析错误'}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        exportDropdownRef.current &&
        !exportDropdownRef.current.contains(event.target as Node)
      ) {
        setIsExportOpen(false);
      }
      if (
        shareDropdownRef.current &&
        !shareDropdownRef.current.contains(event.target as Node)
      ) {
        setIsShareOpen(false);
      }
    };

    if (isExportOpen || isShareOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isExportOpen, isShareOpen]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const handleExport = async (format: 'png' | 'svg' | 'json' | 'bpmn' | 'html') => {
    setIsExportOpen(false);

    try {
      if (format === 'json') {
        exportToJson(nodes, edges, storeTitle);
        showToast('已成功导出 JSON 图表文件');
      } else if (format === 'svg') {
        exportToSvg(nodes, edges, storeTitle);
        showToast('已成功导出无损矢量 SVG');
      } else if (format === 'png') {
        showToast('正在生成 Retina 超清 PNG...');
        await exportToPng(nodes, edges, storeTitle, 2);
        showToast('已成功导出高清 PNG 图片');
      } else if (format === 'bpmn') {
        const xml = diagramToBpmnXml(nodes, edges, storeTitle);
        downloadFile(`${storeTitle || 'diagram'}.bpmn`, xml, 'application/xml');
        showToast('已成功导出 BPMN 2.0 规范 XML');
      } else if (format === 'html') {
        const html = buildStandaloneHtml(nodes, edges, storeTitle);
        downloadFile(`${storeTitle || 'diagram'}.html`, html, 'text/html');
        showToast('已成功导出单文件交互式离线 HTML');
      }
    } catch (error: any) {
      console.error('[TopBar] 导出失败:', error);
      showToast(`导出失败: ${error?.message || '请检查浏览器下载权限'}`);
    }
  };

  return (
    <header
      className={`h-12 border-b border-fs-border bg-fs-surface/85 backdrop-blur-md px-4 flex items-center justify-between select-none z-20 shrink-0 ${className}`}
    >
      {/* 左侧：返回图列表 + 分隔线 + 可编辑图表标题 */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={() => {
            window.location.hash = '#/';
          }}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-fs-border bg-fs-surface text-fs-text-muted hover:text-fs-text hover:bg-fs-bg transition-colors cursor-pointer text-xs font-medium"
          title="返回图表列表"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">图表列表</span>
        </button>

        <div className="h-4 w-px bg-fs-border shrink-0" />

        <div className="relative flex items-center gap-2">
          <input
            ref={titleInputRef}
            type="text"
            readOnly={isReadOnly}
            disabled={isReadOnly}
            value={editingTitle}
            onChange={handleTitleChange}
            onBlur={handleTitleBlur}
            onKeyDown={handleTitleKeyDown}
            aria-label="图表标题"
            placeholder={DEFAULT_DIAGRAM_TITLE}
            className={`px-2 py-0.5 text-xs sm:text-sm font-medium rounded-md bg-transparent max-w-[140px] sm:max-w-xs truncate transition-colors ${
              isReadOnly
                ? 'cursor-default text-fs-text opacity-90 border border-transparent'
                : 'hover:bg-fs-bg/60 focus:bg-fs-surface border border-transparent hover:border-fs-border focus:border-fs-primary focus:outline-none focus:ring-1 focus:ring-fs-primary text-fs-text'
            }`}
          />
          {isReadOnly && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-medium select-none">
              <Lock className="w-3 h-3" />
              <span>只读模式</span>
            </span>
          )}
        </div>
      </div>

      {/* 右侧：在线头像 + 分享链接 + 节点统计 + 导出 + 主题切换 */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* 协作者在线头像 */}
        <CollaboratorAvatars />

        {/* 分享链接下拉菜单 */}
        <div className="relative" ref={shareDropdownRef}>
          <button
            type="button"
            onClick={() => setIsShareOpen(!isShareOpen)}
            title="分享协作或只读链接"
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-fs-border bg-fs-surface text-fs-text hover:bg-fs-bg hover:border-fs-primary/50 transition-colors cursor-pointer shadow-xs"
          >
            <Share2 className="w-3.5 h-3.5 text-fs-primary" />
            <span className="hidden sm:inline">分享</span>
            <ChevronDown className={`w-3 h-3 text-fs-text-muted transition-transform duration-150 ${isShareOpen ? 'rotate-180' : ''}`} />
          </button>

          {isShareOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-56 rounded-xl border border-fs-border bg-fs-surface shadow-xl py-1.5 z-50 text-xs animate-in fade-in zoom-in-95 duration-100 select-text">
              <div className="px-3 py-1 text-[11px] font-medium text-fs-text-muted border-b border-fs-border mb-1">
                分享此图表
              </div>
              <button
                type="button"
                onClick={handleCopyEditLink}
                className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-fs-bg transition-colors cursor-pointer text-fs-text"
              >
                <div className="flex flex-col">
                  <span className="font-semibold text-xs">协作编辑链接</span>
                  <span className="text-[10px] text-fs-text-muted">允许局域网成员共同编辑</span>
                </div>
                <Copy className="w-3.5 h-3.5 text-fs-text-muted" />
              </button>
              <button
                type="button"
                onClick={handleCopyReadOnlyLink}
                className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-fs-bg transition-colors cursor-pointer text-fs-text"
              >
                <div className="flex flex-col">
                  <span className="font-semibold text-xs text-amber-600 dark:text-amber-400">只读安全分享链接</span>
                  <span className="text-[10px] text-fs-text-muted">禁用写操作，仅允许查看</span>
                </div>
                <Lock className="w-3.5 h-3.5 text-amber-500" />
              </button>
            </div>
          )}
        </div>

        {/* 全屏演讲演示按钮 */}
        <button
          type="button"
          onClick={() => startPresentation(nodes)}
          disabled={nodes.length === 0}
          title="开启全屏演讲演示模式 (Space/方向键镜头平滑推进)"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border border-fs-border bg-fs-surface text-fs-text hover:bg-fs-bg hover:border-emerald-500/50 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
        >
          <Tv className="w-3.5 h-3.5 text-emerald-500" />
          <span className="hidden sm:inline">演示</span>
        </button>

        {/* 动态安全防泄密水印开关 */}
        <button
          type="button"
          onClick={toggleWatermark}
          title="切换动态安全防泄密水印"
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors cursor-pointer shadow-xs ${
            isWatermarkEnabled
              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 font-semibold'
              : 'border-fs-border bg-fs-surface text-fs-text-muted hover:bg-fs-bg'
          }`}
        >
          <Shield className={`w-3.5 h-3.5 ${isWatermarkEnabled ? 'text-amber-500' : 'text-zinc-400'}`} />
          <span className="hidden sm:inline">{isWatermarkEnabled ? '水印开' : '水印'}</span>
        </button>

        {/* 节点与连线统计徽标 */}
        <div
          className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-fs-bg border border-fs-border text-fs-text-muted select-none font-medium"
          title={`画布包含 ${nodes.length} 个节点，${edges.length} 条连线`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-fs-primary animate-pulse" />
          <span>
            {nodes.length} 节点 · {edges.length} 连线
          </span>
        </div>

        {/* 链路走查聚光灯开关 */}
        <button
          type="button"
          onClick={() => toggleSpotlightMode()}
          title="开启因果链路聚光灯走查（支持 Alt+点击 节点/连线 快捷高亮完整上下游）"
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors cursor-pointer shadow-xs ${
            spotlightActive
              ? 'bg-blue-600 text-white border-blue-600 shadow-blue-500/20'
              : 'border-fs-border bg-fs-surface text-fs-text hover:bg-fs-bg hover:border-blue-500/50'
          }`}
        >
          <Compass className={`w-3.5 h-3.5 ${spotlightActive ? 'text-white' : 'text-blue-500'}`} />
          <span>{spotlightActive ? '走查中' : '链路走查'}</span>
        </button>

        {/* 一键自动排版 */}
        {!isReadOnly && (
          <button
            type="button"
            onClick={handleAutoLayout}
            disabled={isLayouting || nodes.length === 0}
            title="基于 elkjs 执行一键整图/泳道自动正交排版"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border border-fs-border bg-fs-surface text-fs-text hover:bg-fs-bg hover:border-fs-primary/50 transition-colors cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Sparkles className={`w-3.5 h-3.5 text-fs-primary ${isLayouting ? 'animate-spin' : ''}`} />
            <span>{isLayouting ? '排版中...' : '自动排版'}</span>
          </button>
        )}

        {/* AI Copilot 交互面板开关 */}
        {!isReadOnly && (
          <button
            type="button"
            onClick={() => setCopilotOpen(!copilotOpen)}
            title="打开画布内置 AI Copilot 对话交互面板 (Cmd/Ctrl+J)"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors cursor-pointer shadow-xs ${
              copilotOpen
                ? 'bg-purple-600 text-white border-purple-600 shadow-purple-500/20'
                : 'border-fs-border bg-fs-surface text-fs-text hover:bg-fs-bg hover:border-purple-500/50'
            }`}
          >
            <Bot className={`w-3.5 h-3.5 ${copilotOpen ? 'text-white' : 'text-purple-600 dark:text-purple-400'}`} />
            <span>AI Copilot</span>
          </button>
        )}

        {/* </> Mermaid 双向同频抽屉开关 */}
        <button
          type="button"
          onClick={() => setMermaidDrawerOpen(!mermaidDrawerOpen)}
          title="打开 Mermaid 代码双向同频抽屉（支持实时导出与增量融合上屏）"
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors cursor-pointer shadow-xs ${
            mermaidDrawerOpen
              ? 'bg-indigo-600 text-white border-indigo-600 shadow-indigo-500/20'
              : 'border-fs-border bg-fs-surface text-fs-text hover:bg-fs-bg hover:border-indigo-500/50'
          }`}
        >
          <Code2 className={`w-3.5 h-3.5 ${mermaidDrawerOpen ? 'text-white' : 'text-indigo-500'}`} />
          <span>Mermaid</span>
        </button>

        {/* 历史版本快照 */}
        {!isReadOnly && (
          <button
            type="button"
            onClick={() => setIsHistoryOpen(true)}
            title="查看历史版本快照与无损差异恢复"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border border-fs-border bg-fs-surface text-fs-text hover:bg-fs-bg hover:border-purple-500/50 transition-colors cursor-pointer shadow-xs"
          >
            <History className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
            <span>版本</span>
          </button>
        )}

        {/* 导出菜单 */}
        <div className="relative" ref={exportDropdownRef}>
          <button
            type="button"
            onClick={() => setIsExportOpen(!isExportOpen)}
            aria-expanded={isExportOpen}
            aria-haspopup="true"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border border-fs-border bg-fs-surface text-fs-text hover:bg-fs-bg hover:border-fs-primary/50 transition-colors cursor-pointer shadow-xs"
          >
            <Download className="w-3.5 h-3.5 text-fs-text-muted" />
            <span>导出</span>
            <ChevronDown
              className={`w-3 h-3 text-fs-text-muted transition-transform duration-150 ${
                isExportOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {isExportOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-48 rounded-xl border border-fs-border bg-fs-surface shadow-lg py-1.5 z-50 text-xs animate-in fade-in zoom-in-95 duration-100">
              <div className="px-3 py-1 text-[11px] font-medium text-fs-text-muted border-b border-fs-border mb-1">
                导出图表格式
              </div>
              <button
                type="button"
                onClick={() => handleExport('png')}
                className="w-full px-3 py-2 flex items-center gap-2.5 text-left text-fs-text hover:bg-fs-bg transition-colors cursor-pointer"
              >
                <Image className="w-4 h-4 text-fs-text-muted shrink-0" />
                <div className="flex flex-col">
                  <span className="font-medium">导出为 PNG</span>
                  <span className="text-[10px] text-fs-text-muted">高分辨率位图图片</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleExport('svg')}
                className="w-full px-3 py-2 flex items-center gap-2.5 text-left text-fs-text hover:bg-fs-bg transition-colors cursor-pointer"
              >
                <FileCode className="w-4 h-4 text-fs-text-muted shrink-0" />
                <div className="flex flex-col">
                  <span className="font-medium">导出为 SVG</span>
                  <span className="text-[10px] text-fs-text-muted">无损矢量图形文件</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleExport('json')}
                className="w-full px-3 py-2 flex items-center gap-2.5 text-left text-fs-text hover:bg-fs-bg transition-colors cursor-pointer"
              >
                <FileJson className="w-4 h-4 text-fs-text-muted shrink-0" />
                <div className="flex flex-col">
                  <span className="font-medium">导出为 JSON</span>
                  <span className="text-[10px] text-fs-text-muted">完整画布工程文件</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleExport('bpmn')}
                className="w-full px-3 py-2 flex items-center gap-2.5 text-left text-fs-text hover:bg-fs-bg transition-colors cursor-pointer"
              >
                <FileOutput className="w-4 h-4 text-fs-text-muted shrink-0" />
                <div className="flex flex-col">
                  <span className="font-medium">导出为 BPMN 2.0</span>
                  <span className="text-[10px] text-fs-text-muted">标准流程建模 XML</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleExport('html')}
                className="w-full px-3 py-2 flex items-center gap-2.5 text-left text-fs-text hover:bg-fs-bg transition-colors cursor-pointer"
              >
                <Globe className="w-4 h-4 text-fs-text-muted shrink-0" />
                <div className="flex flex-col">
                  <span className="font-medium">导出离线 HTML</span>
                  <span className="text-[10px] text-fs-text-muted">单文件交互式独立查看</span>
                </div>
              </button>

              {/* 导入外部图表（只读模式下隐藏） */}
              {!isReadOnly && (
                <>
                  <div className="h-px bg-fs-border my-1" />
                  <button
                    type="button"
                    onClick={() => {
                      setIsExportOpen(false);
                      jsonFileInputRef.current?.click();
                    }}
                    className="w-full px-3 py-2 flex items-center gap-2.5 text-left text-fs-text hover:bg-fs-bg transition-colors cursor-pointer"
                  >
                    <Upload className="w-4 h-4 text-fs-primary shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-medium text-fs-primary">导入外部图表</span>
                      <span className="text-[10px] text-fs-text-muted">支持 JSON / Draw.io / BPMN</span>
                    </div>
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* 隐藏的文件选择器 */}
        <input
          ref={jsonFileInputRef}
          type="file"
          accept=".json,.drawio,.bpmn,.xml"
          className="hidden"
          onChange={handleImportFile}
        />

        <div className="h-4 w-px bg-fs-border" />

        {/* 主题切换开关 */}
        <ThemeToggle />
      </div>

      {/* 悬浮 Toast 提示 */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-14 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-fs-surface text-fs-text border border-fs-border shadow-lg text-xs font-medium animate-in fade-in slide-in-from-top-2 duration-200 select-none"
        >
          <Check className="w-3.5 h-3.5 text-fs-primary shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 历史版本快照抽屉 */}
      <SnapshotDrawer
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        diagramId={diagramId}
        onToast={showToast}
      />

      {/* Mermaid 语义双向同频抽屉 */}
      <MermaidDrawer
        isOpen={mermaidDrawerOpen}
        onClose={() => setMermaidDrawerOpen(false)}
      />
    </header>
  );
};

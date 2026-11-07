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
  Check,
  Share2,
} from 'lucide-react';
import { DEFAULT_DIAGRAM_TITLE } from '@flowstudio/shared';
import { useFlowStore } from '../../stores/flow-store';
import { ThemeToggle } from '../theme/theme-toggle';
import { sanitizeNodes, sanitizeEdges } from '../../lib/storage';
import { CollaboratorAvatars } from '../collaboration/collaborator-avatars';
import { apiClient } from '../../lib/api-client';

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

  const [editingTitle, setEditingTitle] = useState(storeTitle);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const exportDropdownRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
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

  const handleCopyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast('已复制局域网协作链接');
    } catch {
      showToast('复制失败，请手动复制浏览器地址栏');
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        exportDropdownRef.current &&
        !exportDropdownRef.current.contains(event.target as Node)
      ) {
        setIsExportOpen(false);
      }
    };

    if (isExportOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isExportOpen]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const handleExport = (format: 'png' | 'svg' | 'json') => {
    setIsExportOpen(false);

    if (format === 'json') {
      try {
        const sanitizeFileName = (storeTitle || 'flowstudio-diagram')
          .replace(/[/\\?%*:|"<>]/g, '_')
          .trim() || 'flowstudio-diagram';

        const exportData = {
          title: storeTitle,
          version: '1.0',
          exportedAt: new Date().toISOString(),
          nodes: sanitizeNodes(nodes),
          edges: sanitizeEdges(edges),
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], {
          type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${sanitizeFileName}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        showToast('已成功导出 JSON 图表数据');
      } catch (error) {
        console.error('[TopBar] 导出 JSON 数据失败:', error);
        showToast('导出 JSON 失败，请检查浏览器权限');
      }
      return;
    }

    if (format === 'png') {
      showToast('PNG 导出功能开发中，敬请期待');
      return;
    }

    if (format === 'svg') {
      showToast('SVG 导出功能开发中，敬请期待');
      return;
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

        <div className="relative flex items-center">
          <input
            ref={titleInputRef}
            type="text"
            value={editingTitle}
            onChange={handleTitleChange}
            onBlur={handleTitleBlur}
            onKeyDown={handleTitleKeyDown}
            aria-label="图表标题"
            placeholder={DEFAULT_DIAGRAM_TITLE}
            className="px-2 py-0.5 text-xs sm:text-sm font-medium rounded-md bg-transparent hover:bg-fs-bg/60 focus:bg-fs-surface border border-transparent hover:border-fs-border focus:border-fs-primary focus:outline-none focus:ring-1 focus:ring-fs-primary text-fs-text transition-colors max-w-[140px] sm:max-w-xs truncate"
          />
        </div>
      </div>

      {/* 右侧：在线头像 + 分享链接 + 节点统计 + 导出 + 主题切换 */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* 协作者在线头像 */}
        <CollaboratorAvatars />

        {/* 分享链接按钮 */}
        <button
          type="button"
          onClick={handleCopyShareLink}
          title="复制局域网协作链接"
          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-fs-border bg-fs-surface text-fs-text hover:bg-fs-bg hover:border-fs-primary/50 transition-colors cursor-pointer shadow-xs"
        >
          <Share2 className="w-3.5 h-3.5 text-fs-primary" />
          <span className="hidden sm:inline">分享</span>
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
            </div>
          )}
        </div>

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
    </header>
  );
};

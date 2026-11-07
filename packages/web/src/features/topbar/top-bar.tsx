/**
 * @fileoverview 顶部导航栏组件 (TopBar)
 * @description 48px 高度毛玻璃风格顶部导航栏，包含品牌 Logo、可编辑图表标题、节点/连线统计徽标、导出菜单、主题切换及外部链接
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Workflow,
  Download,
  ChevronDown,
  Image,
  FileCode,
  FileJson,
  Github,
  Check,
} from 'lucide-react';
import { DEFAULT_DIAGRAM_TITLE } from '@flowstudio/shared';
import { useFlowStore } from '../../stores/flow-store';
import { ThemeToggle } from '../theme/theme-toggle';

/** 图表标题本地持久化存储键 */
const DIAGRAM_TITLE_STORAGE_KEY = 'fs-diagram-title';

export interface TopBarProps {
  /** 附加样式类名 */
  className?: string;
}

/**
 * 顶部导航栏组件
 */
export const TopBar: React.FC<TopBarProps> = ({ className = '' }) => {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);

  // 图表标题状态（支持本地存储恢复与编辑更新）
  const [title, setTitle] = useState<string>(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      const savedTitle = window.localStorage.getItem(DIAGRAM_TITLE_STORAGE_KEY);
      if (savedTitle && savedTitle.trim()) {
        return savedTitle.trim();
      }
    }
    return DEFAULT_DIAGRAM_TITLE;
  });

  // 临时编辑缓存（用于按 Esc 时回退）
  const [editingTitle, setEditingTitle] = useState(title);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const exportDropdownRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // 标题变更同步至本地存储
  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditingTitle(e.target.value);
  };

  const handleTitleBlur = () => {
    const finalTitle = editingTitle.trim() || DEFAULT_DIAGRAM_TITLE;
    setTitle(finalTitle);
    setEditingTitle(finalTitle);
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(DIAGRAM_TITLE_STORAGE_KEY, finalTitle);
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      titleInputRef.current?.blur();
    } else if (e.key === 'Escape') {
      setEditingTitle(title);
      titleInputRef.current?.blur();
    }
  };

  // 显示临时轻量 Toast 提示
  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2500);
  }, []);

  // 点击外部关闭导出下拉菜单
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

  // 组件卸载时清除 Toast 定时器
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // 导出功能处理
  const handleExport = (format: 'png' | 'svg' | 'json') => {
    setIsExportOpen(false);

    if (format === 'json') {
      try {
        const exportData = {
          title,
          version: '1.0',
          exportedAt: new Date().toISOString(),
          nodes,
          edges,
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], {
          type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${title || 'flowstudio-diagram'}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        console.info('[TopBar] 成功导出 JSON 流程图工程数据', exportData);
        showToast('已成功导出 JSON 图表数据');
      } catch (error) {
        console.error('[TopBar] 导出 JSON 数据失败:', error);
        showToast('导出 JSON 失败，请检查浏览器权限');
      }
      return;
    }

    if (format === 'png') {
      console.info('[TopBar] 触发 PNG 导出请求（占位预留）');
      showToast('PNG 导出功能开发中，敬请期待');
      return;
    }

    if (format === 'svg') {
      console.info('[TopBar] 触发 SVG 导出请求（占位预留）');
      showToast('SVG 导出功能开发中，敬请期待');
      return;
    }
  };

  return (
    <header
      className={`h-12 border-b border-fs-border bg-fs-surface/85 backdrop-blur-md px-4 flex items-center justify-between select-none z-20 shrink-0 ${className}`}
    >
      {/* 左侧：Logo + 品牌名称 + 分隔线 + 可编辑图表标题 */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <div className="p-1 rounded-lg bg-fs-primary/10 text-fs-primary flex items-center justify-center">
            <Workflow className="w-5 h-5 text-fs-primary" />
          </div>
          <span className="font-bold text-sm tracking-tight text-fs-text hidden sm:inline">
            FlowStudio
          </span>
        </div>

        {/* 垂直分割线 */}
        <div className="h-4 w-px bg-fs-border shrink-0" />

        {/* 可编辑图表标题输入框 */}
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

      {/* 右侧：状态统计徽标 + 导出菜单 + 分隔线 + 主题切换 + 外部链接 */}
      <div className="flex items-center gap-2.5 shrink-0">
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

        {/* 导出菜单容器 */}
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

          {/* 导出下拉浮层 */}
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

        {/* 垂直分割线 */}
        <div className="h-4 w-px bg-fs-border" />

        {/* 主题切换开关 */}
        <ThemeToggle />

        {/* GitHub 外部链接 */}
        <a
          href="https://github.com"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="访问 GitHub 仓库"
          title="访问 GitHub 仓库"
          className="p-2 rounded-lg border border-fs-border bg-fs-surface text-fs-text-muted hover:text-fs-text hover:border-fs-primary transition-colors inline-flex items-center justify-center cursor-pointer shadow-xs"
        >
          <Github className="w-4 h-4" />
        </a>
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

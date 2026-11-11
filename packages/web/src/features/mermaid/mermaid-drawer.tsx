/**
 * @fileoverview Mermaid 语义双向同频抽屉组件 (MermaidDrawer)
 * @description 实时展示当前画布对应的确定性 Mermaid 代码，支持代码在线编辑并增量融合上屏，
 *              100% 保留画布上既有同名节点的手工坐标、配色与锁定状态
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X,
  Copy,
  Check,
  Zap,
  RefreshCw,
  Code2,
  HelpCircle,
  Sparkles,
} from 'lucide-react';
import { diagramToMermaid, diffMermaidToOps } from '@flowstudio/shared';
import { useFlowStore } from '../../stores/flow-store';

export interface MermaidDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MermaidDrawer: React.FC<MermaidDrawerProps> = ({ isOpen, onClose }) => {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const applyMermaidOps = useFlowStore((s) => s.applyMermaidOps);
  const showToast = useFlowStore((s) => s.showToast);

  // 由当前画布自动生成的标准 Mermaid 代码
  const canonicalMermaid = useMemo(() => {
    return diagramToMermaid(nodes, edges);
  }, [nodes, edges]);

  // 编辑器内的 Mermaid 代码
  const [editorText, setEditorText] = useState(canonicalMermaid);
  const [isCopied, setIsCopied] = useState(false);
  const [syncSummary, setSyncSummary] = useState<string | null>(null);

  // 打开抽屉或画布大幅变动时，若用户未脏编辑则自动同频代码
  useEffect(() => {
    if (isOpen) {
      setEditorText(canonicalMermaid);
      setSyncSummary(null);
    }
  }, [isOpen, canonicalMermaid]);

  // 一键复制 Mermaid 代码
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(editorText);
      setIsCopied(true);
      showToast('✓ Mermaid 代码已成功复制到剪贴板');
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      showToast('复制失败，请手动选中文本复制');
    }
  }, [editorText, showToast]);

  // 重新从画布全量导出重置编辑器
  const handleResetFromCanvas = useCallback(() => {
    setEditorText(canonicalMermaid);
    setSyncSummary(null);
    showToast('已从当前画布重新同频导出 Mermaid 代码');
  }, [canonicalMermaid, showToast]);

  // ⚡ 增量同步至画布 (Diff & Incremental Apply)
  const handleSyncToCanvas = useCallback(() => {
    try {
      const trimmed = editorText.trim();
      if (!trimmed) {
        showToast('Mermaid 代码不能为空');
        return;
      }

      // 计算语义差异
      const diffResult = diffMermaidToOps(trimmed, nodes, edges);
      if (diffResult.ops.length === 0) {
        setSyncSummary('画布结构与 Mermaid 代码完全一致，无需改动');
        showToast('画布已是最新状态，无差异变更');
        return;
      }

      // 增量应用差异操作
      const { addedNodes, addedEdges } = applyMermaidOps(diffResult.ops);

      const summaryText = `增量融合完成：新增 ${addedNodes} 节点、${addedEdges} 连线，保留 ${diffResult.preservedNodeIds.length} 个既有节点原位坐标与锁定状态`;
      setSyncSummary(summaryText);
      showToast(`⚡ ${summaryText}`);
    } catch (err: any) {
      console.error('[MermaidDrawer] 增量同步失败:', err);
      showToast(`同步失败: ${err.message || String(err)}`);
    }
  }, [editorText, nodes, edges, applyMermaidOps, showToast]);

  if (!isOpen) return null;

  return (
    <aside
      className="fixed inset-y-0 right-0 w-full sm:w-[500px] z-50 bg-fs-surface border-l border-fs-border shadow-2xl flex flex-col select-none animate-in slide-in-from-right duration-200"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* 抽屉头部 */}
      <div className="h-12 border-b border-fs-border px-4 flex items-center justify-between shrink-0 bg-fs-surface/80 backdrop-blur-md">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <Code2 className="w-4 h-4" />
          </div>
          <span className="font-semibold text-xs sm:text-sm text-fs-text truncate">
            Mermaid 语义双向同频抽屉
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg text-fs-text-muted hover:text-fs-text hover:bg-fs-bg transition-colors cursor-pointer"
          title="关闭抽屉"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 语法提示胶囊 */}
      <div className="px-4 py-2 bg-indigo-50/60 dark:bg-indigo-950/30 border-b border-indigo-100 dark:border-indigo-900/40 text-[11px] text-indigo-900 dark:text-indigo-200 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
          <span>双向无损同频：修改代码后同步，既有同名节点坐标与样式 100% 保持不动</span>
        </div>
        <button
          type="button"
          onClick={handleResetFromCanvas}
          title="重新抓取当前画布代码"
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-indigo-600 dark:text-indigo-300 hover:bg-indigo-200/50 dark:hover:bg-indigo-900/50 transition-colors cursor-pointer shrink-0"
        >
          <RefreshCw className="w-3 h-3" />
          <span>重新抓取</span>
        </button>
      </div>

      {/* 代码编辑核心区域 */}
      <div className="flex-1 p-3 flex flex-col min-h-0 bg-[var(--fs-canvas-bg,#f8fafc)] dark:bg-[var(--fs-canvas-bg,#0b0f19)]">
        <textarea
          value={editorText}
          onChange={(e) => setEditorText(e.target.value)}
          spellCheck={false}
          className="w-full flex-1 p-3 font-mono text-xs leading-relaxed rounded-xl border border-fs-border bg-fs-surface text-fs-text focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-none shadow-inner"
          placeholder="flowchart LR&#10;  A[开始] --> B[处理]&#10;  B --> C{是否通过}&#10;  C -->|是| D[(数据库)]"
        />
      </div>

      {/* 同步结果反馈条 */}
      {syncSummary && (
        <div className="px-4 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 border-t border-emerald-200 dark:border-emerald-800/50 text-[11px] text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span className="truncate">{syncSummary}</span>
        </div>
      )}

      {/* 底部操作工具栏 */}
      <div className="p-3 border-t border-fs-border bg-fs-surface flex items-center justify-between gap-2 shrink-0">
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-fs-border bg-fs-surface text-fs-text hover:bg-fs-bg text-xs font-medium transition-colors cursor-pointer shadow-xs"
        >
          {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{isCopied ? '已复制代码' : '复制代码'}</span>
        </button>

        <button
          type="button"
          onClick={handleSyncToCanvas}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-semibold shadow-md hover:shadow-lg transition-all cursor-pointer"
        >
          <Zap className="w-3.5 h-3.5 fill-current" />
          <span>⚡ 增量同步至画布</span>
        </button>
      </div>
    </aside>
  );
};

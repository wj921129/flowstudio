/**
 * @fileoverview AI 批次修改浮动提示与审阅台胶囊 (AiBatchBanner)
 * @description 悬浮于画布右上角，呈现最近的 AI 协作者批次修改摘要，提供一键撤回与 Visual Diff 逐项审阅开关
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Bot, RotateCcw, X, Eye, EyeOff, ChevronLeft, ChevronRight } from 'lucide-react';
import type { AiBatchRecord, AiBatchRevertResult } from '@flowstudio/shared';
import { useFlowStore } from '../../stores/flow-store';

export interface AiBatchBannerProps {
  diagramId?: string;
  onToast?: (message: string) => void;
}

/**
 * 清洗并规范化 diagramId（防御性剥离 hash 前缀、斜杠与 query 参数，杜绝非法路径注入）
 */
export function sanitizeDiagramId(diagramId?: string): string {
  if (!diagramId) return '';
  const trimmed = diagramId.trim();
  const withoutPrefix = trimmed.replace(/^#?\/*diagram\//, '').replace(/^\/+/, '').split('?')[0];
  return withoutPrefix.includes('/') ? '' : withoutPrefix;
}

export const AiBatchBanner: React.FC<AiBatchBannerProps> = ({ diagramId, onToast }) => {
  const [batches, setBatches] = useState<AiBatchRecord[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [dismissedBatchId, setDismissedBatchId] = useState<string | null>(null);
  const [isReverting, setIsReverting] = useState(false);

  const aiReviewActive = useFlowStore((s) => s.aiReviewActive);
  const setAiReviewMode = useFlowStore((s) => s.setAiReviewMode);
  const showToast = useFlowStore((s) => s.showToast);
  const aiAcceptedEntityIds = useFlowStore((s) => s.aiAcceptedEntityIds);
  const clearAiAcceptedEntities = useFlowStore((s) => s.clearAiAcceptedEntities);

  const triggerToast = useCallback(
    (msg: string) => {
      onToast ? onToast(msg) : showToast(msg);
    },
    [onToast, showToast]
  );

  // 清洗并规范化 diagramId
  const cleanDiagramId = useMemo(() => sanitizeDiagramId(diagramId), [diagramId]);

  // 定期轮询检查当前图的有效 AI 批次（过滤已撤回的批次，B10）
  const checkBatches = useCallback(async () => {
    if (!cleanDiagramId) return;
    try {
      const res = await fetch(`/api/diagrams/${cleanDiagramId}/ai-batches`);
      if (!res.ok) return;
      const list = (await res.json()) as AiBatchRecord[];
      const activeList = (list || []).filter((b) => b.status !== 'reverted');
      setBatches(activeList);
    } catch {
      // 忽略轮询静默异常
    }
  }, [cleanDiagramId]);

  useEffect(() => {
    checkBatches();
    const timer = setInterval(checkBatches, 4000);
    return () => clearInterval(timer);
  }, [checkBatches]);

  // 基于 selectedBatchId 稳定锚定当前批次，避免轮询新批次插入导致索引漂移 (B10)
  const activeBatch = useMemo(() => {
    if (batches.length === 0) return null;
    if (selectedBatchId) {
      const found = batches.find((b) => b.batchId === selectedBatchId);
      if (found) return found;
    }
    return batches[0];
  }, [batches, selectedBatchId]);

  const currentBatchIndex = useMemo(() => {
    if (!activeBatch) return 0;
    const idx = batches.findIndex((b) => b.batchId === activeBatch.batchId);
    return idx >= 0 ? idx : 0;
  }, [batches, activeBatch]);

  // 当切换批次时同步审阅批次 ID
  useEffect(() => {
    if (activeBatch && aiReviewActive) {
      setAiReviewMode(true, activeBatch.batchId);
    }
  }, [activeBatch, aiReviewActive, setAiReviewMode]);

  const handleRevertAll = async () => {
    if (!cleanDiagramId || !activeBatch || isReverting) return;
    try {
      setIsReverting(true);
      const activeDiffs = (activeBatch.diffs || []).filter((d) => !d.reverted);
      const acceptedDiffs = activeDiffs.filter((d) => aiAcceptedEntityIds.has(d.entityId));
      const unacceptedDiffs = activeDiffs.filter((d) => !aiAcceptedEntityIds.has(d.entityId));

      if (acceptedDiffs.length > 0 && unacceptedDiffs.length === 0) {
        triggerToast('本批次所有变更均已确认保留，无需撤回');
        setAiReviewMode(false, null);
        setDismissedBatchId(activeBatch.batchId);
        setSelectedBatchId(null);
        clearAiAcceptedEntities();
        return;
      }

      let res: Response;
      let isSelective = false;

      if (acceptedDiffs.length > 0 && unacceptedDiffs.length > 0) {
        isSelective = true;
        const toRevertIds = Array.from(new Set(unacceptedDiffs.map((d) => d.entityId)));
        res = await fetch(
          `/api/diagrams/${cleanDiagramId}/ai-batches/${activeBatch.batchId}/revert-items`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entityIds: toRevertIds }),
          }
        );
      } else {
        res = await fetch(
          `/api/diagrams/${cleanDiagramId}/ai-batches/${activeBatch.batchId}/revert`,
          { method: 'POST' }
        );
      }

      const data = (await res.json()) as AiBatchRevertResult & { error?: string };
      if (res.ok && data.success) {
        if (isSelective) {
          triggerToast(
            `已成功撤回其余 ${unacceptedDiffs.length} 项修改，保留了 ${acceptedDiffs.length} 项已确认成果`
          );
        } else if (data.skipped && data.skipped.length > 0) {
          triggerToast(
            `已成功撤回部分修改；有 ${data.skipped.length} 项已被人工二次修改或锁定，已安全保留`
          );
        } else {
          triggerToast(data.message || '已成功撤回 AI 本批次修改');
        }
        setAiReviewMode(false, null);
        setDismissedBatchId(activeBatch.batchId);
        setSelectedBatchId(null);
        clearAiAcceptedEntities();
        checkBatches();
      } else {
        // 后端若触发补偿回滚或瞬时重试，避免误报「撤回失败」造成用户惊慌，以最终收敛态为准
        if (data.error && !data.error.includes('补偿回滚')) {
          triggerToast(data.error);
        }
      }
    } catch (err: any) {
      // 网络波动等异常给用户清晰反馈 (B9)
      console.warn('[AiBatchBanner] 撤回请求异常:', err);
      triggerToast('网络连接异常，撤回请求未送达，请稍后重试');
    } finally {
      setIsReverting(false);
    }
  };

  const toggleReview = () => {
    if (!activeBatch) return;
    const nextState = !aiReviewActive;
    setAiReviewMode(nextState, activeBatch.batchId);
    if (nextState) {
      triggerToast('🔍 已开启 AI 批次逐项审阅：三色高亮与单点 Cherry-Pick 已呈现');
    }
  };

  if (!activeBatch || activeBatch.batchId === dismissedBatchId) {
    return null;
  }

  return (
    <div className="absolute top-4 right-4 z-30 animate-in fade-in slide-in-from-top-2 duration-200 select-none">
      <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl border border-purple-500/40 bg-purple-50/90 dark:bg-purple-950/80 backdrop-blur-md shadow-xl text-xs text-purple-950 dark:text-purple-100">
        <div className="w-5 h-5 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-300 shrink-0">
          <Bot className="w-3.5 h-3.5 animate-pulse" />
        </div>

        <div className="flex flex-col min-w-0 pr-1">
          <div className="flex items-center gap-1.5 font-semibold text-[11px] leading-tight">
            <span>AI 协作者同步修改</span>
            {batches.length > 1 && (
              <span className="text-[10px] text-purple-600 dark:text-purple-400 font-mono">
                ({currentBatchIndex + 1}/{batches.length})
              </span>
            )}
          </div>
          <span className="text-[10px] text-purple-700/80 dark:text-purple-300/80 truncate max-w-56" title={activeBatch.summary}>
            {activeBatch.summary}
          </span>
        </div>

        {/* 批次切换器 */}
        {batches.length > 1 && (
          <div className="flex items-center gap-0.5 border-r border-purple-300/50 dark:border-purple-700/50 pr-2">
            <button
              type="button"
              disabled={currentBatchIndex <= 0}
              onClick={() => {
                const prevIdx = Math.max(0, currentBatchIndex - 1);
                setSelectedBatchId(batches[prevIdx]?.batchId || null);
              }}
              className="p-0.5 rounded hover:bg-purple-200/50 dark:hover:bg-purple-800/50 disabled:opacity-30 cursor-pointer"
              title="查看更新的批次"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={currentBatchIndex >= batches.length - 1}
              onClick={() => {
                const nextIdx = Math.min(batches.length - 1, currentBatchIndex + 1);
                setSelectedBatchId(batches[nextIdx]?.batchId || null);
              }}
              className="p-0.5 rounded hover:bg-purple-200/50 dark:hover:bg-purple-800/50 disabled:opacity-30 cursor-pointer"
              title="查看更早的批次"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* 逐项审阅 Diff 开关 */}
        <button
          type="button"
          onClick={toggleReview}
          className={`nodrag inline-flex items-center gap-1 px-2 py-1 rounded-md font-medium text-[11px] cursor-pointer transition-colors shadow-xs ${
            aiReviewActive
              ? 'bg-amber-500 hover:bg-amber-600 text-white ring-2 ring-amber-300'
              : 'bg-purple-200/80 hover:bg-purple-300/80 text-purple-900 dark:bg-purple-900/80 dark:text-purple-100 dark:hover:bg-purple-800/80'
          }`}
          title={aiReviewActive ? '退出逐项审阅' : '在画布上高亮展示 Visual Diff 与单点 Cherry-Pick'}
        >
          {aiReviewActive ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          <span>{aiReviewActive ? '退出审阅' : '逐项审阅'}</span>
        </button>

        {/* 撤回整批 */}
        <button
          type="button"
          onClick={handleRevertAll}
          disabled={isReverting}
          className="nodrag inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-medium text-[11px] bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white shadow-xs cursor-pointer transition-colors disabled:opacity-50"
          title="字段级撤回该批次所有未二次修改的成果"
        >
          <RotateCcw className={`w-3 h-3 ${isReverting ? 'animate-spin' : ''}`} />
          <span>{isReverting ? '撤回中' : '全部撤回'}</span>
        </button>

        {/* 关闭横幅 */}
        <button
          type="button"
          onClick={() => {
            setDismissedBatchId(activeBatch.batchId);
            setAiReviewMode(false, null);
          }}
          title="关闭提示"
          className="nodrag p-1 rounded-md text-purple-600/70 dark:text-purple-400/70 hover:text-purple-900 hover:bg-purple-500/10 transition-colors cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

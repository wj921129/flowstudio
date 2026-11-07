/**
 * @fileoverview AI 批次修改浮动提示与撤回胶囊 (AiBatchBanner)
 * @description 悬浮于画布右上角，呈现最近的 AI 协作者批次修改摘要，提供一键撤回操作
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Bot, RotateCcw, X } from 'lucide-react';

export interface AiBatchBannerProps {
  diagramId?: string;
  onToast?: (message: string) => void;
}

interface AiBatchInfo {
  batchId: string;
  diagramId: string;
  summary: string;
  createdAt: string;
}

export const AiBatchBanner: React.FC<AiBatchBannerProps> = ({ diagramId, onToast }) => {
  const [latestBatch, setLatestBatch] = useState<AiBatchInfo | null>(null);
  const [dismissedBatchId, setDismissedBatchId] = useState<string | null>(null);
  const [isReverting, setIsReverting] = useState(false);

  // 定期轮询检查当前图最新的 AI 批次
  const checkBatches = useCallback(async () => {
    if (!diagramId) return;
    try {
      const res = await fetch(`/api/diagrams/${diagramId}/ai-batches`);
      if (!res.ok) return;
      const batches = (await res.json()) as AiBatchInfo[];
      if (batches.length > 0) {
        const newest = batches[0];
        if (newest.batchId !== dismissedBatchId) {
          setLatestBatch(newest);
        }
      } else {
        setLatestBatch(null);
      }
    } catch {
      // 忽略轮询静默异常
    }
  }, [diagramId, dismissedBatchId]);

  useEffect(() => {
    checkBatches();
    const timer = setInterval(checkBatches, 4000);
    return () => clearInterval(timer);
  }, [checkBatches]);

  const handleRevert = async () => {
    if (!diagramId || !latestBatch || isReverting) return;
    try {
      setIsReverting(true);
      const res = await fetch(`/api/diagrams/${diagramId}/ai-batches/${latestBatch.batchId}/revert`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok && data.success) {
        onToast?.(data.message || '已成功撤回 AI 本次修改');
        setLatestBatch(null);
        setDismissedBatchId(latestBatch.batchId);
      } else {
        onToast?.(data.error || '撤回失败');
      }
    } catch (err: any) {
      onToast?.(`撤回异常: ${err.message || String(err)}`);
    } finally {
      setIsReverting(false);
    }
  };

  if (!latestBatch || latestBatch.batchId === dismissedBatchId) {
    return null;
  }

  return (
    <div className="absolute top-4 right-4 z-30 animate-in fade-in slide-in-from-top-2 duration-200 select-none">
      <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl border border-purple-500/30 bg-purple-50/80 dark:bg-purple-950/60 backdrop-blur-md shadow-lg text-xs text-purple-900 dark:text-purple-200">
        <div className="w-5 h-5 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-300 shrink-0">
          <Bot className="w-3.5 h-3.5 animate-pulse" />
        </div>

        <div className="flex flex-col min-w-0 pr-1">
          <span className="font-semibold text-[11px] leading-tight">AI 协作者已同步修改</span>
          <span className="text-[10px] text-purple-700/80 dark:text-purple-300/80 truncate max-w-56">
            {latestBatch.summary}
          </span>
        </div>

        <button
          type="button"
          onClick={handleRevert}
          disabled={isReverting}
          className="nodrag inline-flex items-center gap-1 px-2 py-1 rounded-md font-medium text-[11px] bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white shadow-xs cursor-pointer transition-colors disabled:opacity-50"
        >
          <RotateCcw className={`w-3 h-3 ${isReverting ? 'animate-spin' : ''}`} />
          <span>{isReverting ? '撤回中' : '撤回此批'}</span>
        </button>

        <button
          type="button"
          onClick={() => setDismissedBatchId(latestBatch.batchId)}
          title="关闭提示"
          className="nodrag p-1 rounded-md text-purple-600/70 dark:text-purple-400/70 hover:text-purple-900 hover:bg-purple-500/10 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

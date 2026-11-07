/**
 * @fileoverview 图表历史版本快照侧边抽屉面板 (SnapshotDrawer)
 * @description 展示快照时间线、触发类型徽标，支持一键创建手动快照与无损差异回滚
 */

import React, { useState, useEffect, useCallback } from 'react';
import { History, X, Plus, RotateCcw, Sparkles, User, Clock, ShieldCheck } from 'lucide-react';
import type { SnapshotSummary } from '@flowstudio/shared';
import { apiClient } from '../../lib/api-client';

export interface SnapshotDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  diagramId?: string;
  onToast?: (message: string) => void;
}

export const SnapshotDrawer: React.FC<SnapshotDrawerProps> = ({
  isOpen,
  onClose,
  diagramId,
  onToast,
}) => {
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [revertingId, setRevertingId] = useState<string | null>(null);

  const loadSnapshots = useCallback(async () => {
    if (!diagramId) return;
    try {
      setIsLoading(true);
      const list = await apiClient.listSnapshots(diagramId);
      setSnapshots(list);
    } catch (err: any) {
      console.error('[SnapshotDrawer] 加载快照失败:', err);
    } finally {
      setIsLoading(false);
    }
  }, [diagramId]);

  useEffect(() => {
    if (isOpen) {
      loadSnapshots();
    }
  }, [isOpen, loadSnapshots]);

  const handleCreateSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!diagramId || isCreating) return;
    const label = newLabel.trim() || '手动快照';
    try {
      setIsCreating(true);
      await apiClient.createSnapshot(diagramId, label);
      setNewLabel('');
      onToast?.('快照创建成功');
      await loadSnapshots();
    } catch (err: any) {
      onToast?.(`创建快照失败: ${err.message || String(err)}`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleRestore = async (snapshotId: string, label: string) => {
    if (!diagramId || revertingId) return;
    try {
      setRevertingId(snapshotId);
      const res = await apiClient.restoreSnapshot(diagramId, snapshotId);
      if (res.success) {
        onToast?.(`已成功恢复至「${label}」版本`);
        onClose();
      }
    } catch (err: any) {
      onToast?.(`恢复快照失败: ${err.message || String(err)}`);
    } finally {
      setRevertingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="w-88 h-full bg-[var(--fs-surface)] border-l border-[var(--fs-border)] shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* 头部标题与关闭 */}
        <div className="h-12 px-4 border-b border-[var(--fs-border)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            <span className="text-xs font-semibold text-[var(--fs-text)] tracking-wide">
              历史版本快照
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--fs-bg)] text-[var(--fs-text-muted)] font-mono">
              {snapshots.length}
            </span>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-md text-[var(--fs-text-muted)] hover:text-[var(--fs-text)] hover:bg-[var(--fs-border)]/50 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 手动创建快照表单 */}
        <form onSubmit={handleCreateSnapshot} className="p-3 border-b border-[var(--fs-border)] bg-[var(--fs-bg)]/40 flex gap-2">
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="快照说明 (如: 评审前定稿)"
            className="flex-1 px-2.5 py-1.5 text-xs bg-[var(--fs-surface)] border border-[var(--fs-border)] rounded-lg text-[var(--fs-text)] outline-none focus:border-purple-500 transition-colors"
          />
          <button
            type="submit"
            disabled={isCreating}
            className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-purple-600 hover:bg-purple-700 text-white shadow-xs flex items-center gap-1 disabled:opacity-50 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>创建</span>
          </button>
        </form>

        {/* 快照列表时间线 */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {isLoading ? (
            <div className="h-32 flex items-center justify-center text-xs text-[var(--fs-text-muted)]">
              加载版本历史中...
            </div>
          ) : snapshots.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-center p-4 text-[var(--fs-text-muted)]">
              <History className="w-8 h-8 opacity-30 mb-2" />
              <span className="text-xs">暂无历史快照</span>
              <span className="text-[11px] opacity-75 mt-1">系统会在 AI 每次执行操作前自动生成备份</span>
            </div>
          ) : (
            snapshots.map((snap) => {
              const isAi = snap.triggerType === 'ai_batch';
              const isManual = snap.triggerType === 'manual';

              return (
                <div
                  key={snap.id}
                  className="group relative p-3 rounded-xl border border-[var(--fs-border)] bg-[var(--fs-surface)] hover:border-purple-500/50 hover:shadow-xs transition-all flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[var(--fs-text)] truncate max-w-[70%]">
                      {snap.label}
                    </span>

                    {/* 触发类型徽标 */}
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium flex items-center gap-1 ${
                        isAi
                          ? 'bg-purple-500/15 text-purple-700 dark:text-purple-300'
                          : isManual
                          ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
                          : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      }`}
                    >
                      {isAi ? <Sparkles className="w-2.5 h-2.5" /> : isManual ? <User className="w-2.5 h-2.5" /> : <Clock className="w-2.5 h-2.5" />}
                      <span>{isAi ? 'AI 批次' : isManual ? '手动' : '自动'}</span>
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-[var(--fs-text-muted)]">
                    <span className="font-mono text-[10px]">
                      {new Date(snap.createdAt).toLocaleString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>

                    <button
                      type="button"
                      onClick={() => handleRestore(snap.id, snap.label)}
                      disabled={Boolean(revertingId)}
                      className="opacity-80 group-hover:opacity-100 flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-purple-600 dark:text-purple-400 hover:bg-purple-500/10 transition-all cursor-pointer disabled:opacity-50"
                    >
                      <RotateCcw className={`w-3 h-3 ${revertingId === snap.id ? 'animate-spin' : ''}`} />
                      <span>{revertingId === snap.id ? '恢复中' : '恢复此版'}</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 底部保护说明 */}
        <div className="p-3 border-t border-[var(--fs-border)] bg-[var(--fs-bg)]/60 text-[11px] text-[var(--fs-text-muted)] flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
          <span>无损恢复：快照以普通修改写回，在线同事不掉线且可撤销</span>
        </div>
      </div>
    </div>
  );
};

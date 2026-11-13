/**
 * @fileoverview 图表历史版本快照侧边抽屉面板 (SnapshotDrawer)
 * @description 展示快照时间线、触发类型徽标，支持一键创建手动快照与无损差异回滚
 */

import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { History, X, Plus, RotateCcw, Sparkles, User, Clock, ShieldCheck, Layers, GitCompare, ArrowRight, AlertTriangle } from 'lucide-react';
import type { SnapshotSummary, FlowNode, FlowEdge } from '@flowstudio/shared';
import { compareSnapshots } from '@flowstudio/shared';
import * as Y from 'yjs';
import { apiClient } from '../../lib/api-client';
import { useCollaboration } from '../collaboration/collaboration-provider';
import { useSnapshotDiffStore } from './snapshot-diff-store';
import { useFlowStore } from '../../stores/flow-store';

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
  const [isDiffing, setIsDiffing] = useState(false);
  const [activeTab, setActiveTab] = useState<'timeline' | 'diff'>('timeline');
  const [diffBaseId, setDiffBaseId] = useState<string>('');
  const [diffTargetId, setDiffTargetId] = useState<string>('live');
  const [confirmRestoreSnap, setConfirmRestoreSnap] = useState<{ id: string; label: string } | null>(null);
  const collab = useCollaboration();

  const loadSnapshots = useCallback(async () => {
    if (!diagramId) return;
    try {
      setIsLoading(true);
      const list = await apiClient.listSnapshots(diagramId);
      setSnapshots(list);
      if (list.length > 0 && !diffBaseId) {
        setDiffBaseId(list[0].id);
      }
    } catch (err: any) {
      console.error('[SnapshotDrawer] 加载快照失败:', err);
    } finally {
      setIsLoading(false);
    }
  }, [diagramId, diffBaseId]);

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
      await apiClient.createSnapshot(diagramId, label, 'manual');
      setNewLabel('');
      onToast?.('快照创建成功');
      await loadSnapshots();
    } catch (err: any) {
      onToast?.(`创建快照失败: ${err.message || String(err)}`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDiffWithLive = async (snapshotId: string, label: string) => {
    if (!diagramId || isDiffing) return;
    try {
      setIsDiffing(true);
      const snapData = await apiClient.getSnapshot(diagramId, snapshotId);
      const currentNodes = useFlowStore.getState().nodes;
      const currentEdges = useFlowStore.getState().edges;
      const diffResult = compareSnapshots(
        snapData.nodes || [],
        snapData.edges || [],
        currentNodes,
        currentEdges,
        label,
        '当前画布'
      );
      useSnapshotDiffStore.getState().startDiff(diffResult, snapshotId, 'live');
      onToast?.(`已开启「${label}」与当前画布的 Visual Diff 比对 (${diffResult.summary.totalChanges} 处变动)`);
      onClose();
    } catch (err: any) {
      onToast?.(`获取快照比对失败: ${err.message || String(err)}`);
    } finally {
      setIsDiffing(false);
    }
  };

  const handleCompareTwo = async () => {
    if (!diagramId || !diffBaseId || isDiffing) return;
    try {
      setIsDiffing(true);
      const baseSnap = await apiClient.getSnapshot(diagramId, diffBaseId);
      let targetNodes: FlowNode[] = [];
      let targetEdges: FlowEdge[] = [];
      let targetLabel = '当前画布';

      if (diffTargetId === 'live') {
        targetNodes = useFlowStore.getState().nodes;
        targetEdges = useFlowStore.getState().edges;
      } else {
        const targetSnap = await apiClient.getSnapshot(diagramId, diffTargetId);
        targetNodes = targetSnap.nodes || [];
        targetEdges = targetSnap.edges || [];
        targetLabel = snapshots.find((s) => s.id === diffTargetId)?.label || '目标快照';
      }

      const baseLabel = snapshots.find((s) => s.id === diffBaseId)?.label || '基线快照';
      const diffResult = compareSnapshots(
        baseSnap.nodes || [],
        baseSnap.edges || [],
        targetNodes,
        targetEdges,
        baseLabel,
        targetLabel
      );
      useSnapshotDiffStore.getState().startDiff(diffResult, diffBaseId, diffTargetId);
      onToast?.(`已开启「${baseLabel}」与「${targetLabel}」的 Visual Diff (${diffResult.summary.totalChanges} 处变动)`);
      onClose();
    } catch (err: any) {
      onToast?.(`快照比对失败: ${err.message || String(err)}`);
    } finally {
      setIsDiffing(false);
    }
  };

  useEffect(() => {
    if (!confirmRestoreSnap) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setConfirmRestoreSnap(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const target = confirmRestoreSnap;
        setConfirmRestoreSnap(null);
        executeRestore(target.id, target.label);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmRestoreSnap, diagramId, revertingId, collab]);

  const handleRestore = (snapshotId: string, label: string) => {
    if (!diagramId || revertingId) return;
    setConfirmRestoreSnap({ id: snapshotId, label });
  };

  const executeRestore = async (snapshotId: string, label: string) => {
    if (!diagramId || revertingId) return;

    try {
      setRevertingId(snapshotId);
      try {
        await apiClient.createSnapshot(diagramId, `[系统安全备份] 恢复「${label}」前`, 'auto');
      } catch (err) {
        console.warn('[SnapshotDrawer] 自动备份快照失败:', err);
      }

      if (collab?.doc) {
        const deltaRes = await apiClient.restoreSnapshot(diagramId, snapshotId, { mode: 'delta' });
        if (deltaRes.success) {
          if (deltaRes.update) {
            const binary = Uint8Array.from(atob(deltaRes.update), (c) => c.charCodeAt(0));
            collab.undoManager?.stopCapturing?.();
            Y.applyUpdate(collab.doc, binary, `snapshot-restore:${snapshotId}`);
            collab.undoManager?.stopCapturing?.();
          }
          onToast?.(`已成功恢复至「${label}」版本`);
          onClose();
          return;
        }
      }

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
      <div className="w-96 h-full bg-[var(--fs-surface)] border-l border-[var(--fs-border)] shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        <div className="h-12 px-4 border-b border-[var(--fs-border)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            <span className="text-xs font-semibold text-[var(--fs-text)] tracking-wide">
              历史版本与 Visual Diff
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

        <div className="px-3 pt-2 pb-1 border-b border-[var(--fs-border)] bg-[var(--fs-bg)]/20 flex gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('timeline')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === 'timeline'
                ? 'bg-[var(--fs-surface)] text-[var(--fs-text)] shadow-xs border border-[var(--fs-border)]'
                : 'text-[var(--fs-text-muted)] hover:text-[var(--fs-text)]'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>版本时间线</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('diff')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === 'diff'
                ? 'bg-[var(--fs-surface)] text-[var(--fs-text)] shadow-xs border border-[var(--fs-border)]'
                : 'text-[var(--fs-text-muted)] hover:text-[var(--fs-text)]'
            }`}
          >
            <GitCompare className="w-3.5 h-3.5 text-purple-500" />
            <span>差异比对 (Diff)</span>
          </button>
        </div>

        {activeTab === 'timeline' ? (
          <>
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
                  const isTimer = snap.triggerType === 'timer';

                  return (
                    <div
                      key={snap.id}
                      className="group relative p-3 rounded-xl border border-[var(--fs-border)] bg-[var(--fs-surface)] hover:border-purple-500/50 hover:shadow-xs transition-all flex flex-col gap-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[var(--fs-text)] truncate max-w-[65%]" title={snap.label}>
                          {snap.label}
                        </span>

                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium flex items-center gap-1 ${
                            isAi
                              ? 'bg-purple-500/15 text-purple-700 dark:text-purple-300'
                              : isManual
                              ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
                              : isTimer
                              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                              : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          }`}
                        >
                          {isAi ? (
                            <Sparkles className="w-2.5 h-2.5" />
                          ) : isManual ? (
                            <User className="w-2.5 h-2.5" />
                          ) : isTimer ? (
                            <Clock className="w-2.5 h-2.5" />
                          ) : (
                            <ShieldCheck className="w-2.5 h-2.5" />
                          )}
                          <span>{isAi ? 'AI 批次' : isManual ? '手动' : isTimer ? '定时' : '自动'}</span>
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

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleDiffWithLive(snap.id, snap.label)}
                            disabled={isDiffing}
                            title="与当前画布进行 Visual Diff 差异比对"
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 transition-all cursor-pointer disabled:opacity-50"
                          >
                            <GitCompare className="w-3 h-3" />
                            <span>比对</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRestore(snap.id, snap.label)}
                            disabled={Boolean(revertingId)}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-purple-600 dark:text-purple-400 hover:bg-purple-500/10 transition-all cursor-pointer disabled:opacity-50"
                          >
                            <RotateCcw className={`w-3 h-3 ${revertingId === snap.id ? 'animate-spin' : ''}`} />
                            <span>{revertingId === snap.id ? '恢复中' : '恢复'}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 p-4 flex flex-col gap-4 overflow-y-auto">
            <div className="p-3 rounded-xl border border-[var(--fs-border)] bg-[var(--fs-bg)]/40 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-[var(--fs-text)]">基线版本 (Base)</label>
                <select
                  value={diffBaseId}
                  onChange={(e) => setDiffBaseId(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-[var(--fs-surface)] border border-[var(--fs-border)] rounded-lg text-[var(--fs-text)] outline-none focus:border-purple-500"
                >
                  {snapshots.map((s) => (
                    <option key={`base-${s.id}`} value={s.id}>
                      {s.label} ({new Date(s.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-center -my-1 text-purple-500">
                <ArrowRight className="w-4 h-4 rotate-90" />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-[var(--fs-text)]">目标版本 (Target)</label>
                <select
                  value={diffTargetId}
                  onChange={(e) => setDiffTargetId(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-[var(--fs-surface)] border border-[var(--fs-border)] rounded-lg text-[var(--fs-text)] outline-none focus:border-purple-500"
                >
                  <option value="live">⚡ 当前画布 (实时最新)</option>
                  {snapshots.map((s) => (
                    <option key={`target-${s.id}`} value={s.id}>
                      {s.label} ({new Date(s.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })})
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={handleCompareTwo}
                disabled={isDiffing || snapshots.length === 0}
                className="w-full py-2 text-xs font-semibold rounded-lg bg-purple-600 hover:bg-purple-700 text-white shadow-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <GitCompare className={`w-3.5 h-3.5 ${isDiffing ? 'animate-spin' : ''}`} />
                <span>{isDiffing ? '计算差异中...' : '开始 Visual Diff 可视化比对'}</span>
              </button>
            </div>

            <div className="p-3 rounded-xl border border-dashed border-[var(--fs-border)] bg-[var(--fs-surface)]/40 text-[11px] text-[var(--fs-text-muted)] space-y-1.5">
              <div className="font-semibold text-[var(--fs-text)]">比对特性说明：</div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                <span>绿色高亮：目标版本相对新增图元</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                <span>黄色高亮：文案/坐标/属性相对修改</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                <span>红色虚线：目标版本相对删除幽灵图元</span>
              </div>
            </div>
          </div>
        )}

        <div className="p-3 border-t border-[var(--fs-border)] bg-[var(--fs-bg)]/60 text-[11px] text-[var(--fs-text-muted)] flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
          <span>支持任意快照与实时画布无损比对</span>
        </div>
      </div>

      {confirmRestoreSnap &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-xs p-4 animate-in fade-in duration-150"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmRestoreSnap(null);
            }}
          >
            <div
              className="w-full max-w-md rounded-2xl p-6 shadow-2xl border bg-[var(--fs-surface)] border-[var(--fs-border)] text-[var(--fs-text)] animate-in zoom-in-95 duration-150 select-none"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-rose-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold leading-6 mb-1.5">恢复历史快照</h3>
                  <p className="text-xs leading-5 text-[var(--fs-text-muted)]">
                    确定要恢复至历史快照「
                    <span className="font-semibold text-[var(--fs-text)]">{confirmRestoreSnap.label}</span>
                    」吗？
                  </p>
                  <div className="mt-2.5 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <span>恢复前系统将自动为当前画布创建一份安全备份快照，确保数据安全可溯。</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-6">
                <button
                  type="button"
                  onClick={() => setConfirmRestoreSnap(null)}
                  className="px-4 py-2 rounded-lg text-xs font-medium border border-[var(--fs-border)] text-[var(--fs-text-muted)] hover:bg-[var(--fs-bg)] transition-colors cursor-pointer"
                >
                  取消 (Esc)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const target = confirmRestoreSnap;
                    setConfirmRestoreSnap(null);
                    executeRestore(target.id, target.label);
                  }}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-white shadow-xs bg-purple-600 hover:bg-purple-700 transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>确认恢复 (Enter)</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};


import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Check, Save, Clock, RotateCcw } from 'lucide-react';
import type { SaveStatusSummary } from '@flowstudio/shared';
import { useFlowStore } from '../../stores/flow-store';
import { apiClient } from '../../lib/api-client';

export interface SaveStatusIndicatorProps {
  diagramId?: string;
  isReadOnly?: boolean;
  onToast?: (message: string) => void;
}

export const SaveStatusIndicator: React.FC<SaveStatusIndicatorProps> = ({
  diagramId,
  isReadOnly = false,
  onToast,
}) => {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const diagramTitle = useFlowStore((s) => s.diagramTitle);

  const userInteractedRef = useRef(false);
  const lastEditTimeRef = useRef(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatusSummary | null>(null);
  const [statusState, setStatusState] = useState<'editing' | 'saving' | 'saved'>('saved');
  const [isManualSaving, setIsManualSaving] = useState(false);
  const [countdownStr, setCountdownStr] = useState('');

  useEffect(() => {
    const markInteracted = () => {
      userInteractedRef.current = true;
    };
    window.addEventListener('pointerdown', markInteracted, { capture: true, passive: true });
    window.addEventListener('keydown', markInteracted, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', markInteracted, true);
      window.removeEventListener('keydown', markInteracted, true);
    };
  }, []);

  useEffect(() => {
    if (!userInteractedRef.current) return;
    lastEditTimeRef.current = Date.now();
    setStatusState('editing');
    const timer = setTimeout(() => {
      setStatusState((prev) => (prev === 'editing' ? 'saving' : prev));
    }, 800);
    return () => clearTimeout(timer);
  }, [nodes, edges, diagramTitle]);

  const fetchStatus = useCallback(async () => {
    if (!diagramId) return;
    try {
      const data = await apiClient.getSaveStatus(diagramId);
      setSaveStatus(data);
      if (!userInteractedRef.current || lastEditTimeRef.current === 0) {
        setStatusState('saved');
      } else if (data.lastSavedAt) {
        const savedTime = new Date(data.lastSavedAt).getTime();
        if (savedTime >= lastEditTimeRef.current) {
          setStatusState('saved');
          lastEditTimeRef.current = 0;
        }
      }
    } catch {}
  }, [diagramId]);

  useEffect(() => {
    if (!diagramId) return;
    fetchStatus();

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchStatus();
      }
    }, 5000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchStatus();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [diagramId, fetchStatus]);

  useEffect(() => {
    if (!saveStatus?.nextSnapshotAt) {
      setCountdownStr('');
      return;
    }
    const updateCountdown = () => {
      const target = new Date(saveStatus.nextSnapshotAt!).getTime();
      const serverOffset = saveStatus.serverTime ? new Date(saveStatus.serverTime).getTime() - Date.now() : 0;
      const current = Date.now() + serverOffset;
      const diffMs = target - current;
      if (diffMs <= 0) {
        setCountdownStr('即将巡检');
        return;
      }
      const mins = Math.floor(diffMs / 60000);
      const secs = Math.floor((diffMs % 60000) / 1000);
      setCountdownStr(`${mins}:${secs < 10 ? '0' : ''}${secs}`);
    };
    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [saveStatus?.nextSnapshotAt, saveStatus?.serverTime]);

  const handleManualSave = useCallback(async () => {
    if (!diagramId || isReadOnly || isManualSaving) return;
    try {
      setIsManualSaving(true);
      setStatusState('saving');
      const res = await apiClient.forceSave(diagramId);
      if (res.success) {
        lastEditTimeRef.current = 0;
        setSaveStatus(res.status);
        setStatusState('saved');
        onToast?.('已保存到数据库');
      }
    } catch (err: any) {
      onToast?.(`保存失败: ${err.message || String(err)}`);
    } finally {
      setIsManualSaving(false);
    }
  }, [diagramId, isReadOnly, isManualSaving, onToast]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        e.stopPropagation();
        if (!isReadOnly && diagramId) {
          handleManualSave();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [handleManualSave, isReadOnly, diagramId]);

  const formattedTime = saveStatus?.lastSavedAt
    ? new Date(saveStatus.lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className="flex items-center gap-1.5 shrink-0 select-none">
      <div
        data-testid="save-status-indicator"
        data-status={statusState}
        title={
          statusState === 'editing'
            ? '本地有未保存改动'
            : statusState === 'saving'
            ? '正在落库持久化...'
            : `已安全保存至数据库${formattedTime ? `（上次保存于 ${formattedTime}）` : ''}`
        }
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium border border-fs-border bg-fs-surface text-fs-text-muted"
      >
        {statusState === 'editing' ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
            <span className="hidden lg:inline text-amber-600 dark:text-amber-400">编辑中</span>
          </>
        ) : statusState === 'saving' ? (
          <>
            <RotateCcw className="w-3 h-3 text-blue-500 animate-spin shrink-0" />
            <span className="hidden lg:inline text-blue-600 dark:text-blue-400">保存中...</span>
          </>
        ) : (
          <>
            <Check className="w-3 h-3 text-emerald-500 shrink-0" />
            <span className="hidden lg:inline">已自动保存</span>
            {formattedTime && (
              <span className="hidden 2xl:inline text-[10px] opacity-75">
                · 上次保存于 {formattedTime}
              </span>
            )}
          </>
        )}
      </div>

      {saveStatus?.nextSnapshotAt && countdownStr && (
        <div
          data-testid="snapshot-timer-indicator"
          title={`定时安全快照调度中，预计 ${countdownStr} 后执行下一次巡检备份（5分钟周期）`}
          className="hidden xl:inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono border border-purple-500/20 bg-purple-500/10 text-purple-700 dark:text-purple-300"
        >
          <Clock className="w-3 h-3 text-purple-500 shrink-0" />
          <span>下次快照: {countdownStr}</span>
        </div>
      )}

      {!isReadOnly && (
        <button
          type="button"
          data-testid="manual-save-button"
          onClick={handleManualSave}
          disabled={isManualSaving}
          title="立即保存到数据库 (Ctrl+S / Cmd+S)"
          aria-label="手动保存"
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border border-fs-border bg-fs-surface text-fs-text hover:bg-fs-bg hover:border-fs-primary/50 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
        >
          <Save className={`w-3.5 h-3.5 ${isManualSaving ? 'animate-spin text-fs-primary' : 'text-fs-text-muted'}`} />
          <span className="hidden lg:inline">保存</span>
        </button>
      )}
    </div>
  );
};

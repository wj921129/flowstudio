import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Check, Save, RotateCcw } from 'lucide-react';
import type { FlowEdge, FlowNode, SaveStatusSummary } from '@flowstudio/shared';
import { useFlowStore } from '../../stores/flow-store';
import { apiClient } from '../../lib/api-client';

export const SNAPSHOT_COUNTDOWN_MS = 3 * 60_000;
export const MIN_SAVE_INTERVAL_MS = 5_000;
const CHANGE_DEBOUNCE_MS = 800;
const RING_RADIUS = 16;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function computeCanvasSignature(nodes: FlowNode[], edges: FlowEdge[]): string {
  const normalizedNodes = nodes.map((n) => ({
    id: n.id,
    type: n.type,
    x: Math.round((n.position?.x ?? 0) * 100) / 100,
    y: Math.round((n.position?.y ?? 0) * 100) / 100,
    w: n.width ?? null,
    h: n.height ?? null,
    parentId: n.parentId ?? null,
    data: n.data ?? null,
    style: n.style ?? null,
  }));
  const normalizedEdges = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
    type: e.type ?? null,
    label: e.label ?? null,
    data: e.data ?? null,
    style: e.style ?? null,
  }));
  return JSON.stringify({ n: normalizedNodes, e: normalizedEdges });
}

export function canTriggerSave(lastSaveAt: number, now: number, minIntervalMs = MIN_SAVE_INTERVAL_MS): boolean {
  return lastSaveAt === 0 || now - lastSaveAt >= minIntervalMs;
}

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

  const userInteractedRef = useRef(false);
  const baselineSignatureRef = useRef<string | null>(null);
  const lastSaveAtRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownEndAtRef = useRef<number | null>(null);
  const isSavingRef = useRef(false);

  const [saveStatus, setSaveStatus] = useState<SaveStatusSummary | null>(null);
  const [statusState, setStatusState] = useState<'idle' | 'saving' | 'counting' | 'saved'>('saved');
  const [isSaving, setIsSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [remainingSecs, setRemainingSecs] = useState(0);

  const canvasSignature = useMemo(() => computeCanvasSignature(nodes, edges), [nodes, edges]);

  const clearPendingDebounce = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const stopCountdown = useCallback(() => {
    countdownEndAtRef.current = null;
    setProgress(0);
    setRemainingSecs(0);
  }, []);

  const saveAndCreateSnapshot = useCallback(
    async (label: string, triggerType: 'manual' | 'auto' | 'timer'): Promise<boolean> => {
      if (!diagramId || isReadOnly || isSavingRef.current) return false;
      const now = Date.now();
      if (!canTriggerSave(lastSaveAtRef.current, now)) {
        if (triggerType === 'manual') {
          const waitSecs = Math.ceil((MIN_SAVE_INTERVAL_MS - (now - lastSaveAtRef.current)) / 1000);
          onToast?.(`操作过于频繁，请 ${waitSecs} 秒后再试`);
        }
        return false;
      }

      try {
        isSavingRef.current = true;
        setIsSaving(true);
        setStatusState('saving');
        lastSaveAtRef.current = now;

        const saveRes = await apiClient.forceSave(diagramId);
        await apiClient.createSnapshot(diagramId, label, triggerType);
        if (saveRes.success) {
          setSaveStatus(saveRes.status);
        }
        return true;
      } catch (err: any) {
        if (triggerType === 'manual') {
          onToast?.(`保存失败: ${err?.message || String(err)}`);
        }
        return false;
      } finally {
        isSavingRef.current = false;
        setIsSaving(false);
      }
    },
    [diagramId, isReadOnly, onToast]
  );

  const startCountdown = useCallback(() => {
    const endAt = Date.now() + SNAPSHOT_COUNTDOWN_MS;
    countdownEndAtRef.current = endAt;
    setProgress(0.001);
    setRemainingSecs(Math.ceil(SNAPSHOT_COUNTDOWN_MS / 1000));
    setStatusState('counting');
  }, []);

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
    baselineSignatureRef.current = null;
    clearPendingDebounce();
    stopCountdown();
    setStatusState('saved');
  }, [diagramId, clearPendingDebounce, stopCountdown]);

  useEffect(() => {
    if (!diagramId) return;
    apiClient
      .getSaveStatus(diagramId)
      .then((data) => setSaveStatus(data))
      .catch(() => {});
  }, [diagramId]);

  useEffect(() => {
    if (!diagramId || isReadOnly) return;

    if (baselineSignatureRef.current === null || !userInteractedRef.current) {
      baselineSignatureRef.current = canvasSignature;
      return;
    }

    if (canvasSignature === baselineSignatureRef.current) return;
    baselineSignatureRef.current = canvasSignature;

    if (countdownEndAtRef.current !== null) return;

    clearPendingDebounce();
    const runInitialSnapshotAndStart = async () => {
      const now = Date.now();
      if (!canTriggerSave(lastSaveAtRef.current, now)) {
        const waitMs = MIN_SAVE_INTERVAL_MS - (now - lastSaveAtRef.current) + 50;
        debounceTimerRef.current = setTimeout(runInitialSnapshotAndStart, waitMs);
        return;
      }
      await saveAndCreateSnapshot('编辑前自动快照', 'auto');
      startCountdown();
    };

    debounceTimerRef.current = setTimeout(runInitialSnapshotAndStart, CHANGE_DEBOUNCE_MS);
  }, [
    diagramId,
    isReadOnly,
    canvasSignature,
    clearPendingDebounce,
    saveAndCreateSnapshot,
    startCountdown,
  ]);

  useEffect(() => {
    if (statusState !== 'counting' || countdownEndAtRef.current === null) return;

    const tick = async () => {
      const endAt = countdownEndAtRef.current;
      if (endAt === null) return;
      const remainMs = endAt - Date.now();

      if (remainMs <= 0) {
        stopCountdown();
        const ok = await saveAndCreateSnapshot('定时自动快照', 'timer');
        setStatusState(ok ? 'saved' : 'idle');
        return;
      }

      const ratio = 1 - remainMs / SNAPSHOT_COUNTDOWN_MS;
      setProgress(Math.min(1, Math.max(0.001, ratio)));
      setRemainingSecs(Math.ceil(remainMs / 1000));
    };

    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [statusState, stopCountdown, saveAndCreateSnapshot]);

  useEffect(() => {
    return () => {
      clearPendingDebounce();
    };
  }, [clearPendingDebounce]);

  const handleManualSave = useCallback(async () => {
    if (!diagramId || isReadOnly || isSavingRef.current) return;
    clearPendingDebounce();
    const ok = await saveAndCreateSnapshot('手动保存快照', 'manual');
    if (ok) {
      stopCountdown();
      baselineSignatureRef.current = canvasSignature;
      setStatusState('saved');
      onToast?.('已保存并创建快照');
    } else if (countdownEndAtRef.current !== null) {
      setStatusState('counting');
    }
  }, [
    diagramId,
    isReadOnly,
    clearPendingDebounce,
    saveAndCreateSnapshot,
    stopCountdown,
    canvasSignature,
    onToast,
  ]);

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
  const countdownLabel = `${Math.floor(remainingSecs / 60)}:${String(remainingSecs % 60).padStart(2, '0')}`;
  const dashOffset = RING_CIRCUMFERENCE * (1 - progress);

  const tooltip = isSaving
    ? '正在保存并创建快照...'
    : progress > 0
      ? `3 分钟自动快照倒计时：${countdownLabel} · 点击立即保存并创建快照 (Ctrl+S / Cmd+S)`
      : `画布已同步${formattedTime ? `（上次保存于 ${formattedTime}）` : ''} · 点击立即保存并创建快照 (Ctrl+S / Cmd+S)`;

  return (
    <div className="relative inline-flex items-center justify-center w-9 h-9 shrink-0 select-none">
      <svg
        data-testid="snapshot-progress-ring"
        className="absolute inset-0 w-9 h-9 pointer-events-none"
        viewBox="0 0 36 36"
        aria-hidden="true"
      >
        <circle
          cx="18"
          cy="18"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          className="text-fs-border/70"
        />
        {progress > 0 && (
          <circle
            cx="18"
            cy="18"
            r={RING_RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            transform="rotate(-90 18 18)"
            className="text-fs-primary transition-[stroke-dashoffset] duration-200 ease-linear"
          />
        )}
      </svg>

      <button
        type="button"
        data-testid="save-status-indicator"
        data-status={statusState}
        data-progress={progress.toFixed(3)}
        onClick={handleManualSave}
        disabled={isReadOnly || isSaving}
        title={tooltip}
        aria-label="保存与定时快照"
        className="relative z-10 inline-flex items-center justify-center w-7 h-7 rounded-full bg-fs-surface text-fs-text hover:bg-fs-bg transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-default"
      >
        {isSaving ? (
          <RotateCcw className="w-3.5 h-3.5 text-blue-500 animate-spin" />
        ) : progress > 0 ? (
          <Save className="w-3.5 h-3.5 text-fs-primary" />
        ) : (
          <Check className="w-3.5 h-3.5 text-emerald-500" />
        )}
      </button>
    </div>
  );
};

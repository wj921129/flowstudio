/**
 * @fileoverview AI 批次画布级 Visual Diff 染色与单点 Cherry-Pick 审阅台 (AiBatchDiffOverlay)
 * @description 在画布上对 AI 批次变更进行三色染色（绿新增/黄修改/红幽灵节点），支持单点撤回与悬停对比气泡
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ViewportPortal } from '@xyflow/react';
import { RotateCcw, Check, Info } from 'lucide-react';
import type { AiBatchRecord, AiBatchEntityDiff, FlowNode, FlowEdge, AiBatchRevertResult } from '@flowstudio/shared';
import { useFlowStore } from '../../stores/flow-store';
import { useCollaboration } from './collaboration-provider';
import { sanitizeDiagramId } from './ai-batch-banner';
import { toWorldPosition } from '../canvas/utils/group-calculator';

export const AiBatchDiffOverlay: React.FC = () => {
  const aiReviewActive = useFlowStore((s) => s.aiReviewActive);
  const aiReviewBatchId = useFlowStore((s) => s.aiReviewBatchId);
  const aiAcceptedEntityIds = useFlowStore((s) => s.aiAcceptedEntityIds);
  const acceptAiEntity = useFlowStore((s) => s.acceptAiEntity);
  const updateNodeData = useFlowStore((s) => s.updateNodeData);
  const updateEdgeData = useFlowStore((s) => s.updateEdgeData);
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const showToast = useFlowStore((s) => s.showToast);
  const collab = useCollaboration();

  const [batchRecord, setBatchRecord] = useState<AiBatchRecord | null>(null);
  const [revertingIds, setRevertingIds] = useState<Set<string>>(new Set());
  const [dismissedEntityIds, setDismissedEntityIds] = useState<Set<string>>(new Set());

  const cleanDiagramId = useMemo(
    () => sanitizeDiagramId(collab?.diagramId),
    [collab?.diagramId]
  );

  // 拉取当前审阅批次的详细 diff 数据
  const fetchBatchDetail = useCallback(async () => {
    if (!cleanDiagramId || !aiReviewActive) return;
    try {
      const res = await fetch(`/api/diagrams/${cleanDiagramId}/ai-batches`);
      if (!res.ok) return;
      const batches = (await res.json()) as AiBatchRecord[];
      const validBatches = (batches || []).filter((b) => b.status !== 'reverted');
      const target = aiReviewBatchId
        ? validBatches.find((b) => b.batchId === aiReviewBatchId)
        : validBatches[0];
      setBatchRecord(target || null);
    } catch (err) {
      console.error('[AiBatchDiffOverlay] 拉取批次失败:', err);
    }
  }, [cleanDiagramId, aiReviewActive, aiReviewBatchId]);

  useEffect(() => {
    if (aiReviewActive) {
      fetchBatchDetail();
    } else {
      setBatchRecord(null);
      setDismissedEntityIds(new Set());
    }
  }, [aiReviewActive, fetchBatchDetail]);

  // 单点 Cherry-Pick 撤回
  const handleRevertSingleItem = async (entityId: string) => {
    if (!cleanDiagramId || !batchRecord) return;
    setRevertingIds((prev) => new Set(prev).add(entityId));

    try {
      const res = await fetch(
        `/api/diagrams/${cleanDiagramId}/ai-batches/${batchRecord.batchId}/revert-items`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entityIds: [entityId] }),
        }
      );
      const data = (await res.json()) as AiBatchRevertResult & { error?: string };
      if (res.ok && data.success) {
        if (data.skipped && data.skipped.length > 0) {
          const reason = data.skipped[0].reason || '部分字段已被人工修改或锁定，已安全跳过';
          showToast(`⚠️ 已撤回未冲突部分：${reason}`);
        } else {
          showToast('✓ 已成功精准撤回该项');
        }
        setDismissedEntityIds((prev) => new Set(prev).add(entityId));
        // 刷新批次信息
        fetchBatchDetail();
      } else {
        if (data.error && !data.error.includes('补偿回滚')) {
          showToast(`撤回提示: ${data.error}`);
        }
      }
    } catch (err: any) {
      console.warn('[AiBatchDiffOverlay] 撤回请求异常:', err);
      showToast('网络连接异常，撤回请求未送达，请稍后重试');
    } finally {
      setRevertingIds((prev) => {
        const next = new Set(prev);
        next.delete(entityId);
        return next;
      });
    }
  };

  // 保留单项（标记采纳保护免受整批撤回，并从本次 Visual Diff 预览中隐藏，FS-028）
  const handleAcceptSingleItem = (entityId: string, entityType: 'node' | 'edge' = 'node') => {
    acceptAiEntity(entityId);
    setDismissedEntityIds((prev) => new Set(prev).add(entityId));
    if (entityType === 'node') {
      updateNodeData(entityId, { aiAccepted: true });
    } else if (entityType === 'edge') {
      updateEdgeData(entityId, { aiAccepted: true });
    }
    showToast('✓ 已确认保留该项（免受整批撤回影响）');
  };

  if (!aiReviewActive || !batchRecord || !batchRecord.diffs) {
    return null;
  }

  const nodeMap = new Map<string, FlowNode>(nodes.map((n) => [n.id, n]));
  const edgeMap = new Map<string, FlowEdge>(edges.map((e) => [e.id, e]));

  const getAbsoluteNodePos = (node: FlowNode): { x: number; y: number } => {
    if (node.parentId && nodeMap.has(node.parentId)) {
      const parent = nodeMap.get(node.parentId)!;
      const parentPos = getAbsoluteNodePos(parent);
      return toWorldPosition(node.position, parentPos);
    }
    return { ...node.position };
  };

  const getAbsoluteBeforePos = (pos: { x: number; y: number }, parentId?: string): { x: number; y: number } => {
    if (parentId && nodeMap.has(parentId)) {
      const parent = nodeMap.get(parentId)!;
      const parentPos = getAbsoluteNodePos(parent);
      return toWorldPosition(pos, parentPos);
    }
    return { ...pos };
  };

  // 过滤未撤回、未被手动隐藏或确认保留的 diff 实体
  const activeDiffs = batchRecord.diffs.filter(
    (d) => !d.reverted && !dismissedEntityIds.has(d.entityId) && !aiAcceptedEntityIds.has(d.entityId)
  );

  return (
    <ViewportPortal>
      {activeDiffs.map((diff) => {
        const isReverting = revertingIds.has(diff.entityId);

        // 1. 新增节点高亮 (翡翠绿 + 新增)
        if (diff.opType === 'add' && diff.entityType === 'node') {
          const liveNode = nodeMap.get(diff.entityId);
          if (!liveNode) return null;
          const absPos = getAbsoluteNodePos(liveNode);
          const w = liveNode.width ?? 140;
          const h = liveNode.height ?? 60;

          return (
            <div
              key={`diff-add-${diff.entityId}`}
              style={{
                position: 'absolute',
                left: `${absPos.x - 4}px`,
                top: `${absPos.y - 4}px`,
                width: `${w + 8}px`,
                height: `${h + 8}px`,
                pointerEvents: 'none',
              }}
              className="z-30 rounded-xl border-2 border-emerald-500 bg-emerald-500/10 shadow-[0_0_12px_rgba(16,185,129,0.35)] transition-all"
            >
              {/* 顶部标签与 Cherry-Pick 操作条 */}
              <div className="absolute -top-6 left-0 right-0 flex items-center justify-between pointer-events-auto select-none">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500 text-white shadow-xs">
                  + AI 新增
                </span>
                <div className="flex items-center gap-1 bg-slate-900/85 backdrop-blur px-1 py-0.5 rounded-md shadow-md text-white border border-slate-700/60">
                  <button
                    type="button"
                    onClick={() => handleAcceptSingleItem(diff.entityId, 'node')}
                    title="保留此项"
                    className="p-1 hover:bg-emerald-600 rounded transition-colors text-emerald-400 hover:text-white cursor-pointer"
                  >
                    <Check className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRevertSingleItem(diff.entityId)}
                    disabled={isReverting}
                    title="撤回此项 (Cherry-Pick)"
                    className="p-1 hover:bg-rose-600 rounded transition-colors text-rose-400 hover:text-white cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className={`w-3 h-3 ${isReverting ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>
            </div>
          );
        }

        // 2. 修改节点高亮 (琥珀色 + 悬停对比气泡)
        if (diff.opType === 'update' && diff.entityType === 'node') {
          const liveNode = nodeMap.get(diff.entityId);
          if (!liveNode) return null;
          const absPos = getAbsoluteNodePos(liveNode);
          const w = liveNode.width ?? 140;
          const h = liveNode.height ?? 60;

          const beforeData = (diff.beforeState?.data as Record<string, unknown>) || {};
          const afterData = (diff.afterState?.data as Record<string, unknown>) || {};
          const beforeLabel = String(beforeData.label || beforeData.laneTitle || '');
          const afterLabel = String(afterData.label || afterData.laneTitle || '');

          return (
            <div
              key={`diff-update-${diff.entityId}`}
              style={{
                position: 'absolute',
                left: `${absPos.x - 4}px`,
                top: `${absPos.y - 4}px`,
                width: `${w + 8}px`,
                height: `${h + 8}px`,
                pointerEvents: 'none',
              }}
              className="group/diff z-30 rounded-xl border-2 border-amber-500 bg-amber-500/10 shadow-[0_0_12px_rgba(245,158,11,0.35)] transition-all"
            >
              {/* 顶部标签与 Cherry-Pick 操作条 */}
              <div className="absolute -top-6 left-0 right-0 flex items-center justify-between pointer-events-auto select-none">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500 text-white shadow-xs flex items-center gap-1">
                  ✎ AI 修改
                  <Info className="w-2.5 h-2.5 opacity-80" />
                </span>
                <div className="flex items-center gap-1 bg-slate-900/85 backdrop-blur px-1 py-0.5 rounded-md shadow-md text-white border border-slate-700/60">
                  <button
                    type="button"
                    onClick={() => handleAcceptSingleItem(diff.entityId, 'node')}
                    title="保留此项"
                    className="p-1 hover:bg-emerald-600 rounded transition-colors text-emerald-400 hover:text-white cursor-pointer"
                  >
                    <Check className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRevertSingleItem(diff.entityId)}
                    disabled={isReverting}
                    title="撤回此项修改 (Cherry-Pick)"
                    className="p-1 hover:bg-rose-600 rounded transition-colors text-rose-400 hover:text-white cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className={`w-3 h-3 ${isReverting ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* 悬停展示“修改前 → 修改后”对比气泡 */}
              <div className="opacity-0 group-hover/diff:opacity-100 transition-opacity duration-200 pointer-events-auto absolute -bottom-16 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-lg bg-slate-900/95 text-white text-[11px] shadow-2xl border border-slate-700/80 whitespace-nowrap backdrop-blur-md">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 line-through">前: {beforeLabel || '(空)'}</span>
                  <span className="text-amber-400">→</span>
                  <span className="text-emerald-400 font-semibold">后: {afterLabel || '(空)'}</span>
                </div>
              </div>
            </div>
          );
        }

        // 3. 被删节点原位幽灵预览 (绯红色虚线 Ghost Preview，M3: 换算绝对坐标)
        if (diff.opType === 'delete' && diff.entityType === 'node') {
          const beforeState = diff.beforeState || {};
          const rawBeforePos = (beforeState.position as { x: number; y: number }) || { x: 100, y: 100 };
          const beforeParentId = beforeState.parentId as string | undefined;
          const beforePos = getAbsoluteBeforePos(rawBeforePos, beforeParentId);
          const beforeW = (beforeState.width as number) || 140;
          const beforeH = (beforeState.height as number) || 60;
          const beforeData = (beforeState.data as Record<string, unknown>) || {};
          const beforeLabel = String(beforeData.label || beforeData.laneTitle || '已删除节点');

          return (
            <div
              key={`diff-del-${diff.entityId}`}
              style={{
                position: 'absolute',
                left: `${beforePos.x}px`,
                top: `${beforePos.y}px`,
                width: `${beforeW}px`,
                height: `${beforeH}px`,
                pointerEvents: 'auto',
              }}
              className="z-20 rounded-xl border-2 border-dashed border-rose-500/80 bg-rose-500/10 flex flex-col items-center justify-center p-2 text-rose-500 dark:text-rose-400 select-none backdrop-blur-xs animate-in fade-in"
            >
              <span className="text-[10px] font-bold px-1 rounded bg-rose-500/20 text-rose-600 dark:text-rose-300 mb-1">
                − AI 已删除 (幽灵预览)
              </span>
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate max-w-full">
                {beforeLabel}
              </span>

              {/* 恢复按钮 */}
              <button
                type="button"
                onClick={() => handleRevertSingleItem(diff.entityId)}
                disabled={isReverting}
                className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-600 hover:bg-rose-700 text-white shadow-xs cursor-pointer transition-colors disabled:opacity-50"
                title="撤回删除操作，原位恢复此节点"
              >
                <RotateCcw className={`w-2.5 h-2.5 ${isReverting ? 'animate-spin' : ''}`} />
                <span>恢复此项</span>
              </button>
            </div>
          );
        }

        // 4. 连线差异高亮与 Cherry-Pick 操作条 (M4: 支持连线增/改/删逐项审阅)
        if (diff.entityType === 'edge') {
          if (diff.opType === 'add' || diff.opType === 'update') {
            const liveEdge = edgeMap.get(diff.entityId);
            if (!liveEdge) return null;
            const srcNode = nodeMap.get(liveEdge.source);
            const tgtNode = nodeMap.get(liveEdge.target);
            if (!srcNode || !tgtNode) return null;

            const srcPos = getAbsoluteNodePos(srcNode);
            const tgtPos = getAbsoluteNodePos(tgtNode);
            const srcW = srcNode.width ?? 140;
            const srcH = srcNode.height ?? 60;
            const tgtW = tgtNode.width ?? 140;
            const tgtH = tgtNode.height ?? 60;

            const midX = (srcPos.x + srcW / 2 + tgtPos.x + tgtW / 2) / 2;
            const midY = (srcPos.y + srcH / 2 + tgtPos.y + tgtH / 2) / 2;

            const isAdd = diff.opType === 'add';
            const badgeColor = isAdd ? 'bg-emerald-500' : 'bg-amber-500';
            const badgeText = isAdd ? '+ AI 连线' : '✎ 连线修改';

            return (
              <div
                key={`diff-edge-${diff.entityId}`}
                style={{
                  position: 'absolute',
                  left: `${midX - 55}px`,
                  top: `${midY - 14}px`,
                  pointerEvents: 'auto',
                }}
                className="z-30 flex items-center gap-1.5 bg-slate-900/90 backdrop-blur px-2 py-1 rounded-md shadow-lg text-white border border-slate-700 select-none animate-in fade-in"
              >
                <span className={`px-1 py-0.5 rounded text-[9px] font-bold ${badgeColor} text-white`}>
                  {badgeText}
                </span>
                <button
                  type="button"
                  onClick={() => handleAcceptSingleItem(diff.entityId, 'edge')}
                  title="保留此连线"
                  className="p-1 hover:bg-emerald-600 rounded text-emerald-400 hover:text-white transition-colors cursor-pointer"
                >
                  <Check className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => handleRevertSingleItem(diff.entityId)}
                  disabled={isReverting}
                  title="撤回此连线 (Cherry-Pick)"
                  className="p-1 hover:bg-rose-600 rounded text-rose-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RotateCcw className={`w-3 h-3 ${isReverting ? 'animate-spin' : ''}`} />
                </button>
              </div>
            );
          }

          if (diff.opType === 'delete') {
            const beforeEdge = diff.beforeState || {};
            const srcId = beforeEdge.source as string;
            const tgtId = beforeEdge.target as string;
            const srcNode = nodeMap.get(srcId);
            const tgtNode = nodeMap.get(tgtId);
            if (!srcNode || !tgtNode) return null;

            const srcPos = getAbsoluteNodePos(srcNode);
            const tgtPos = getAbsoluteNodePos(tgtNode);
            const midX = (srcPos.x + (srcNode.width ?? 140) / 2 + tgtPos.x + (tgtNode.width ?? 140) / 2) / 2;
            const midY = (srcPos.y + (srcNode.height ?? 60) / 2 + tgtPos.y + (tgtNode.height ?? 60) / 2) / 2;

            return (
              <div
                key={`diff-del-edge-${diff.entityId}`}
                style={{
                  position: 'absolute',
                  left: `${midX - 60}px`,
                  top: `${midY - 14}px`,
                  pointerEvents: 'auto',
                }}
                className="z-20 flex items-center gap-1.5 bg-rose-950/90 backdrop-blur px-2 py-1 rounded-md shadow-lg text-rose-200 border border-rose-800 select-none animate-in fade-in"
              >
                <span className="text-[9px] font-bold px-1 rounded bg-rose-600 text-white">
                  − 已删连线
                </span>
                <button
                  type="button"
                  onClick={() => handleRevertSingleItem(diff.entityId)}
                  disabled={isReverting}
                  title="恢复此连线"
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-600 hover:bg-rose-700 text-white cursor-pointer transition-colors disabled:opacity-50"
                >
                  <RotateCcw className={`w-2.5 h-2.5 ${isReverting ? 'animate-spin' : ''}`} />
                  <span>恢复</span>
                </button>
              </div>
            );
          }
        }

        return null;
      })}
    </ViewportPortal>
  );
};

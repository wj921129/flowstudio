import React from 'react';
import { ViewportPortal } from '@xyflow/react';
import type { FlowNode, FlowEdge } from '@flowstudio/shared';
import { useFlowStore } from '../../stores/flow-store';
import { useSnapshotDiffStore } from './snapshot-diff-store';
import { toWorldPosition } from '../canvas/utils/group-calculator';

export const SnapshotDiffOverlay: React.FC = () => {
  const isDiffActive = useSnapshotDiffStore((s) => s.isDiffActive);
  const diffResult = useSnapshotDiffStore((s) => s.diffResult);
  const selectedItemId = useSnapshotDiffStore((s) => s.selectedItemId);
  const selectItem = useSnapshotDiffStore((s) => s.selectItem);
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);

  if (!isDiffActive || !diffResult) return null;

  const nodeMap = new Map<string, FlowNode>(nodes.map((n) => [n.id, n]));
  const edgeMap = new Map<string, FlowEdge>(edges.map((e) => [e.id, e]));

  const getAbsolutePos = (node: FlowNode): { x: number; y: number } => {
    if (node.parentId && nodeMap.has(node.parentId)) {
      const parentPos = getAbsolutePos(nodeMap.get(node.parentId)!);
      return toWorldPosition(node.position, parentPos);
    }
    return { ...node.position };
  };

  const activeItems = diffResult.items;

  return (
    <ViewportPortal>
      {activeItems.map((item) => {
        const isSelected = selectedItemId === item.id;

        if (item.entityType === 'node') {
          if (item.opType === 'add') {
            const liveNode = nodeMap.get(item.id) || (item.after as FlowNode);
            if (!liveNode) return null;
            const absPos = liveNode.position ? getAbsolutePos(liveNode) : { x: 0, y: 0 };
            const w = liveNode.width ?? 160;
            const h = liveNode.height ?? 80;

            return (
              <div
                key={`snap-diff-add-${item.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  selectItem(item.id);
                }}
                style={{
                  position: 'absolute',
                  left: `${absPos.x - 4}px`,
                  top: `${absPos.y - 4}px`,
                  width: `${w + 8}px`,
                  height: `${h + 8}px`,
                  pointerEvents: 'auto',
                }}
                className={`z-30 rounded-xl border-2 transition-all cursor-pointer ${
                  isSelected
                    ? 'border-emerald-500 bg-emerald-500/20 shadow-[0_0_16px_rgba(16,185,129,0.5)] scale-[1.01]'
                    : 'border-emerald-500/80 bg-emerald-500/10 hover:bg-emerald-500/20'
                }`}
              >
                <div className="absolute -top-5 left-1 pointer-events-none select-none">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500 text-white shadow-xs">
                    + 相对新增
                  </span>
                </div>
              </div>
            );
          }

          if (item.opType === 'update') {
            const liveNode = nodeMap.get(item.id) || (item.after as FlowNode);
            if (!liveNode) return null;
            const absPos = liveNode.position ? getAbsolutePos(liveNode) : { x: 0, y: 0 };
            const w = liveNode.width ?? 160;
            const h = liveNode.height ?? 80;

            return (
              <div
                key={`snap-diff-upd-${item.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  selectItem(item.id);
                }}
                style={{
                  position: 'absolute',
                  left: `${absPos.x - 4}px`,
                  top: `${absPos.y - 4}px`,
                  width: `${w + 8}px`,
                  height: `${h + 8}px`,
                  pointerEvents: 'auto',
                }}
                className={`group/diff z-30 rounded-xl border-2 transition-all cursor-pointer ${
                  isSelected
                    ? 'border-amber-500 bg-amber-500/20 shadow-[0_0_16px_rgba(245,158,11,0.5)] scale-[1.01]'
                    : 'border-amber-500/80 bg-amber-500/10 hover:bg-amber-500/20'
                }`}
              >
                <div className="absolute -top-5 left-1 pointer-events-none select-none">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500 text-white shadow-xs">
                    ✎ 相对修改
                  </span>
                </div>

                <div className="opacity-0 group-hover/diff:opacity-100 transition-opacity duration-150 pointer-events-none absolute -bottom-10 left-1/2 -translate-x-1/2 z-50 px-2.5 py-1 rounded-md bg-slate-900/95 text-white text-[10px] shadow-lg border border-slate-700 whitespace-nowrap">
                  {item.description}
                </div>
              </div>
            );
          }

          if (item.opType === 'delete') {
            const before = item.before as FlowNode;
            if (!before || !before.position) return null;
            const w = before.width ?? 160;
            const h = before.height ?? 80;

            return (
              <div
                key={`snap-diff-del-${item.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  selectItem(item.id);
                }}
                style={{
                  position: 'absolute',
                  left: `${before.position.x}px`,
                  top: `${before.position.y}px`,
                  width: `${w}px`,
                  height: `${h}px`,
                  pointerEvents: 'auto',
                }}
                className={`z-30 rounded-xl border-2 border-dashed transition-all cursor-pointer ${
                  isSelected
                    ? 'border-rose-500 bg-rose-500/20 shadow-[0_0_16px_rgba(244,63,94,0.4)]'
                    : 'border-rose-500/70 bg-rose-500/10 hover:bg-rose-500/15'
                }`}
              >
                <div className="absolute -top-5 left-1 pointer-events-none select-none">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500 text-white shadow-xs">
                    ✕ 相对删除
                  </span>
                </div>
                <div className="w-full h-full flex items-center justify-center p-2 text-center text-xs text-rose-500/90 font-medium select-none">
                  {item.label}
                </div>
              </div>
            );
          }
        }

        if (item.entityType === 'edge') {
          const liveEdge = edgeMap.get(item.id) || (item.after as FlowEdge) || (item.before as FlowEdge);
          if (!liveEdge) return null;
          const srcNode = nodeMap.get(liveEdge.source);
          const tgtNode = nodeMap.get(liveEdge.target);
          if (!srcNode || !tgtNode) return null;
          const sPos = getAbsolutePos(srcNode);
          const tPos = getAbsolutePos(tgtNode);
          const midX = (sPos.x + (srcNode.width ?? 160) / 2 + tPos.x + (tgtNode.width ?? 160) / 2) / 2;
          const midY = (sPos.y + (srcNode.height ?? 80) / 2 + tPos.y + (tgtNode.height ?? 80) / 2) / 2;

          const badgeColor =
            item.opType === 'add'
              ? 'bg-emerald-500 text-white'
              : item.opType === 'update'
              ? 'bg-amber-500 text-white'
              : 'bg-rose-500 text-white';

          return (
            <div
              key={`snap-diff-edge-${item.id}`}
              onClick={(e) => {
                e.stopPropagation();
                selectItem(item.id);
              }}
              style={{
                position: 'absolute',
                left: `${midX - 35}px`,
                top: `${midY - 10}px`,
                pointerEvents: 'auto',
              }}
              className="z-30 select-none cursor-pointer"
            >
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold shadow-xs ${badgeColor} ${isSelected ? 'ring-2 ring-white scale-110' : ''}`}>
                {item.opType === 'add' ? '+ 连线' : item.opType === 'update' ? '✎ 连线' : '✕ 连线'}
              </span>
            </div>
          );
        }

        return null;
      })}
    </ViewportPortal>
  );
};

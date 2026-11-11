import React, { useEffect, useCallback, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import {
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  X,
  Compass,
} from 'lucide-react';
import { usePresentationStore } from './presentation-store';
import { useFlowStore } from '../../stores/flow-store';
import { getNodeWorldPosition } from '../canvas/utils/split-insert-manager';
import type { FlowNode } from '@flowstudio/shared';

export const PresentationControls: React.FC = () => {
  const isPresenting = usePresentationStore((s) => s.isPresenting);
  const presentationIndex = usePresentationStore((s) => s.presentationIndex);
  const storyboardNodeIds = usePresentationStore((s) => s.storyboardNodeIds);
  const isAutoPlaying = usePresentationStore((s) => s.isAutoPlaying);
  const nextStep = usePresentationStore((s) => s.nextStep);
  const prevStep = usePresentationStore((s) => s.prevStep);
  const stopPresentation = usePresentationStore((s) => s.stopPresentation);
  const toggleAutoPlay = usePresentationStore((s) => s.toggleAutoPlay);

  const nodes = useFlowStore((s) => s.nodes);
  const toggleSpotlightMode = useFlowStore((s) => s.toggleSpotlightMode);
  const setSpotlightTarget = useFlowStore((s) => s.setSpotlightTarget);

  const { setViewport, fitView } = useReactFlow();
  const autoPlayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentNodeId = storyboardNodeIds[presentationIndex];
  const currentNode = nodes.find((n) => n.id === currentNodeId);
  const currentLabel = currentNode
    ? String((currentNode.data as any)?.label || currentNode.id)
    : '全貌总览';

  const focusCurrentStep = useCallback(
    (targetNode: FlowNode | undefined) => {
      if (!targetNode) {
        fitView({ duration: 400, padding: 0.2 });
        toggleSpotlightMode(false);
        setSpotlightTarget(null);
        return;
      }

      toggleSpotlightMode(true);
      setSpotlightTarget(targetNode.id, 'all');

      const nodeMap = new Map<string, FlowNode>(nodes.map((n) => [n.id, n]));
      const worldPos = getNodeWorldPosition(targetNode, nodeMap);
      const w = targetNode.width || (targetNode.data as any)?.width || 140;
      const h = targetNode.height || (targetNode.data as any)?.height || 70;

      const centerX = worldPos.x + w / 2;
      const centerY = worldPos.y + h / 2;
      const zoom = 1.15;

      setViewport(
        {
          x: -centerX * zoom + window.innerWidth / 2,
          y: -centerY * zoom + window.innerHeight / 2,
          zoom,
        },
        { duration: 400 }
      );
    },
    [nodes, setViewport, fitView, toggleSpotlightMode, setSpotlightTarget]
  );

  useEffect(() => {
    if (!isPresenting) return;
    focusCurrentStep(currentNode);
  }, [isPresenting, presentationIndex, focusCurrentStep, currentNode]);

  useEffect(() => {
    if (!isAutoPlaying || !isPresenting) {
      if (autoPlayTimerRef.current) clearInterval(autoPlayTimerRef.current);
      return;
    }

    autoPlayTimerRef.current = setInterval(() => {
      const { presentationIndex: curIdx, storyboardNodeIds: seq } = usePresentationStore.getState();
      if (curIdx >= seq.length - 1) {
        toggleAutoPlay();
      } else {
        nextStep();
      }
    }, 3500);

    return () => {
      if (autoPlayTimerRef.current) clearInterval(autoPlayTimerRef.current);
    };
  }, [isAutoPlaying, isPresenting, nextStep, toggleAutoPlay]);

  useEffect(() => {
    if (!isPresenting) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'Space' || e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        nextStep();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        prevStep();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        stopPresentation();
        toggleSpotlightMode(false);
        setSpotlightTarget(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPresenting, nextStep, prevStep, stopPresentation, toggleSpotlightMode, setSpotlightTarget]);

  if (!isPresenting) return null;

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 select-none">
      <div className="flex items-center gap-2 px-3 py-2 bg-zinc-900/90 dark:bg-zinc-800/90 text-white rounded-full shadow-2xl backdrop-blur-xl border border-zinc-700/60 ring-1 ring-white/10 animate-in fade-in slide-in-from-bottom-3 duration-200">
        <button
          onClick={prevStep}
          disabled={presentationIndex === 0}
          title="上一页 (← / PageUp)"
          className="p-1.5 rounded-full hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-transparent transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <button
          onClick={toggleAutoPlay}
          title={isAutoPlaying ? '暂停轮播' : '自动播放 (每3.5秒)'}
          className={`p-1.5 rounded-full transition-colors cursor-pointer ${
            isAutoPlaying ? 'bg-indigo-600 text-white' : 'hover:bg-white/15 text-zinc-300'
          }`}
        >
          {isAutoPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>

        <button
          onClick={nextStep}
          disabled={presentationIndex >= storyboardNodeIds.length - 1}
          title="下一页 (空格 / → / PageDown)"
          className="p-1.5 rounded-full hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-transparent transition-colors cursor-pointer"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        <div className="h-4 w-px bg-zinc-700 mx-1" />

        <div className="flex items-center gap-2 px-2 text-xs">
          <span className="font-mono font-semibold text-indigo-400">
            {storyboardNodeIds.length > 0 ? `${presentationIndex + 1}/${storyboardNodeIds.length}` : '0/0'}
          </span>
          <span className="max-w-[160px] truncate opacity-90 font-medium">
            {currentLabel}
          </span>
        </div>

        <div className="h-4 w-px bg-zinc-700 mx-1" />

        <button
          onClick={() => {
            fitView({ duration: 350, padding: 0.15 });
            toggleSpotlightMode(false);
            setSpotlightTarget(null);
          }}
          title="俯瞰全图"
          className="p-1.5 rounded-full hover:bg-white/15 text-zinc-300 transition-colors cursor-pointer"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => {
            stopPresentation();
            toggleSpotlightMode(false);
            setSpotlightTarget(null);
          }}
          title="退出演示 (Esc)"
          className="p-1.5 rounded-full hover:bg-red-500/30 text-zinc-400 hover:text-red-300 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

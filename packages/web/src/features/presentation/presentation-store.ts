import { create } from 'zustand';
import type { FlowNode, XYPosition } from '@flowstudio/shared';

export interface PresentationState {
  isReadOnly: boolean;
  isPresenting: boolean;
  presentationIndex: number;
  storyboardNodeIds: string[];
  isAutoPlaying: boolean;
  isWatermarkEnabled: boolean;
  watermarkCustomText: string;

  setReadOnly: (readOnly: boolean) => void;
  startPresentation: (nodes: FlowNode[]) => void;
  stopPresentation: () => void;
  nextStep: () => void;
  prevStep: () => void;
  setPresentationIndex: (idx: number) => void;
  toggleAutoPlay: () => void;
  toggleWatermark: () => void;
  setWatermarkCustomText: (text: string) => void;
}

export function parseReadOnlyFromLocation(): boolean {
  if (typeof window === 'undefined') return false;
  const searchParams = new URLSearchParams(window.location.search);
  if (
    searchParams.get('readonly') === 'true' ||
    searchParams.get('readonly') === '1' ||
    searchParams.get('mode') === 'readonly' ||
    searchParams.get('view') === 'readonly'
  ) {
    return true;
  }
  const hash = window.location.hash || '';
  const qIdx = hash.indexOf('?');
  if (qIdx !== -1) {
    const hashParams = new URLSearchParams(hash.slice(qIdx));
    if (
      hashParams.get('readonly') === 'true' ||
      hashParams.get('readonly') === '1' ||
      hashParams.get('mode') === 'readonly' ||
      hashParams.get('view') === 'readonly'
    ) {
      return true;
    }
  }
  return false;
}

export function buildStoryboardSequence(nodes: FlowNode[]): string[] {
  const presentable = nodes.filter(
    (n) => n.type !== 'lane' && n.type !== 'pool' && n.type !== 'group'
  );
  if (presentable.length === 0) return [];

  const isStartNode = (n: FlowNode) =>
    (n.data as any)?.label === '开始' || n.type === 'start-end';

  const starts = presentable.filter(isStartNode);
  const others = presentable.filter((n) => !isStartNode(n));

  const sortByPos = (a: FlowNode, b: FlowNode) => {
    if (Math.abs(a.position.y - b.position.y) > 80) {
      return a.position.y - b.position.y;
    }
    return a.position.x - b.position.x;
  };

  starts.sort(sortByPos);
  others.sort(sortByPos);

  return [...starts, ...others].map((n) => n.id);
}

export const usePresentationStore = create<PresentationState>((set, get) => ({
  isReadOnly: parseReadOnlyFromLocation(),
  isPresenting: false,
  presentationIndex: 0,
  storyboardNodeIds: [],
  isAutoPlaying: false,
  isWatermarkEnabled: parseReadOnlyFromLocation(),
  watermarkCustomText: '内部机密·严禁外传',

  setReadOnly: (isReadOnly) =>
    set({
      isReadOnly,
      isWatermarkEnabled: isReadOnly ? true : get().isWatermarkEnabled,
    }),

  startPresentation: (nodes) => {
    const sequence = buildStoryboardSequence(nodes);
    set({
      isPresenting: true,
      presentationIndex: 0,
      storyboardNodeIds: sequence,
      isAutoPlaying: false,
    });
  },

  stopPresentation: () => {
    set({
      isPresenting: false,
      isAutoPlaying: false,
    });
  },

  nextStep: () => {
    const { presentationIndex, storyboardNodeIds } = get();
    if (storyboardNodeIds.length === 0) return;
    const nextIdx = Math.min(presentationIndex + 1, storyboardNodeIds.length - 1);
    set({ presentationIndex: nextIdx });
  },

  prevStep: () => {
    const { presentationIndex } = get();
    const prevIdx = Math.max(0, presentationIndex - 1);
    set({ presentationIndex: prevIdx });
  },

  setPresentationIndex: (idx) => {
    const { storyboardNodeIds } = get();
    if (idx >= 0 && idx < storyboardNodeIds.length) {
      set({ presentationIndex: idx });
    }
  },

  toggleAutoPlay: () => set((s) => ({ isAutoPlaying: !s.isAutoPlaying })),
  toggleWatermark: () => set((s) => ({ isWatermarkEnabled: !s.isWatermarkEnabled })),
  setWatermarkCustomText: (text) => set({ watermarkCustomText: text }),
}));

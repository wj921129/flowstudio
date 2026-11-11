import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  usePresentationStore,
  parseReadOnlyFromLocation,
  buildStoryboardSequence,
} from '../src/features/presentation/presentation-store';
import type { FlowNode } from '@flowstudio/shared';

describe('Presentation & Read-Only & Watermark System', () => {
  beforeEach(() => {
    usePresentationStore.setState({
      isReadOnly: false,
      isPresenting: false,
      presentationIndex: 0,
      storyboardNodeIds: [],
      isAutoPlaying: false,
      isWatermarkEnabled: false,
      watermarkCustomText: '内部机密·严禁外传',
    });
  });

  describe('URL Read-Only Parameter Parsing', () => {
    const originalWindow = (global as any).window;

    afterEach(() => {
      (global as any).window = originalWindow;
    });

    it('detects search parameters: ?readonly=true, ?mode=readonly, ?view=readonly', () => {
      (global as any).window = {
        location: {
          search: '?readonly=true',
          hash: '#/diagram/diag-1',
        },
      };
      expect(parseReadOnlyFromLocation()).toBe(true);

      (global as any).window = {
        location: {
          search: '?mode=readonly',
          hash: '#/diagram/diag-1',
        },
      };
      expect(parseReadOnlyFromLocation()).toBe(true);

      (global as any).window = {
        location: {
          search: '?view=readonly',
          hash: '#/diagram/diag-1',
        },
      };
      expect(parseReadOnlyFromLocation()).toBe(true);
    });

    it('detects hash parameters: #/diagram/diag-1?readonly=true', () => {
      (global as any).window = {
        location: {
          search: '',
          hash: '#/diagram/diag-1?readonly=true',
        },
      };
      expect(parseReadOnlyFromLocation()).toBe(true);

      (global as any).window = {
        location: {
          search: '',
          hash: '#/diagram/diag-1?readonly=1',
        },
      };
      expect(parseReadOnlyFromLocation()).toBe(true);
    });

    it('returns false when no readonly parameter is present', () => {
      (global as any).window = {
        location: {
          search: '',
          hash: '#/diagram/diag-1',
        },
      };
      expect(parseReadOnlyFromLocation()).toBe(false);
    });
  });

  describe('Storyboard Sequence Generation', () => {
    it('filters out containers (lane/pool/group) and places start nodes first', () => {
      const nodes: FlowNode[] = [
        { id: 'pool-1', type: 'pool', position: { x: 0, y: 0 }, data: { label: '泳池' } },
        { id: 'lane-1', type: 'lane', parentId: 'pool-1', position: { x: 0, y: 40 }, data: { label: '泳道' } },
        { id: 'node-step-1', type: 'process', parentId: 'lane-1', position: { x: 100, y: 60 }, data: { label: '第一步' } },
        { id: 'node-start', type: 'start', parentId: 'lane-1', position: { x: 50, y: 60 }, data: { label: '开始' } },
        { id: 'node-step-2', type: 'decision', parentId: 'lane-1', position: { x: 200, y: 60 }, data: { label: '校验分支' } },
      ];

      const sequence = buildStoryboardSequence(nodes);
      expect(sequence).toHaveLength(3);
      expect(sequence[0]).toBe('node-start');
      expect(sequence).toContain('node-step-1');
      expect(sequence).toContain('node-step-2');
      expect(sequence).not.toContain('pool-1');
      expect(sequence).not.toContain('lane-1');
    });

    it('handles empty nodes gracefully', () => {
      expect(buildStoryboardSequence([])).toEqual([]);
    });
  });

  describe('Presentation State Controls & Step Progression', () => {
    it('starts presentation, navigates steps sequentially, and stops cleanly', () => {
      const store = usePresentationStore.getState();
      const nodes: FlowNode[] = [
        { id: 'n1', type: 'start', position: { x: 0, y: 0 }, data: { label: '开始' } },
        { id: 'n2', type: 'process', position: { x: 100, y: 0 }, data: { label: '步骤一' } },
        { id: 'n3', type: 'end', position: { x: 200, y: 0 }, data: { label: '结束' } },
      ];

      store.startPresentation(nodes);
      expect(usePresentationStore.getState().isPresenting).toBe(true);
      expect(usePresentationStore.getState().presentationIndex).toBe(0);
      expect(usePresentationStore.getState().storyboardNodeIds).toHaveLength(3);

      store.nextStep();
      expect(usePresentationStore.getState().presentationIndex).toBe(1);

      store.nextStep();
      expect(usePresentationStore.getState().presentationIndex).toBe(2);

      // Boundary: nextStep should not exceed length - 1
      store.nextStep();
      expect(usePresentationStore.getState().presentationIndex).toBe(2);

      store.prevStep();
      expect(usePresentationStore.getState().presentationIndex).toBe(1);

      store.stopPresentation();
      expect(usePresentationStore.getState().isPresenting).toBe(false);
    });

    it('toggles autoplay and watermark independently', () => {
      const store = usePresentationStore.getState();

      expect(usePresentationStore.getState().isAutoPlaying).toBe(false);
      store.toggleAutoPlay();
      expect(usePresentationStore.getState().isAutoPlaying).toBe(true);
      store.toggleAutoPlay();
      expect(usePresentationStore.getState().isAutoPlaying).toBe(false);

      expect(usePresentationStore.getState().isWatermarkEnabled).toBe(false);
      store.toggleWatermark();
      expect(usePresentationStore.getState().isWatermarkEnabled).toBe(true);
      store.toggleWatermark();
      expect(usePresentationStore.getState().isWatermarkEnabled).toBe(false);
    });

    it('automatically enables watermark when readonly mode is set', () => {
      const store = usePresentationStore.getState();
      expect(usePresentationStore.getState().isWatermarkEnabled).toBe(false);

      store.setReadOnly(true);
      expect(usePresentationStore.getState().isReadOnly).toBe(true);
      expect(usePresentationStore.getState().isWatermarkEnabled).toBe(true);
    });
  });
});

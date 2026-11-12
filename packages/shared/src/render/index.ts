import { normalizeSpec } from '../spec/normalize.js';
import type { DiagramSpec, Paradigm } from '../spec/types.js';
import { ORIGIN } from './constants.js';
import { renderSwimlane } from './swimlane.js';
import { renderTiered } from './tiered.js';
import { renderTimeline } from './timeline.js';
import { renderTree } from './tree.js';
import type { RenderContext, RenderOptions, RenderResult } from './types.js';
import { renderVerticalFlow } from './vertical-flow.js';

const RENDERERS: Record<Paradigm, (n: ReturnType<typeof normalizeSpec>, ctx: RenderContext) => RenderResult> = {
  'vertical-flow': renderVerticalFlow,
  'timeline-annotated': renderTimeline,
  swimlane: renderSwimlane,
  'tiered-dag': renderTiered,
  tree: renderTree,
};

export function renderSpec(spec: DiagramSpec, opts: RenderOptions = {}): RenderResult {
  const n = normalizeSpec(spec);
  const ctx: RenderContext = {
    idPrefix: opts.idPrefix ?? '',
    origin: opts.origin ?? { ...ORIGIN },
    fixed: opts.fixed ?? new Map(),
    laneSizes: opts.laneSizes ?? new Map(),
    poolPosition: opts.poolPosition,
    obstacles: opts.obstacles ?? new Map(),
  };
  return RENDERERS[n.paradigm](n, ctx);
}
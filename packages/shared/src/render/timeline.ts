import type { NormalizedSpec } from '../spec/normalize.js';
import { renderVerticalFlow } from './vertical-flow.js';
import type { RenderContext, RenderResult } from './types.js';

export function renderTimeline(n: NormalizedSpec, ctx: RenderContext): RenderResult {
  return renderVerticalFlow(n, ctx);
}
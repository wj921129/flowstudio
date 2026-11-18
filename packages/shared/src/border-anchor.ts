export type BorderSide = 'top' | 'right' | 'bottom' | 'left';

export interface BorderAnchor {
  side: BorderSide;
  offset: number;
}

export interface BorderSnapOption {
  fraction: number;
  label: string;
}

export const BORDER_SNAP_OPTIONS: readonly BorderSnapOption[] = [
  { fraction: 0.25, label: '1/4' },
  { fraction: 1 / 3, label: '1/3' },
  { fraction: 0.5, label: '1/2' },
  { fraction: 2 / 3, label: '2/3' },
  { fraction: 0.75, label: '3/4' },
];

export const DEFAULT_BORDER_SNAP_THRESHOLD_PX = 5;

const VALID_SIDES: ReadonlySet<string> = new Set(['top', 'right', 'bottom', 'left']);

export function clampBorderOffset(offset: number): number {
  if (!Number.isFinite(offset)) return 0.5;
  return Math.min(0.96, Math.max(0.04, offset));
}

export function parseBorderAnchorHandle(handleId?: string | null): BorderAnchor | null {
  if (!handleId || typeof handleId !== 'string') return null;
  if (VALID_SIDES.has(handleId)) {
    return { side: handleId as BorderSide, offset: 0.5 };
  }
  const match = /^(top|right|bottom|left)@(-?\d+(?:\.\d+)?)$/.exec(handleId);
  if (!match) return null;
  const side = match[1] as BorderSide;
  const offset = clampBorderOffset(Number.parseFloat(match[2]));
  return { side, offset };
}

export function formatBorderAnchorHandle(side: BorderSide, offset: number): string {
  const clamped = clampBorderOffset(offset);
  if (Math.abs(clamped - 0.5) < 0.002) {
    return side;
  }
  return `${side}@${Number(clamped.toFixed(4))}`;
}

export interface ProjectedBorderPoint {
  side: BorderSide;
  offset: number;
  x: number;
  y: number;
  snappedLabel?: string;
}

export function projectPointToNodeBorder(
  localX: number,
  localY: number,
  width: number,
  height: number,
  options?: { snapThresholdPx?: number; disableSnap?: boolean }
): ProjectedBorderPoint {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const cx = Math.min(w, Math.max(0, localX));
  const cy = Math.min(h, Math.max(0, localY));

  const distances: Array<{ side: BorderSide; dist: number; rawOffset: number; length: number }> = [
    { side: 'top', dist: Math.abs(localY), rawOffset: cx / w, length: w },
    { side: 'bottom', dist: Math.abs(localY - h), rawOffset: cx / w, length: w },
    { side: 'left', dist: Math.abs(localX), rawOffset: cy / h, length: h },
    { side: 'right', dist: Math.abs(localX - w), rawOffset: cy / h, length: h },
  ];

  distances.sort((a, b) => a.dist - b.dist);
  const best = distances[0];

  let offset = clampBorderOffset(best.rawOffset);
  let snappedLabel: string | undefined;

  if (!options?.disableSnap) {
    const thresholdPx = options?.snapThresholdPx ?? DEFAULT_BORDER_SNAP_THRESHOLD_PX;
    let bestSnapDist = Infinity;
    for (const opt of BORDER_SNAP_OPTIONS) {
      const distPx = Math.abs(offset - opt.fraction) * best.length;
      if (distPx <= thresholdPx && distPx < bestSnapDist) {
        bestSnapDist = distPx;
        offset = opt.fraction;
        snappedLabel = opt.label;
      }
    }
  }

  let x = 0;
  let y = 0;
  if (best.side === 'top') {
    x = offset * w;
    y = 0;
  } else if (best.side === 'bottom') {
    x = offset * w;
    y = h;
  } else if (best.side === 'left') {
    x = 0;
    y = offset * h;
  } else {
    x = w;
    y = offset * h;
  }

  return { side: best.side, offset, x, y, snappedLabel };
}

export function getBorderAnchorWorldPoint(
  rect: { x: number; y: number; width: number; height: number },
  handleId?: string | null,
  fallbackSide: BorderSide = 'right'
): { x: number; y: number; side: BorderSide; offset: number } {
  const parsed = parseBorderAnchorHandle(handleId) ?? { side: fallbackSide, offset: 0.5 };
  const { side, offset } = parsed;
  switch (side) {
    case 'top':
      return { x: rect.x + rect.width * offset, y: rect.y, side, offset };
    case 'bottom':
      return { x: rect.x + rect.width * offset, y: rect.y + rect.height, side, offset };
    case 'left':
      return { x: rect.x, y: rect.y + rect.height * offset, side, offset };
    case 'right':
    default:
      return { x: rect.x + rect.width, y: rect.y + rect.height * offset, side, offset };
  }
}

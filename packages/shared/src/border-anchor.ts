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

export function getShapeBorderNormalizedPoint(
  side: BorderSide,
  offset: number,
  nodeType?: string,
  dimensions?: { width: number; height: number }
): { u: number; v: number } {
  const t = clampBorderOffset(offset);

  switch (nodeType) {
    case 'decision': {
      const inset = 0.01 + Math.abs(t - 0.5) * 0.98;
      if (side === 'top') return { u: t, v: inset };
      if (side === 'bottom') return { u: t, v: 1 - inset };
      if (side === 'left') return { u: inset, v: t };
      return { u: 1 - inset, v: t };
    }
    case 'database': {
      if (side === 'top') {
        const dx = Math.min(1, Math.abs(t - 0.5) / 0.49);
        return { u: t, v: 0.13 - 0.12 * Math.sqrt(Math.max(0, 1 - dx * dx)) };
      }
      if (side === 'bottom') {
        const dx = Math.min(1, Math.abs(t - 0.5) / 0.49);
        return { u: t, v: 0.87 + 0.12 * Math.sqrt(Math.max(0, 1 - dx * dx)) };
      }
      if (side === 'left') {
        let u = 0.01;
        if (t < 0.13) {
          const dy = Math.min(1, (0.13 - t) / 0.12);
          u = 0.5 - 0.49 * Math.sqrt(Math.max(0, 1 - dy * dy));
        } else if (t > 0.87) {
          const dy = Math.min(1, (t - 0.87) / 0.12);
          u = 0.5 - 0.49 * Math.sqrt(Math.max(0, 1 - dy * dy));
        }
        return { u, v: t };
      }
      let u = 0.99;
      if (t < 0.13) {
        const dy = Math.min(1, (0.13 - t) / 0.12);
        u = 0.5 + 0.49 * Math.sqrt(Math.max(0, 1 - dy * dy));
      } else if (t > 0.87) {
        const dy = Math.min(1, (t - 0.87) / 0.12);
        u = 0.5 + 0.49 * Math.sqrt(Math.max(0, 1 - dy * dy));
      }
      return { u, v: t };
    }
    case 'io': {
      if (side === 'left') return { u: 0.11 - 0.1 * t, v: t };
      if (side === 'right') return { u: 0.99 - 0.1 * t, v: t };
      if (side === 'top') {
        return {
          u: t,
          v: t < 0.11 ? Math.min(0.99, 0.01 + ((0.11 - t) / 0.1) * 0.98) : 0.01,
        };
      }
      return {
        u: t,
        v: t > 0.89 ? Math.max(0.01, 0.99 - ((t - 0.89) / 0.1) * 0.98) : 0.99,
      };
    }
    case 'document': {
      if (side === 'top') return { u: t, v: 0.01 };
      if (side === 'bottom') {
        const v =
          t >= 0.5
            ? (() => {
                const s = (0.99 - Math.min(0.99, t)) / 0.49;
                return (1 - s) * (1 - s) * 0.92 + 2 * (1 - s) * s * 0.84 + s * s * 0.98;
              })()
            : (() => {
                const s = (0.5 - Math.max(0.01, t)) / 0.49;
                return Math.min(
                  0.995,
                  (1 - s) * (1 - s) * 0.98 + 2 * (1 - s) * s * 1.06 + s * s * 0.92
                );
              })();
        return { u: t, v };
      }
      if (side === 'left') return { u: 0.01, v: Math.min(0.92, t) };
      return { u: 0.99, v: Math.min(0.92, t) };
    }
    case 'start-end': {
      const w = Math.max(1, dimensions?.width ?? 120);
      const h = Math.max(1, dimensions?.height ?? 60);
      const r = Math.min(w, h) / 2;
      const ru = r / w;
      const rv = r / h;
      if (side === 'top' || side === 'bottom') {
        let insetV = 0;
        if (t < ru) {
          const dx = (ru - t) / ru;
          insetV = rv * (1 - Math.sqrt(Math.max(0, 1 - dx * dx)));
        } else if (t > 1 - ru) {
          const dx = (t - (1 - ru)) / ru;
          insetV = rv * (1 - Math.sqrt(Math.max(0, 1 - dx * dx)));
        }
        return { u: t, v: side === 'top' ? insetV : 1 - insetV };
      }
      let insetU = 0;
      if (t < rv) {
        const dy = (rv - t) / rv;
        insetU = ru * (1 - Math.sqrt(Math.max(0, 1 - dy * dy)));
      } else if (t > 1 - rv) {
        const dy = (t - (1 - rv)) / rv;
        insetU = ru * (1 - Math.sqrt(Math.max(0, 1 - dy * dy)));
      }
      return { u: side === 'left' ? insetU : 1 - insetU, v: t };
    }
    case 'uml-activation': {
      const w = Math.max(14, dimensions?.width ?? 32);
      const halfBar = Math.min(0.5, 7 / w);
      if (side === 'left') return { u: 0.5 - halfBar, v: t };
      if (side === 'right') return { u: 0.5 + halfBar, v: t };
      if (side === 'top') return { u: 0.5, v: 0 };
      return { u: 0.5, v: 1 };
    }
    default: {
      if (side === 'top') return { u: t, v: 0 };
      if (side === 'bottom') return { u: t, v: 1 };
      if (side === 'left') return { u: 0, v: t };
      return { u: 1, v: t };
    }
  }
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
  options?: { snapThresholdPx?: number; disableSnap?: boolean; nodeType?: string }
): ProjectedBorderPoint {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const cx = Math.min(w, Math.max(0, localX));
  const cy = Math.min(h, Math.max(0, localY));
  const dims = { width: w, height: h };

  const candidates: Array<{ side: BorderSide; rawOffset: number; length: number }> = [
    { side: 'top', rawOffset: cx / w, length: w },
    { side: 'bottom', rawOffset: cx / w, length: w },
    { side: 'left', rawOffset: cy / h, length: h },
    { side: 'right', rawOffset: cy / h, length: h },
  ];

  const distances = candidates.map((c) => {
    const pt = getShapeBorderNormalizedPoint(c.side, c.rawOffset, options?.nodeType, dims);
    const dist = Math.hypot(localX - pt.u * w, localY - pt.v * h);
    return { ...c, dist };
  });

  const minDist = Math.min(...distances.map((d) => d.dist));
  const nearBest = distances.filter((d) => d.dist <= minDist + 2);
  nearBest.sort(
    (a, b) => Math.abs(a.rawOffset - 0.5) - Math.abs(b.rawOffset - 0.5) || a.dist - b.dist
  );
  const best = nearBest[0];

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

  const finalPt = getShapeBorderNormalizedPoint(best.side, offset, options?.nodeType, dims);
  return { side: best.side, offset, x: finalPt.u * w, y: finalPt.v * h, snappedLabel };
}

export function getBorderAnchorWorldPoint(
  rect: { x: number; y: number; width: number; height: number },
  handleId?: string | null,
  fallbackSide: BorderSide = 'right',
  nodeType?: string
): { x: number; y: number; side: BorderSide; offset: number } {
  const parsed = parseBorderAnchorHandle(handleId) ?? { side: fallbackSide, offset: 0.5 };
  const { side, offset } = parsed;
  const { u, v } = getShapeBorderNormalizedPoint(side, offset, nodeType, {
    width: rect.width,
    height: rect.height,
  });
  return {
    x: rect.x + rect.width * u,
    y: rect.y + rect.height * v,
    side,
    offset,
  };
}

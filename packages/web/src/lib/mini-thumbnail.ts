import {
  getDefaultNodeSize,
  getShapeBorderNormalizedPoint,
  parseBorderAnchorHandle,
  renderSpec,
  type BorderSide,
  type FlowEdge,
  type FlowNode,
  type XYPosition,
} from '@flowstudio/shared';
import { resolveNodeSemanticRole } from '../features/sidebar/styles/style-resolver.js';
import type { DiagramTemplate } from '../features/sidebar/templates/types.js';

interface Box {
  node: FlowNode;
  x: number;
  y: number;
  w: number;
  h: number;
}

const CONTAINER_ORDER: Record<string, number> = {
  pool: 0,
  lane: 1,
  group: 2,
};

const templateThumbnailCache = new Map<string, string>();

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

function pickAutoSide(from: Box, to: Box): BorderSide {
  const dx = to.x + to.w / 2 - (from.x + from.w / 2);
  const dy = to.y + to.h / 2 - (from.y + from.h / 2);
  const nx = Math.abs(dx) / Math.max(from.w, 1);
  const ny = Math.abs(dy) / Math.max(from.h, 1);
  if (nx >= ny) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

function borderPoint(box: Box, side: BorderSide, offset: number): XYPosition {
  const norm = getShapeBorderNormalizedPoint(side, offset, box.node.type, {
    width: box.w,
    height: box.h,
  });
  return {
    x: box.x + norm.u * box.w,
    y: box.y + norm.v * box.h,
  };
}

function buildOrthogonalPoints(
  start: XYPosition,
  end: XYPosition,
  sSide: BorderSide,
  tSide: BorderSide
): XYPosition[] {
  if (Math.abs(start.x - end.x) <= 1 || Math.abs(start.y - end.y) <= 1) {
    return [start, end];
  }
  const sHoriz = sSide === 'left' || sSide === 'right';
  const tHoriz = tSide === 'left' || tSide === 'right';
  if (sHoriz && tHoriz) {
    const mx = (start.x + end.x) / 2;
    return [start, { x: mx, y: start.y }, { x: mx, y: end.y }, end];
  }
  if (!sHoriz && !tHoriz) {
    const my = (start.y + end.y) / 2;
    return [start, { x: start.x, y: my }, { x: end.x, y: my }, end];
  }
  if (sHoriz && !tHoriz) {
    return [start, { x: end.x, y: start.y }, end];
  }
  return [start, { x: start.x, y: end.y }, end];
}

function renderBars(
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  count: 1 | 2
): string {
  if (w < 28 || h < 20) return '';
  const barH = Math.max(3, Math.min(5.5, h * 0.1));
  const rx = barH / 2;
  if (count === 1 || h < 42) {
    const bw = Math.max(12, w * 0.52);
    return `<rect x="${fmt(x + (w - bw) / 2)}" y="${fmt(y + (h - barH) / 2)}" width="${fmt(bw)}" height="${fmt(barH)}" rx="${fmt(rx)}" fill="${color}" opacity="0.55"/>`;
  }
  const bw1 = Math.max(12, w * 0.56);
  const bw2 = Math.max(10, w * 0.36);
  const gap = Math.max(4, barH * 1.15);
  const topY = y + (h - (barH * 2 + gap)) / 2;
  return `<rect x="${fmt(x + (w - bw1) / 2)}" y="${fmt(topY)}" width="${fmt(bw1)}" height="${fmt(barH)}" rx="${fmt(rx)}" fill="${color}" opacity="0.6"/>`
    + `<rect x="${fmt(x + (w - bw2) / 2)}" y="${fmt(topY + barH + gap)}" width="${fmt(bw2)}" height="${fmt(barH)}" rx="${fmt(rx)}" fill="${color}" opacity="0.4"/>`;
}

function renderContainer(box: Box, strokeW: number): string {
  const { node, x, y, w, h } = box;
  const isVert = node.data?.orientation === 'vertical';
  const rawHeader = Number(node.data?.headerSize);
  const baseHeader = Number.isFinite(rawHeader) && rawHeader > 0 ? rawHeader : 36;

  if (node.type === 'pool') {
    const band = Math.min(baseHeader, (isVert ? h : w) * 0.16);
    const header = isVert
      ? `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(band)}" rx="6" fill="#cbd5e1" fill-opacity="0.85"/>`
      : `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(band)}" height="${fmt(h)}" rx="6" fill="#cbd5e1" fill-opacity="0.85"/>`;
    return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="8" fill="#f1f5f9" fill-opacity="0.55" stroke="#94a3b8" stroke-width="${fmt(strokeW)}"/>${header}`;
  }

  if (node.type === 'lane') {
    const band = Math.min(baseHeader * 0.85, (isVert ? h : w) * 0.16);
    const strip = isVert
      ? `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(band)}" fill="#e2e8f0" fill-opacity="0.85"/>`
      : `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(band)}" height="${fmt(h)}" fill="#e2e8f0" fill-opacity="0.85"/>`;
    return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="4" fill="#f8fafc" fill-opacity="0.5" stroke="#94a3b8" stroke-opacity="0.7" stroke-width="${fmt(strokeW * 0.85)}"/>${strip}`;
  }

  return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="8" fill="#f1f5f9" fill-opacity="0.3" stroke="#94a3b8" stroke-width="${fmt(strokeW * 0.9)}" stroke-dasharray="${fmt(strokeW * 3)} ${fmt(strokeW * 2)}"/>`;
}

function renderNode(box: Box, edges: FlowEdge[], strokeW: number): string {
  const { node, x, y, w, h } = box;
  const t = node.type;
  const sw = fmt(strokeW);

  if (t === 'start-end') {
    const role = resolveNodeSemanticRole(node.id, t, node.data?.label, edges);
    const isEnd = role === 'end';
    const fill = isEnd ? '#ffe4e6' : '#d1fae5';
    const stroke = isEnd ? '#f43f5e' : '#10b981';
    const bar = isEnd ? '#fb7185' : '#34d399';
    const r = fmt(Math.min(w, h) / 2);
    return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="${r}" ry="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>${renderBars(x, y, w, h, bar, 1)}`;
  }

  if (t === 'decision') {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const pts = `${fmt(cx)},${fmt(y)} ${fmt(x + w)},${fmt(cy)} ${fmt(cx)},${fmt(y + h)} ${fmt(x)},${fmt(cy)}`;
    return `<polygon points="${pts}" fill="#fef3c7" stroke="#f59e0b" stroke-width="${sw}" stroke-linejoin="round"/>${renderBars(x + w * 0.18, y + h * 0.25, w * 0.64, h * 0.5, '#fbbf24', 1)}`;
  }

  if (t === 'subprocess') {
    const inset = Math.max(6, Math.min(12, w * 0.08));
    return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="8" fill="#e0e7ff" stroke="#6366f1" stroke-width="${sw}"/>`
      + `<line x1="${fmt(x + inset)}" y1="${fmt(y)}" x2="${fmt(x + inset)}" y2="${fmt(y + h)}" stroke="#6366f1" stroke-width="${fmt(strokeW * 0.8)}"/>`
      + `<line x1="${fmt(x + w - inset)}" y1="${fmt(y)}" x2="${fmt(x + w - inset)}" y2="${fmt(y + h)}" stroke="#6366f1" stroke-width="${fmt(strokeW * 0.8)}"/>`
      + renderBars(x + inset, y, w - inset * 2, h, '#818cf8', 2);
  }

  if (t === 'io') {
    const skew = Math.min(w * 0.16, 18);
    const pts = `${fmt(x + skew)},${fmt(y)} ${fmt(x + w)},${fmt(y)} ${fmt(x + w - skew)},${fmt(y + h)} ${fmt(x)},${fmt(y + h)}`;
    return `<polygon points="${pts}" fill="#cffafe" stroke="#06b6d4" stroke-width="${sw}" stroke-linejoin="round"/>${renderBars(x + skew * 0.5, y, w - skew, h, '#22d3ee', 1)}`;
  }

  if (t === 'document') {
    const wave = Math.min(12, h * 0.14);
    const d = `M ${fmt(x)} ${fmt(y)} H ${fmt(x + w)} V ${fmt(y + h - wave)} Q ${fmt(x + w * 0.75)} ${fmt(y + h - wave * 2)} ${fmt(x + w * 0.5)} ${fmt(y + h - wave)} Q ${fmt(x + w * 0.25)} ${fmt(y + h)} ${fmt(x)} ${fmt(y + h - wave)} Z`;
    return `<path d="${d}" fill="#e0f2fe" stroke="#0284c7" stroke-width="${sw}" stroke-linejoin="round"/>${renderBars(x, y, w, h - wave, '#38bdf8', 2)}`;
  }

  if (t === 'database' || t === 'arch-db-shard') {
    const ry = Math.max(6, Math.min(14, h * 0.13));
    const rx = w / 2;
    const cx = x + rx;
    const body = `M ${fmt(x)} ${fmt(y + ry)} V ${fmt(y + h - ry)} A ${fmt(rx)} ${fmt(ry)} 0 0 0 ${fmt(x + w)} ${fmt(y + h - ry)} V ${fmt(y + ry)} Z`;
    return `<path d="${body}" fill="#ede9fe" stroke="#8b5cf6" stroke-width="${sw}"/>`
      + `<ellipse cx="${fmt(cx)}" cy="${fmt(y + ry)}" rx="${fmt(rx)}" ry="${fmt(ry)}" fill="#ddd6fe" stroke="#8b5cf6" stroke-width="${sw}"/>`
      + renderBars(x, y + ry * 1.4, w, h - ry * 2.4, '#a78bfa', 1);
  }

  if (t === 'comment') {
    const fold = Math.min(14, Math.min(w, h) * 0.22);
    const d = `M ${fmt(x + w - fold)} ${fmt(y)} V ${fmt(y + fold)} H ${fmt(x + w)}`;
    return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="6" fill="#fef9c3" stroke="#eab308" stroke-width="${sw}" stroke-dasharray="${fmt(strokeW * 2.5)} ${fmt(strokeW * 1.6)}"/>`
      + `<path d="${d}" fill="none" stroke="#eab308" stroke-width="${fmt(strokeW * 0.85)}"/>`
      + renderBars(x, y, w, h, '#facc15', 2);
  }

  if (t.startsWith('arch-')) {
    const palette: Record<string, { fill: string; stroke: string; accent: string }> = {
      'arch-gateway': { fill: '#f0f9ff', stroke: '#0ea5e9', accent: '#38bdf8' },
      'arch-microservice': { fill: '#eef2ff', stroke: '#6366f1', accent: '#818cf8' },
      'arch-cache': { fill: '#fff7ed', stroke: '#f97316', accent: '#fb923c' },
      'arch-k8s-pod': { fill: '#eff6ff', stroke: '#3b82f6', accent: '#60a5fa' },
      'arch-docker': { fill: '#ecfeff', stroke: '#06b6d4', accent: '#22d3ee' },
    };
    const pal = palette[t] ?? { fill: '#f1f5f9', stroke: '#64748b', accent: '#94a3b8' };
    const stripH = Math.max(5, Math.min(10, h * 0.14));
    return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="8" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="${sw}"/>`
      + `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(stripH)}" rx="4" fill="${pal.stroke}" opacity="0.85"/>`
      + renderBars(x, y + stripH, w, h - stripH, pal.accent, 2);
  }

  if (t === 'uml-lifeline') {
    const headH = Math.min(44, h * 0.16);
    const cx = x + w / 2;
    return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(headH)}" rx="6" fill="#dbeafe" stroke="#3b82f6" stroke-width="${sw}"/>`
      + `<line x1="${fmt(cx)}" y1="${fmt(y + headH)}" x2="${fmt(cx)}" y2="${fmt(y + h)}" stroke="#94a3b8" stroke-width="${fmt(strokeW * 0.85)}" stroke-dasharray="${fmt(strokeW * 2.5)} ${fmt(strokeW * 2)}"/>`;
  }

  if (t === 'uml-activation') {
    return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="4" fill="#dbeafe" stroke="#3b82f6" stroke-width="${sw}"/>`;
  }

  if (t === 'rich-card') {
    return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="10" fill="#ffffff" stroke="#64748b" stroke-width="${sw}"/>`
      + `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(Math.min(12, h * 0.14))}" rx="5" fill="#3b82f6" opacity="0.85"/>`
      + renderBars(x, y + 12, w, h - 12, '#94a3b8', 2);
  }

  return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="8" fill="#dbeafe" stroke="#3b82f6" stroke-width="${sw}"/>${renderBars(x, y, w, h, '#60a5fa', 2)}`;
}

export function generateMiniSvgThumbnail(nodes: FlowNode[], edges: FlowEdge[]): string {
  if (nodes.length === 0) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 180" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"><rect width="300" height="180" fill="transparent"/><circle cx="150" cy="90" r="2.5" fill="#94a3b8" opacity="0.45"/></svg>';
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const absOf = (node: FlowNode, seen = new Set<string>()): XYPosition => {
    if (seen.has(node.id)) return { x: node.position.x, y: node.position.y };
    seen.add(node.id);
    const parentId = node.parentId ?? (node.data as { parentId?: string } | undefined)?.parentId;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (!parent) return { x: node.position.x, y: node.position.y };
    const base = absOf(parent, seen);
    return { x: base.x + node.position.x, y: base.y + node.position.y };
  };

  const sizeOf = (node: FlowNode) => {
    const def = getDefaultNodeSize(node.type);
    return {
      w: node.width ?? (typeof node.style?.width === 'number' ? node.style.width : def.width),
      h: node.height ?? (typeof node.style?.height === 'number' ? node.style.height : def.height),
    };
  };

  const boxes: Box[] = nodes.map((n) => {
    const { x, y } = absOf(n);
    const { w, h } = sizeOf(n);
    return { node: n, x, y, w, h };
  });
  const boxById = new Map(boxes.map((b) => [b.node.id, b]));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  for (const edge of edges) {
    for (const wp of edge.data?.waypoints ?? []) {
      minX = Math.min(minX, wp.x);
      minY = Math.min(minY, wp.y);
      maxX = Math.max(maxX, wp.x);
      maxY = Math.max(maxY, wp.y);
    }
  }

  const maxSpan = Math.max(maxX - minX, maxY - minY, 100);
  const padding = Math.min(52, Math.max(24, maxSpan * 0.06));
  const strokeW = Math.min(4.2, Math.max(1.5, maxSpan / 260));
  const vx = minX - padding;
  const vy = minY - padding;
  const vw = Math.max(maxX - minX + padding * 2, 100);
  const vh = Math.max(maxY - minY + padding * 2, 60);

  const containers = boxes
    .filter((b) => b.node.type in CONTAINER_ORDER)
    .sort((a, b) => CONTAINER_ORDER[a.node.type] - CONTAINER_ORDER[b.node.type]);
  const elements = boxes.filter((b) => !(b.node.type in CONTAINER_ORDER));

  const containerSvg = containers.map((b) => renderContainer(b, strokeW)).join('');

  const arrowheads: string[] = [];
  const edgeSvg = edges
    .map((e) => {
      const sBox = boxById.get(e.source);
      const tBox = boxById.get(e.target);
      if (!sBox || !tBox) return '';

      const sAnchor = parseBorderAnchorHandle(e.sourceHandle) ?? {
        side: pickAutoSide(sBox, tBox),
        offset: 0.5,
      };
      const tAnchor = parseBorderAnchorHandle(e.targetHandle) ?? {
        side: pickAutoSide(tBox, sBox),
        offset: 0.5,
      };

      const startPt = borderPoint(sBox, sAnchor.side, sAnchor.offset);
      const endPt = borderPoint(tBox, tAnchor.side, tAnchor.offset);
      const waypoints = e.data?.waypoints;
      const isStraight = e.type === 'straight' || e.data?.routingType === 'straight';
      const pts = waypoints?.length
        ? [startPt, ...waypoints, endPt]
        : isStraight
          ? [startPt, endPt]
          : buildOrthogonalPoints(startPt, endPt, sAnchor.side, tAnchor.side);

      const isAnnotate = e.data?.kind === 'annotate';
      const strokeStyle = e.data?.style?.strokeStyle;
      const dashAttr =
        strokeStyle === 'dotted'
          ? ` stroke-dasharray="${fmt(strokeW)} ${fmt(strokeW * 2)}"`
          : strokeStyle === 'dashed' || isAnnotate
            ? ` stroke-dasharray="${fmt(strokeW * 3)} ${fmt(strokeW * 2.2)}"`
            : '';

      if (!isAnnotate) {
        let prev = pts[pts.length - 2];
        for (let i = pts.length - 2; i >= 0; i--) {
          if (Math.hypot(endPt.x - pts[i].x, endPt.y - pts[i].y) > 0.5) {
            prev = pts[i];
            break;
          }
        }
        const dx = endPt.x - prev.x;
        const dy = endPt.y - prev.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0.5) {
          const ux = dx / dist;
          const uy = dy / dist;
          const len = strokeW * 3.6;
          const hw = strokeW * 1.9;
          const bx = endPt.x - ux * len;
          const by = endPt.y - uy * len;
          const p1x = bx - uy * hw;
          const p1y = by + ux * hw;
          const p2x = bx + uy * hw;
          const p2y = by - ux * hw;
          arrowheads.push(
            `<polygon points="${fmt(endPt.x)},${fmt(endPt.y)} ${fmt(p1x)},${fmt(p1y)} ${fmt(p2x)},${fmt(p2y)}" fill="#94a3b8"/>`
          );
        }
      }

      const pointsAttr = pts.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ');
      return `<polyline points="${pointsAttr}" fill="none" stroke="#94a3b8" stroke-width="${fmt(strokeW)}" stroke-linecap="round" stroke-linejoin="round"${dashAttr}/>`;
    })
    .join('');

  const elementSvg = elements.map((b) => renderNode(b, edges, strokeW)).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(vx)} ${fmt(vy)} ${fmt(vw)} ${fmt(vh)}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">${containerSvg}${edgeSvg}${elementSvg}${arrowheads.join('')}</svg>`;
}

export function getTemplateMiniThumbnail(template: DiagramTemplate): string {
  const cached = templateThumbnailCache.get(template.id);
  if (cached) return cached;
  const rendered = renderSpec(template.spec);
  const svg = generateMiniSvgThumbnail(rendered.nodes, rendered.edges);
  templateThumbnailCache.set(template.id, svg);
  return svg;
}

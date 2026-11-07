/**
 * @fileoverview 图表商业级全格式导出工具 (PNG / SVG / JSON)
 * @description 支持无损矢量 SVG 生成、2x Retina 超清 PNG 栅格化导出与标准 JSON 工程文件备份
 */

import type { FlowNode, FlowEdge } from '@flowstudio/shared';
import { computeBoundingBox, getNodeDimensions } from '../features/canvas/utils/group-calculator';
import { sanitizeNodes, sanitizeEdges } from './storage';

/**
 * 触发浏览器本地下载二进制或文本文件
 */
export function downloadFile(filename: string, content: Blob | string, mimeType: string): void {
  const blob = typeof content === 'string' ? new Blob([content], { type: mimeType }) : content;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 将图表生成为独立完整的纯矢量 SVG 字符串
 */
export function generateDiagramSvg(nodes: FlowNode[], edges: FlowEdge[], title: string): string {
  if (nodes.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"><text x="200" y="100" text-anchor="middle" fill="#94A3B8" font-size="14">空图表</text></svg>`;
  }

  const padding = 50;
  const bounds = computeBoundingBox(nodes, padding);
  const width = Math.max(bounds.width, 300);
  const height = Math.max(bounds.height, 200);
  const minX = bounds.x;
  const minY = bounds.y;

  // 1. Defs & Markers
  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}">
  <defs>
    <marker id="fs-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#64748B" />
    </marker>
    <filter id="card-shadow" x="-5%" y="-5%" width="110%" height="115%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.08" />
    </filter>
  </defs>

  <!-- 背景底色 -->
  <rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#FAFAFA" />

  <!-- 连线层 -->
  <g id="edges-layer">
`;

  // 2. 绘制连线
  for (const edge of edges) {
    const srcNode = nodes.find((n) => n.id === edge.source);
    const tgtNode = nodes.find((n) => n.id === edge.target);
    if (!srcNode || !tgtNode) continue;

    const { width: sw, height: sh } = getNodeDimensions(srcNode);
    const { width: tw, height: th } = getNodeDimensions(tgtNode);

    const sx = srcNode.position.x + sw;
    const sy = srcNode.position.y + sh / 2;
    const tx = tgtNode.position.x;
    const ty = tgtNode.position.y + th / 2;

    let pathD: string;
    const waypoints = edge.data?.waypoints;

    if (waypoints && waypoints.length > 0) {
      pathD = `M ${sx} ${sy}`;
      for (const wp of waypoints) {
        pathD += ` L ${wp.x} ${wp.y}`;
      }
      pathD += ` L ${tx} ${ty}`;
    } else {
      const midX = (sx + tx) / 2;
      pathD = `M ${sx} ${sy} L ${midX} ${sy} L ${midX} ${ty} L ${tx} ${ty}`;
    }

    svg += `    <path d="${pathD}" fill="none" stroke="#64748B" stroke-width="2" marker-end="url(#fs-arrow)" stroke-linecap="round" stroke-linejoin="round" />\n`;

    if (edge.data?.label) {
      const lx = (sx + tx) / 2;
      const ly = (sy + ty) / 2 - 6;
      svg += `    <text x="${lx}" y="${ly}" text-anchor="middle" font-size="11" font-family="-apple-system, sans-serif" fill="#475569" font-weight="500">${escapeXml(edge.data.label)}</text>\n`;
    }
  }

  svg += `  </g>\n\n  <!-- 图元节点层 -->\n  <g id="nodes-layer">\n`;

  // 3. 绘制节点（优先绘制容器类型 pool/lane/group，再绘制业务节点）
  const containerNodes = nodes.filter((n) => n.type === 'pool' || n.type === 'lane' || n.type === 'group');
  const leafNodes = nodes.filter((n) => n.type !== 'pool' && n.type !== 'lane' && n.type !== 'group');

  for (const node of [...containerNodes, ...leafNodes]) {
    const { width: nw, height: nh } = getNodeDimensions(node);
    const x = node.position.x;
    const y = node.position.y;
    const label = node.data?.label || '';

    if (node.type === 'pool') {
      svg += `    <rect x="${x}" y="${y}" width="${nw}" height="${nh}" rx="12" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="1.5" filter="url(#card-shadow)" />\n`;
      svg += `    <path d="M ${x} ${y + 36} L ${x + nw} ${y + 36}" stroke="#E2E8F0" stroke-width="1" />\n`;
      svg += `    <text x="${x + 16}" y="${y + 23}" font-size="12" font-family="-apple-system, sans-serif" font-weight="600" fill="#0F172A">${escapeXml(label)}</text>\n`;
    } else if (node.type === 'lane') {
      svg += `    <rect x="${x}" y="${y}" width="${nw}" height="${nh}" fill="#F8FAFC" stroke="#E2E8F0" stroke-width="1" stroke-dasharray="4 4" />\n`;
      svg += `    <rect x="${x}" y="${y}" width="36" height="${nh}" fill="#F1F5F9" stroke="#E2E8F0" stroke-width="1" />\n`;
      svg += `    <text x="${x + 18}" y="${y + nh / 2}" text-anchor="middle" font-size="11" font-family="-apple-system, sans-serif" font-weight="600" fill="#64748B" transform="rotate(-90 ${x + 18} ${y + nh / 2})">${escapeXml(label)}</text>\n`;
    } else if (node.type === 'start-end') {
      svg += `    <rect x="${x}" y="${y}" width="${nw}" height="${nh}" rx="${nh / 2}" fill="#FFFFFF" stroke="#6366F1" stroke-width="2" filter="url(#card-shadow)" />\n`;
      svg += `    <text x="${x + nw / 2}" y="${y + nh / 2 + 4}" text-anchor="middle" font-size="12" font-family="-apple-system, sans-serif" font-weight="500" fill="#1E293B">${escapeXml(label)}</text>\n`;
    } else if (node.type === 'decision') {
      const cx = x + nw / 2;
      const cy = y + nh / 2;
      const pts = `${cx},${y} ${x + nw},${cy} ${cx},${y + nh} ${x},${cy}`;
      svg += `    <polygon points="${pts}" fill="#FFFFFF" stroke="#F59E0B" stroke-width="2" filter="url(#card-shadow)" />\n`;
      svg += `    <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="12" font-family="-apple-system, sans-serif" font-weight="500" fill="#1E293B">${escapeXml(label)}</text>\n`;
    } else {
      svg += `    <rect x="${x}" y="${y}" width="${nw}" height="${nh}" rx="8" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="1.5" filter="url(#card-shadow)" />\n`;
      svg += `    <text x="${x + nw / 2}" y="${y + nh / 2 + 4}" text-anchor="middle" font-size="12" font-family="-apple-system, sans-serif" font-weight="500" fill="#1E293B">${escapeXml(label)}</text>\n`;
    }
  }

  svg += `  </g>\n</svg>`;
  return svg;
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

/**
 * 导出高清 PNG 图片（支持 2x Retina 像素比，保证极致清晰度）
 */
export async function exportToPng(
  nodes: FlowNode[],
  edges: FlowEdge[],
  title: string,
  scale = 2
): Promise<void> {
  const svgString = generateDiagramSvg(nodes, edges, title);
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = (err) => reject(err);
    img.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.width * scale;
  canvas.height = img.height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    URL.revokeObjectURL(url);
    throw new Error('无法初始化 2D 画布上下文');
  }

  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);

  const cleanTitle = (title || 'flowstudio-diagram').replace(/[/\\?%*:|"<>]/g, '_').trim();
  canvas.toBlob((pngBlob) => {
    if (pngBlob) {
      downloadFile(`${cleanTitle}.png`, pngBlob, 'image/png');
    }
  }, 'image/png');
}

/**
 * 导出独立矢量 SVG 文件
 */
export function exportToSvg(nodes: FlowNode[], edges: FlowEdge[], title: string): void {
  const svgString = generateDiagramSvg(nodes, edges, title);
  const cleanTitle = (title || 'flowstudio-diagram').replace(/[/\\?%*:|"<>]/g, '_').trim();
  downloadFile(`${cleanTitle}.svg`, svgString, 'image/svg+xml;charset=utf-8');
}

/**
 * 导出标准 JSON 备份工程文件
 */
export function exportToJson(nodes: FlowNode[], edges: FlowEdge[], title: string): void {
  const cleanTitle = (title || 'flowstudio-diagram').replace(/[/\\?%*:|"<>]/g, '_').trim();
  const exportData = {
    title,
    version: '1.0',
    exportedAt: new Date().toISOString(),
    nodes: sanitizeNodes(nodes),
    edges: sanitizeEdges(edges),
  };
  const jsonString = JSON.stringify(exportData, null, 2);
  downloadFile(`${cleanTitle}.json`, jsonString, 'application/json');
}

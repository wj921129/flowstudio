/**
 * @fileoverview 图表商业级全格式保真导出与导入工具 (PNG / SVG / JSON)
 * @description 支持无损矢量 SVG 保真生成（9大专业节点几何形状 + 泳道嵌套）、2x Retina 超清 PNG 栅格化导出与标准 JSON 工程文件解析验证
 */

import type { FlowNode, FlowEdge, XYPosition } from '@flowstudio/shared';
import { getNodeDimensions } from '../features/canvas/utils/group-calculator.js';
import { getNodeWorldPosition } from '../features/canvas/utils/split-insert-manager.js';
import { sanitizeNodes, sanitizeEdges } from './storage.js';

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

export function escapeXml(unsafe: string): string {
  return String(unsafe || '').replace(/[<>&'"]/g, (c) => {
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

export function escapeXmlAttr(unsafe: unknown): string {
  return escapeXml(String(unsafe ?? ''));
}

/**
 * 校验并清理 SVG 颜色值，仅允许合法 hex / rgb / rgba / hsl / hsla 与安全 CSS 颜色关键字，
 * 严防注入引号、括号或恶意脚本属性
 */
export function sanitizeSvgColor(color: unknown, fallback = '#000000'): string {
  if (typeof color !== 'string') return fallback;
  const trimmed = color.trim();
  // 16 进制颜色 (#fff, #ffffff, #ffffffff)
  if (/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) {
    return trimmed;
  }
  // rgb(...) 或 rgba(...)
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(\s*,\s*(0|1|0?\.\d+))?\s*\)$/.test(trimmed)) {
    return trimmed;
  }
  // hsl(...) 或 hsla(...)
  if (/^hsla?\(\s*\d{1,3}(\.\d+)?(deg)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(\s*,\s*(0|1|0?\.\d+))?\s*\)$/.test(trimmed)) {
    return trimmed;
  }
  // 安全 CSS 颜色单词白名单
  const safeNamedColors = new Set([
    'transparent', 'none', 'currentcolor', 'black', 'white', 'gray', 'red', 'green',
    'blue', 'yellow', 'orange', 'purple', 'cyan', 'magenta', 'silver', 'navy', 'teal'
  ]);
  if (safeNamedColors.has(trimmed.toLowerCase())) {
    return trimmed.toLowerCase();
  }
  return fallback;
}

/**
 * 校验并限制 SVG 几何与排版数值，防止 NaN、Infinity 或越界注入
 */
export function sanitizeSvgNumber(num: unknown, fallback: number, min = -100000, max = 100000): number {
  const n = typeof num === 'number' ? num : Number(num);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/**
 * 计算节点连接桩 (Handle) 在世界坐标系下的端点
 */
function getHandleEndpoint(
  node: FlowNode,
  worldPos: XYPosition,
  handleId?: string,
  isSource = true
): XYPosition {
  const { width: w, height: h } = getNodeDimensions(node);
  const side = handleId || (isSource ? 'right' : 'left');

  switch (side) {
    case 'top':
      return { x: worldPos.x + w / 2, y: worldPos.y };
    case 'bottom':
      return { x: worldPos.x + w / 2, y: worldPos.y + h };
    case 'left':
      return { x: worldPos.x, y: worldPos.y + h / 2 };
    case 'right':
    default:
      return { x: worldPos.x + w, y: worldPos.y + h / 2 };
  }
}

/**
 * 将图表生成为独立完整的保真纯矢量 SVG 字符串
 */
export function generateDiagramSvg(nodes: FlowNode[], edges: FlowEdge[], title: string): string {
  if (nodes.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"><rect width="400" height="200" fill="#FAFAFA"/><text x="200" y="100" text-anchor="middle" fill="#94A3B8" font-size="14" font-family="-apple-system, sans-serif">空图表</text></svg>`;
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const worldPosMap = new Map<string, XYPosition>();
  for (const n of nodes) {
    worldPosMap.set(n.id, getNodeWorldPosition(n, byId));
  }

  // 计算世界坐标包围盒
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const n of nodes) {
    const wp = worldPosMap.get(n.id)!;
    const { width: w, height: h } = getNodeDimensions(n);
    minX = Math.min(minX, wp.x);
    minY = Math.min(minY, wp.y);
    maxX = Math.max(maxX, wp.x + w);
    maxY = Math.max(maxY, wp.y + h);
  }

  const padding = 50;
  const vx = Math.floor(minX - padding);
  const vy = Math.floor(minY - padding);
  const vw = Math.ceil(maxX - minX + padding * 2);
  const vh = Math.ceil(maxY - minY + padding * 2);

  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}" viewBox="${vx} ${vy} ${vw} ${vh}">
  <defs>
    <marker id="fs-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#64748B" />
    </marker>
    <filter id="card-shadow" x="-5%" y="-5%" width="110%" height="115%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.08" />
    </filter>
  </defs>

  <!-- 背景底色 -->
  <rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="#FAFAFA" />

  <!-- 连线层 -->
  <g id="edges-layer">
`;

  // 1. 绘制连线
  for (const edge of edges) {
    const srcNode = byId.get(edge.source);
    const tgtNode = byId.get(edge.target);
    if (!srcNode || !tgtNode) continue;

    const srcWp = worldPosMap.get(srcNode.id)!;
    const tgtWp = worldPosMap.get(tgtNode.id)!;

    const start = getHandleEndpoint(srcNode, srcWp, edge.sourceHandle, true);
    const end = getHandleEndpoint(tgtNode, tgtWp, edge.targetHandle, false);

    const edgeStyle = edge.data?.style;
    const strokeColor = sanitizeSvgColor(edgeStyle?.strokeColor, '#64748B');
    const strokeWidth = sanitizeSvgNumber(edgeStyle?.strokeWidth, 2, 0.5, 20);
    const strokeDash = edgeStyle?.strokeStyle === 'dashed' ? 'stroke-dasharray="5 5"' : '';

    let pathD: string;
    const waypoints = edge.data?.waypoints;

    if (Array.isArray(waypoints) && waypoints.length > 0) {
      pathD = `M ${start.x} ${start.y}`;
      for (const wp of waypoints) {
        pathD += ` L ${wp.x} ${wp.y}`;
      }
      pathD += ` L ${end.x} ${end.y}`;
    } else {
      const midX = (start.x + end.x) / 2;
      pathD = `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}`;
    }

    svg += `    <path d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" ${strokeDash} marker-end="url(#fs-arrow)" stroke-linecap="round" stroke-linejoin="round" />\n`;

    if (edge.data?.label) {
      const label = String(edge.data.label);
      const lx = (start.x + end.x) / 2;
      const ly = (start.y + end.y) / 2 - 8;
      const badgeW = Math.max(24, label.length * 12 + 12);
      svg += `    <rect x="${lx - badgeW / 2}" y="${ly - 10}" width="${badgeW}" height="18" rx="4" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="1" />\n`;
      svg += `    <text x="${lx}" y="${ly + 3}" text-anchor="middle" font-size="11" font-family="-apple-system, sans-serif" fill="#475569" font-weight="500">${escapeXml(label)}</text>\n`;
    }
  }

  svg += `  </g>\n\n  <!-- 图元节点层 -->\n  <g id="nodes-layer">\n`;

  // 2. 绘制节点（优先绘制容器类型 pool/lane/group，再绘制业务叶子节点）
  const containerNodes = nodes.filter((n) => n.type === 'pool' || n.type === 'lane' || n.type === 'group');
  const leafNodes = nodes.filter((n) => n.type !== 'pool' && n.type !== 'lane' && n.type !== 'group');

  for (const node of [...containerNodes, ...leafNodes]) {
    const { width: nw, height: nh } = getNodeDimensions(node);
    const wp = worldPosMap.get(node.id)!;
    const x = wp.x;
    const y = wp.y;
    const label = node.data?.label || '';
    const safeNodeId = escapeXml(node.id).replace(/--/g, '__');

    const styleData = node.data?.style || {};
    const defaultFill = node.type === 'comment' ? '#FEF9C3' : '#FFFFFF';
    const defaultBorder = node.type === 'comment' ? '#FDE047' : '#CBD5E1';
    const fillColor = sanitizeSvgColor(styleData.fillColor, defaultFill);
    const strokeColor = sanitizeSvgColor(styleData.borderColor, defaultBorder);
    const strokeWidth = sanitizeSvgNumber(styleData.borderWidth, node.type === 'pool' ? 2 : 1.5, 0.5, 20);
    const strokeDash = styleData.borderStyle === 'dashed' ? 'stroke-dasharray="5 5"' : '';
    const fontColor = sanitizeSvgColor(styleData.fontColor, '#1E293B');
    const fontSize = sanitizeSvgNumber(styleData.fontSize, 12, 6, 72);

    switch (node.type) {
      case 'pool': {
        const isHoriz = node.data?.orientation !== 'vertical';
        const headerSize = sanitizeSvgNumber(node.data?.headerSize, 40, 20, 200);
        svg += `    <!-- Pool: ${safeNodeId} -->\n`;
        svg += `    <rect x="${x}" y="${y}" width="${nw}" height="${nh}" rx="8" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" ${strokeDash} filter="url(#card-shadow)" />\n`;
        if (isHoriz) {
          svg += `    <rect x="${x}" y="${y}" width="${nw}" height="${headerSize}" rx="8" fill="#F1F5F9" stroke="${strokeColor}" stroke-width="${strokeWidth}" />\n`;
          svg += `    <rect x="${x}" y="${y + headerSize - 8}" width="${nw}" height="8" fill="#F1F5F9" />\n`;
          svg += `    <text x="${x + 16}" y="${y + headerSize / 2 + 4}" font-size="13" font-family="-apple-system, sans-serif" font-weight="600" fill="#0F172A">${escapeXml(label)}</text>\n`;
        } else {
          svg += `    <rect x="${x}" y="${y}" width="${headerSize}" height="${nh}" rx="8" fill="#F1F5F9" stroke="${strokeColor}" stroke-width="${strokeWidth}" />\n`;
          svg += `    <rect x="${x + headerSize - 8}" y="${y}" width="8" height="${nh}" fill="#F1F5F9" />\n`;
          svg += `    <text x="${x + headerSize / 2}" y="${y + nh / 2}" text-anchor="middle" font-size="13" font-family="-apple-system, sans-serif" font-weight="600" fill="#0F172A" transform="rotate(-90 ${x + headerSize / 2} ${y + nh / 2})">${escapeXml(label)}</text>\n`;
        }
        break;
      }

      case 'lane': {
        svg += `    <!-- Lane: ${safeNodeId} -->\n`;
        svg += `    <rect x="${x}" y="${y}" width="${nw}" height="${nh}" fill="${fillColor || '#F8FAFC'}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-dasharray="4 4" />\n`;
        svg += `    <rect x="${x}" y="${y}" width="36" height="${nh}" fill="#F1F5F9" stroke="${strokeColor}" stroke-width="1" />\n`;
        svg += `    <text x="${x + 18}" y="${y + nh / 2}" text-anchor="middle" font-size="11" font-family="-apple-system, sans-serif" font-weight="600" fill="#64748B" transform="rotate(-90 ${x + 18} ${y + nh / 2})">${escapeXml(label)}</text>\n`;
        break;
      }

      case 'group': {
        svg += `    <!-- Group: ${safeNodeId} -->\n`;
        svg += `    <rect x="${x}" y="${y}" width="${nw}" height="${nh}" rx="8" fill="${fillColor || '#F8FAFC'}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-dasharray="5 5" />\n`;
        if (label) {
          svg += `    <text x="${x + 12}" y="${y + 20}" font-size="11" font-family="-apple-system, sans-serif" font-weight="600" fill="#64748B">${escapeXml(label)}</text>\n`;
        }
        break;
      }

      case 'start-end': {
        const radius = nh / 2;
        svg += `    <rect x="${x}" y="${y}" width="${nw}" height="${nh}" rx="${radius}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" ${strokeDash} filter="url(#card-shadow)" />\n`;
        svg += `    <text x="${x + nw / 2}" y="${y + nh / 2 + 4}" text-anchor="middle" font-size="${fontSize}" font-family="-apple-system, sans-serif" font-weight="500" fill="${fontColor}">${escapeXml(label)}</text>\n`;
        break;
      }

      case 'decision': {
        const cx = x + nw / 2;
        const cy = y + nh / 2;
        const pts = `${cx},${y} ${x + nw},${cy} ${cx},${y + nh} ${x},${cy}`;
        svg += `    <polygon points="${pts}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" ${strokeDash} filter="url(#card-shadow)" />\n`;
        svg += `    <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="${fontSize}" font-family="-apple-system, sans-serif" font-weight="500" fill="${fontColor}">${escapeXml(label)}</text>\n`;
        break;
      }

      case 'io': {
        const offset = Math.min(20, nw * 0.15);
        const pts = `${x + offset},${y} ${x + nw},${y} ${x + nw - offset},${y + nh} ${x},${y + nh}`;
        svg += `    <polygon points="${pts}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" ${strokeDash} filter="url(#card-shadow)" />\n`;
        svg += `    <text x="${x + nw / 2}" y="${y + nh / 2 + 4}" text-anchor="middle" font-size="${fontSize}" font-family="-apple-system, sans-serif" font-weight="500" fill="${fontColor}">${escapeXml(label)}</text>\n`;
        break;
      }

      case 'document': {
        const d = `M ${x},${y} L ${x + nw},${y} L ${x + nw},${y + nh * 0.92} Q ${x + nw * 0.75},${y + nh * 0.84} ${x + nw * 0.5},${y + nh * 0.98} Q ${x + nw * 0.25},${y + nh * 1.06} ${x},${y + nh * 0.92} Z`;
        svg += `    <path d="${d}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" ${strokeDash} filter="url(#card-shadow)" />\n`;
        svg += `    <text x="${x + nw / 2}" y="${y + nh / 2}" text-anchor="middle" font-size="${fontSize}" font-family="-apple-system, sans-serif" font-weight="500" fill="${fontColor}">${escapeXml(label)}</text>\n`;
        break;
      }

      case 'database': {
        const rx = nw / 2;
        const ry = Math.min(16, nh * 0.15);
        // 柱身与底部圆弧
        const d = `M ${x},${y + ry} L ${x},${y + nh - ry} A ${rx},${ry} 0 0 0 ${x + nw},${y + nh - ry} L ${x + nw},${y + ry} Z`;
        svg += `    <path d="${d}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" ${strokeDash} filter="url(#card-shadow)" />\n`;
        // 顶面椭圆
        svg += `    <ellipse cx="${x + rx}" cy="${y + ry}" rx="${rx}" ry="${ry}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" />\n`;
        svg += `    <text x="${x + nw / 2}" y="${y + nh / 2 + 8}" text-anchor="middle" font-size="${fontSize}" font-family="-apple-system, sans-serif" font-weight="500" fill="${fontColor}">${escapeXml(label)}</text>\n`;
        break;
      }

      case 'subprocess': {
        svg += `    <rect x="${x}" y="${y}" width="${nw}" height="${nh}" rx="4" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" ${strokeDash} filter="url(#card-shadow)" />\n`;
        svg += `    <line x1="${x + 12}" y1="${y}" x2="${x + 12}" y2="${y + nh}" stroke="${strokeColor}" stroke-width="${strokeWidth}" />\n`;
        svg += `    <line x1="${x + nw - 12}" y1="${y}" x2="${x + nw - 12}" y2="${y + nh}" stroke="${strokeColor}" stroke-width="${strokeWidth}" />\n`;
        svg += `    <text x="${x + nw / 2}" y="${y + nh / 2 + 4}" text-anchor="middle" font-size="${fontSize}" font-family="-apple-system, sans-serif" font-weight="500" fill="${fontColor}">${escapeXml(label)}</text>\n`;
        break;
      }

      case 'comment': {
        const fold = 14;
        const d = `M ${x},${y} L ${x + nw - fold},${y} L ${x + nw},${y + fold} L ${x + nw},${y + nh} L ${x},${y + nh} Z`;
        svg += `    <path d="${d}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" ${strokeDash} filter="url(#card-shadow)" />\n`;
        svg += `    <polygon points="${x + nw - fold},${y} ${x + nw},${y + fold} ${x + nw - fold},${y + fold}" fill="#E2E8F0" stroke="${strokeColor}" stroke-width="${strokeWidth}" />\n`;
        svg += `    <text x="${x + nw / 2}" y="${y + nh / 2 + 4}" text-anchor="middle" font-size="${fontSize}" font-family="-apple-system, sans-serif" font-weight="500" fill="${fontColor}">${escapeXml(label)}</text>\n`;
        break;
      }

      case 'process':
      default: {
        svg += `    <rect x="${x}" y="${y}" width="${nw}" height="${nh}" rx="8" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" ${strokeDash} filter="url(#card-shadow)" />\n`;
        svg += `    <text x="${x + nw / 2}" y="${y + nh / 2 + 4}" text-anchor="middle" font-size="${fontSize}" font-family="-apple-system, sans-serif" font-weight="500" fill="${fontColor}">${escapeXml(label)}</text>\n`;
        break;
      }
    }
  }

  svg += `  </g>\n</svg>`;
  return svg;
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

export interface ParsedDiagramJson {
  success: boolean;
  title?: string;
  nodes?: FlowNode[];
  edges?: FlowEdge[];
  error?: string;
}

/**
 * 校验并解析外部导入的 JSON 备份工程文件
 */
export function validateAndParseDiagramJson(rawJson: string): ParsedDiagramJson {
  try {
    const data = JSON.parse(rawJson);
    if (!data || typeof data !== 'object') {
      return { success: false, error: 'JSON 文件根节点必须为对象' };
    }

    if (!Array.isArray(data.nodes)) {
      return { success: false, error: 'JSON 文件缺少有效的 nodes 节点数组' };
    }

    const title = typeof data.title === 'string' ? escapeXml(data.title.trim()).slice(0, 100) : '导入流程图';
    const rawNodes = data.nodes as FlowNode[];
    const rawEdges = Array.isArray(data.edges) ? (data.edges as FlowEdge[]) : [];

    // 校验每个节点包含基本字段 id, type, position
    for (const node of rawNodes) {
      if (!node.id || typeof node.id !== 'string' || !node.type || typeof node.type !== 'string' || !node.position) {
        return { success: false, error: `节点数据不完整：缺少合法 id, type 或 position` };
      }
      if (
        typeof node.position.x !== 'number' ||
        !Number.isFinite(node.position.x) ||
        typeof node.position.y !== 'number' ||
        !Number.isFinite(node.position.y)
      ) {
        return { success: false, error: `节点 ${node.id} 坐标不是有效的数字` };
      }
    }

    const sanitizedNodes = sanitizeNodes(rawNodes);
    const sanitizedEdges = sanitizeEdges(rawEdges);

    return {
      success: true,
      title,
      nodes: sanitizedNodes,
      edges: sanitizedEdges,
    };
  } catch (err: any) {
    return {
      success: false,
      error: `JSON 解析失败：${err.message || String(err)}`,
    };
  }
}

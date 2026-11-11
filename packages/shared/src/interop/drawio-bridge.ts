import type { FlowNode, FlowEdge, XYPosition, FlowNodeType } from '../types.js';
import { getNodeRegistryEntry } from '../node-registry.js';
import { flowNodeSchema, flowEdgeSchema } from '../schemas/diagram-schema.js';
import { parseXml, walkTags, type XmlNode } from './xml-parser.js';

export interface DrawioImportResult {
  nodes: FlowNode[];
  edges: FlowEdge[];
  warnings: string[];
}

interface CellRecord {
  id: string;
  value: string;
  style: string;
  vertex: boolean;
  edge: boolean;
  source?: string;
  target?: string;
  parentId?: string;
  geo?: { x: number; y: number; w: number; h: number };
  waypoints: XYPosition[];
}

const bytesToBinaryString = (bytes: Uint8Array): string => {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return s;
};

export async function inflateDrawioContent(base64: string): Promise<string> {
  const bin = atob(base64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前运行环境不支持 Deflate 解压，请使用现代浏览器');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buf = await new Response(stream).arrayBuffer();
  const inflated = bytesToBinaryString(new Uint8Array(buf));
  try {
    return decodeURIComponent(inflated);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

const toNum = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const parseStyle = (style: string): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const part of style.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) map[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    else if (part.trim()) map[part.trim()] = '1';
  }
  return map;
};

const stripHtml = (value: string): string =>
  value.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

const mapShapeType = (s: Record<string, string>, isChildOfSwimlane: boolean): FlowNodeType => {
  if (s.swimlane !== undefined) return isChildOfSwimlane ? 'lane' : 'pool';
  const shape = (s.shape || s.shapeType || '').toLowerCase();
  if (shape.includes('rhombus') || shape.includes('diamond') || s.rhombus === '1') return 'decision';
  if (shape.includes('parallelogram')) return 'io';
  if (shape.includes('document')) return 'document';
  if (shape.includes('cylinder') || shape.includes('datastore') || shape.includes('database')) return 'database';
  if (shape.includes('predefined') || shape === 'process') return 'subprocess';
  if (s.ellipse === '1' || shape.includes('ellipse') || shape.includes('circle')) return 'start-end';
  if (s.container === '1' || shape.includes('group')) return 'group';
  return 'process';
};

const readGeometry = (cell: XmlNode): CellRecord['geo'] | undefined => {
  const geoNode = cell.children.find((c) => c.tag === 'mxGeometry');
  if (!geoNode) return undefined;
  const geo: CellRecord['geo'] = {
    x: toNum(geoNode.attrs.x, 0),
    y: toNum(geoNode.attrs.y, 0),
    w: toNum(geoNode.attrs.width, 0),
    h: toNum(geoNode.attrs.height, 0),
  };
  if (geo.w <= 0 || geo.h <= 0) return undefined;
  return geo;
};

const readEdgeWaypoints = (cell: XmlNode): XYPosition[] => {
  const geoNode = cell.children.find((c) => c.tag === 'mxGeometry');
  if (!geoNode) return [];
  const points = geoNode.children.find((c) => c.tag === 'Array' && c.attrs.as === 'points');
  if (!points) return [];
  return points.children
    .filter((p) => p.tag === 'mxPoint')
    .map((p) => ({ x: toNum(p.attrs.x, 0), y: toNum(p.attrs.y, 0) }));
};

const collectCells = (model: XmlNode): XmlNode[] => {
  const out: XmlNode[] = [];
  const visit = (n: XmlNode) => {
    for (const c of n.children) {
      if (c.tag === 'mxCell') out.push(c);
      visit(c);
    }
  };
  visit(model);
  return out;
};

const registrySize = (type: FlowNodeType) => getNodeRegistryEntry(type)?.defaultSize ?? { width: 160, height: 80 };

export async function parseDrawioXml(xml: string): Promise<DrawioImportResult> {
  const warnings: string[] = [];
  let raw = xml.trim();
  if (!/<mxGraphModel|<mxfile/i.test(raw)) {
    throw new Error('不是有效的 Draw.io / mxGraph XML 文件');
  }
  const doc = parseXml(raw);
  let model = walkTags(doc, 'mxGraphModel')[0];

  if (!model) {
    const diagrams = walkTags(doc, 'diagram');
    const first = diagrams[0];
    if (!first) throw new Error('未找到 mxGraphModel 或 diagram 节点');
    if (diagrams.length > 1) warnings.push(`文件包含 ${diagrams.length} 个页面，仅导入第 1 页「${first.attrs.name || '未命名'}」`);
    const content = (first.text || '').trim();
    if (content && !content.startsWith('<')) {
      raw = await inflateDrawioContent(content);
      const inflated = walkTags(parseXml(raw), 'mxGraphModel')[0];
      if (!inflated) throw new Error('压缩 mxGraphModel 解析失败');
      model = inflated;
    } else {
      const inner = first.children.find((c) => c.tag === 'mxGraphModel');
      if (!inner) throw new Error('diagram 内容既非压缩数据也非 mxGraphModel');
      model = inner;
    }
  }
  if (!model) throw new Error('mxGraphModel 解析失败');

  const cellNodes = collectCells(model);
  const byId = new Map(cellNodes.map((c) => [c.attrs.id, c]));

  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const idMap = new Map<string, string>();
  const vertexCells: CellRecord[] = [];

  for (const cell of cellNodes) {
    const isEdge = cell.attrs.edge === '1';
    const isVertex = cell.attrs.vertex === '1';
    const cellId = cell.attrs.id || `c${cellNodes.indexOf(cell)}`;
    idMap.set(cellId, `dw-${cellId}`);
    if (isVertex) {
      const parentId = cell.attrs.parent;
      const parentCell = parentId ? byId.get(parentId) : undefined;
      const parentIsSwimlane = parentCell ? parseStyle(parentCell.attrs.style || '').swimlane !== undefined : false;
      const styleMap = parseStyle(cell.attrs.style || '');
      const type = mapShapeType(styleMap, parentIsSwimlane);
      const geo = readGeometry(cell);
      const rs = registrySize(type);
      const geoRec = geo ?? { x: 0, y: 0, w: rs.width, h: rs.height };
      const label = stripHtml(cell.attrs.value || '');
      const rec: CellRecord = {
        id: cellId,
        value: label,
        style: cell.attrs.style || '',
        vertex: true,
        edge: false,
        parentId: parentIsSwimlane || (parentCell && parseStyle(parentCell.attrs.style || '').container === '1') ? parentId : undefined,
        geo: geoRec,
        waypoints: [],
      };
      vertexCells.push(rec);
      if (!geo) warnings.push(`图元「${label || cellId}」缺少几何信息，已使用默认尺寸`);
    } else if (isEdge) {
      vertexCells.push({
        id: cellId,
        value: stripHtml(cell.attrs.value || ''),
        style: cell.attrs.style || '',
        vertex: false,
        edge: true,
        source: cell.attrs.source,
        target: cell.attrs.target,
        waypoints: readEdgeWaypoints(cell),
      });
    }
  }

  const absPosCache = new Map<string, XYPosition>();
  const absolutePos = (rec: CellRecord): XYPosition => {
    if (absPosCache.has(rec.id)) return absPosCache.get(rec.id)!;
    let x = rec.geo?.x ?? 0;
    let y = rec.geo?.y ?? 0;
    if (rec.parentId) {
      const parentRec = vertexCells.find((v) => v.id === rec.parentId);
      if (parentRec) {
        const pp = absolutePos(parentRec);
        x += pp.x;
        y += pp.y;
      }
    }
    const pos = { x: Math.round(x), y: Math.round(y) };
    absPosCache.set(rec.id, pos);
    return pos;
  };

  for (const rec of vertexCells.filter((r) => r.vertex)) {
    const parentCell = rec.parentId ? byId.get(rec.parentId) : undefined;
    const parentStyle = parentCell ? parseStyle(parentCell.attrs.style || '') : {};
    const parentIsPool = parentStyle.swimlane !== undefined;
    const recStyle = parseStyle(rec.style);
    const nodeType: FlowNodeType = mapShapeType(recStyle, parentIsPool);
    const data: FlowNode['data'] = { label: rec.value || getNodeRegistryEntry(nodeType)?.label || nodeType, type: nodeType };
    if (parentIsPool) {
      data.parentId = idMap.get(rec.parentId!);
      if (parentStyle.horizontal === '0') data.orientation = 'vertical';
    }
    if (nodeType === 'pool') data.orientation = recStyle.horizontal === '0' ? 'vertical' : 'horizontal';
    const node: FlowNode = {
      id: idMap.get(rec.id)!,
      type: nodeType,
      position: absolutePos(rec),
      data,
      width: rec.geo?.w ?? registrySize(nodeType).width,
      height: rec.geo?.h ?? registrySize(nodeType).height,
    };
    if (data.parentId) {
      node.parentId = data.parentId;
      node.extent = 'parent';
    }
    const parsed = flowNodeSchema.safeParse(node);
    if (parsed.success) nodes.push(parsed.data as FlowNode);
    else warnings.push(`图元「${rec.value || rec.id}」校验失败已跳过`);
  }

  for (const rec of vertexCells.filter((r) => r.edge)) {
    const source = rec.source ? idMap.get(rec.source) : undefined;
    const target = rec.target ? idMap.get(rec.target) : undefined;
    if (!source || !target) {
      if (rec.source || rec.target) warnings.push(`连线「${rec.value || rec.id}」缺少端点已跳过`);
      continue;
    }
    const edge: FlowEdge = {
      id: idMap.get(rec.id)!,
      source,
      target,
      type: 'orthogonal',
      data: {
        ...(rec.value ? { label: rec.value } : {}),
        ...(rec.waypoints.length ? { waypoints: rec.waypoints } : {}),
        routingType: rec.waypoints.length ? 'orthogonal' : 'orthogonal',
      },
    };
    const parsed = flowEdgeSchema.safeParse(edge);
    if (parsed.success) edges.push(parsed.data as FlowEdge);
  }

  if (nodes.length === 0) throw new Error('未从文件解析出任何有效图元');
  return { nodes, edges, warnings };
}

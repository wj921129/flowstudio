import type { DiagramSummary, FlowNode, FlowEdge, SnapshotSummary } from '@flowstudio/shared';

const API_BASE = '/api/diagrams';

export const apiClient = {
  async listDiagrams(query?: string): Promise<DiagramSummary[]> {
    const url = query && query.trim() ? `${API_BASE}?q=${encodeURIComponent(query.trim())}` : API_BASE;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`获取图表列表失败: ${res.statusText}`);
    const data = await res.json();
    return data.diagrams || [];
  },

  async getDiagram(id: string): Promise<DiagramSummary> {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`获取图表失败: ${res.statusText}`);
    return res.json();
  },

  async createDiagram(input: { title: string; description?: string }): Promise<DiagramSummary> {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`创建图表失败: ${res.statusText}`);
    return res.json();
  },

  async updateDiagram(
    id: string,
    input: { title?: string; description?: string; thumbnail?: string }
  ): Promise<DiagramSummary> {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`更新图表失败: ${res.statusText}`);
    return res.json();
  },

  async duplicateDiagram(id: string): Promise<DiagramSummary> {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(id)}/duplicate`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error(`复制图表失败: ${res.statusText}`);
    return res.json();
  },

  async deleteDiagram(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`删除图表失败: ${res.statusText}`);
  },

  async listSnapshots(diagramId: string): Promise<SnapshotSummary[]> {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(diagramId)}/snapshots`);
    if (!res.ok) throw new Error(`获取快照列表失败: ${res.statusText}`);
    return res.json();
  },

  async getSnapshot(diagramId: string, snapshotId: string): Promise<{ id: string; diagramId: string; nodes: FlowNode[]; edges: FlowEdge[]; meta?: Record<string, unknown> }> {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(diagramId)}/snapshots/${encodeURIComponent(snapshotId)}`);
    if (!res.ok) throw new Error(`获取快照详情失败: ${res.statusText}`);
    return res.json();
  },

  async createSnapshot(
    diagramId: string,
    label: string,
    triggerType: 'manual' | 'ai_batch' | 'auto' | 'timer' = 'manual'
  ): Promise<SnapshotSummary> {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(diagramId)}/snapshots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, triggerType }),
    });
    if (!res.ok) throw new Error(`创建快照失败: ${res.statusText}`);
    return res.json();
  },

  async restoreSnapshot(diagramId: string, snapshotId: string, options?: { mode?: 'apply' | 'delta' }): Promise<{ success: boolean; message?: string; mode?: 'apply' | 'delta'; update?: string }> {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(diagramId)}/snapshots/${encodeURIComponent(snapshotId)}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options ?? {}),
    });
    if (!res.ok) throw new Error(`恢复快照失败: ${res.statusText}`);
    return res.json();
  },
};

/**
 * 根据当前图表节点与连线计算包围盒并生成紧凑的轻量级 SVG 缩略图
 * @description 泳道/分组的 position 是相对父容器的，这里先换算为绝对坐标；连线先画、盒子后画，
 * 使线段看起来从边界进出而无需求交点
 */
export function generateMiniSvgThumbnail(nodes: FlowNode[], edges: FlowEdge[]): string {
  if (nodes.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 180" width="100%" height="100%">
      <rect width="300" height="180" fill="transparent"/>
      <circle cx="150" cy="90" r="2" fill="#9ca3af" opacity="0.4"/>
    </svg>`;
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const absOf = (node: FlowNode): { x: number; y: number } => {
    const parentId = node.parentId ?? (node.data as { parentId?: string } | undefined)?.parentId;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (!parent) return { x: node.position.x, y: node.position.y };

    const base = absOf(parent);
    return { x: base.x + node.position.x, y: base.y + node.position.y };
  };
  const sizeOf = (node: FlowNode) => ({
    w: node.width ?? (typeof node.style?.width === 'number' ? node.style.width : 120),
    h: node.height ?? (typeof node.style?.height === 'number' ? node.style.height : 60),
  });

  const boxes = nodes.map((n) => {
    const { x, y } = absOf(n);
    const { w, h } = sizeOf(n);
    return { node: n, x, y, w, h };
  });

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

  const padding = 20;
  const viewBoxX = minX - padding;
  const viewBoxY = minY - padding;
  const viewBoxW = Math.max(maxX - minX + padding * 2, 100);
  const viewBoxH = Math.max(maxY - minY + padding * 2, 60);

  const centerOf = new Map(boxes.map((b) => [b.node.id, { x: b.x + b.w / 2, y: b.y + b.h / 2 }]));
  const lines = edges
    .map((e) => {
      const s = centerOf.get(e.source);
      const t = centerOf.get(e.target);
      if (!s || !t) return '';
      return `<line x1="${s.x}" y1="${s.y}" x2="${t.x}" y2="${t.y}" stroke="#94a3b8" stroke-width="1.5"/>`;
    })
    .join('');

  // 容器先画（半透明），普通图元后画，保证子节点可见
  const isContainer = (t: string) => t === 'pool' || t === 'lane' || t === 'group';
  const rects = [...boxes]
    .sort((a, b) => Number(isContainer(a.node.type)) - Number(isContainer(b.node.type)))
    .map((b) => {
      const type = b.node.type;
      const fill = type === 'comment' ? '#fef3c7' : '#e0e7ff';
      const stroke = type === 'comment' ? '#f59e0b' : '#6366f1';
      const opacity = isContainer(type) ? 0.45 : 1;
      return `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="1.5"/>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBoxX} ${viewBoxY} ${viewBoxW} ${viewBoxH}" width="100%" height="100%">${lines}${rects}</svg>`;
}

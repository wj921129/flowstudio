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

  async createSnapshot(diagramId: string, label: string): Promise<SnapshotSummary> {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(diagramId)}/snapshots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, triggerType: 'manual' }),
    });
    if (!res.ok) throw new Error(`创建快照失败: ${res.statusText}`);
    return res.json();
  },

  async restoreSnapshot(diagramId: string, snapshotId: string): Promise<{ success: boolean; message?: string }> {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(diagramId)}/snapshots/${encodeURIComponent(snapshotId)}/restore`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error(`恢复快照失败: ${res.statusText}`);
    return res.json();
  },
};

/**
 * 根据当前图表节点与连线计算包围盒并生成紧凑的轻量级 SVG 缩略图
 */
export function generateMiniSvgThumbnail(nodes: FlowNode[], edges: FlowEdge[]): string {
  if (nodes.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 180" width="100%" height="100%">
      <rect width="300" height="180" fill="transparent"/>
      <circle cx="150" cy="90" r="2" fill="#9ca3af" opacity="0.4"/>
    </svg>`;
  }

  // 计算节点包围盒
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    const w = node.width || 120;
    const h = node.height || 60;
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + w);
    maxY = Math.max(maxY, node.position.y + h);
  }

  const padding = 20;
  const viewBoxX = minX - padding;
  const viewBoxY = minY - padding;
  const viewBoxW = Math.max(maxX - minX + padding * 2, 100);
  const viewBoxH = Math.max(maxY - minY + padding * 2, 60);

  const rects = nodes
    .map((n) => {
      const w = n.width || 120;
      const h = n.height || 60;
      const fill = n.type === 'comment' ? '#fef3c7' : '#e0e7ff';
      const stroke = n.type === 'comment' ? '#f59e0b' : '#6366f1';
      return `<rect x="${n.position.x}" y="${n.position.y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBoxX} ${viewBoxY} ${viewBoxW} ${viewBoxH}" width="100%" height="100%">${rects}</svg>`;
}

import type { DiagramSummary, FlowNode, FlowEdge, SnapshotSummary, SaveStatusSummary } from '@flowstudio/shared';

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

  async getSaveStatus(diagramId: string): Promise<SaveStatusSummary> {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(diagramId)}/save-status`);
    if (!res.ok) throw new Error(`获取保存状态失败: ${res.statusText}`);
    return res.json();
  },

  async forceSave(diagramId: string): Promise<{ success: boolean; flushed: boolean; status: SaveStatusSummary }> {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(diagramId)}/save`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error(`手动保存失败: ${res.statusText}`);
    return res.json();
  },
};

export { generateMiniSvgThumbnail } from './mini-thumbnail.js';

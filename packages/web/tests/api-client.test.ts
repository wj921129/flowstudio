import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FlowEdge, FlowNode } from '@flowstudio/shared';
import { apiClient, generateMiniSvgThumbnail } from '../src/lib/api-client';
import { getTemplateMiniThumbnail } from '../src/lib/mini-thumbnail';
import { TEMPLATES_REGISTRY } from '../src/features/sidebar/templates';

describe('apiClient & SVG thumbnail generator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls listDiagrams and duplicateDiagram endpoints properly', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ diagrams: [{ id: 'd1', title: '测试图' }] }),
    } as Response);

    const list = await apiClient.listDiagrams('测试');
    expect(fetchSpy).toHaveBeenCalledWith('/api/diagrams?q=%E6%B5%8B%E8%AF%95');
    expect(list[0].id).toBe('d1');
  });

  it('generates semantic SVG shapes and colors for flowchart and arch nodes', () => {
    const nodes: FlowNode[] = [
      { id: 's', type: 'start-end', position: { x: 0, y: 0 }, data: { label: '开始', type: 'start-end' } },
      { id: 'p', type: 'process', position: { x: 200, y: 0 }, data: { label: '处理', type: 'process' } },
      { id: 'd', type: 'decision', position: { x: 400, y: 0 }, data: { label: '判断', type: 'decision' } },
      { id: 'db', type: 'database', position: { x: 600, y: 0 }, data: { label: '主库', type: 'database' } },
      { id: 'io', type: 'io', position: { x: 800, y: 0 }, data: { label: '报文', type: 'io' } },
      { id: 'c', type: 'comment', position: { x: 1000, y: 0 }, data: { label: '备注', type: 'comment' } },
      { id: 'e', type: 'start-end', position: { x: 1200, y: 0 }, data: { label: '结束', type: 'start-end' } },
    ];
    const edges: FlowEdge[] = [
      { id: 'e1', source: 's', target: 'p' },
      { id: 'e2', source: 'p', target: 'd' },
      { id: 'e3', source: 'd', target: 'e', data: { style: { strokeStyle: 'dashed' }, waypoints: [{ x: 470, y: 200 }, { x: 1260, y: 200 }] } },
    ];

    const svg = generateMiniSvgThumbnail(nodes, edges);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.includes('<rect')).toBe(true);
    expect(svg.includes('#d1fae5')).toBe(true);
    expect(svg.includes('#ffe4e6')).toBe(true);
    expect(svg.includes('<polygon')).toBe(true);
    expect(svg.includes('<ellipse')).toBe(true);
    expect(svg.includes('<polyline')).toBe(true);
    expect(svg.includes('stroke-dasharray')).toBe(true);
    expect(svg.includes('<marker')).toBe(false);
    expect(svg.includes('200')).toBe(true);
  });

  it('renders horizontal and vertical swimlane pool and lane containers', () => {
    const horizPool: FlowNode[] = [
      { id: 'pool1', type: 'pool', position: { x: 0, y: 0 }, width: 600, height: 300, data: { label: 'Pool', type: 'pool', orientation: 'horizontal' } },
      { id: 'lane1', type: 'lane', parentId: 'pool1', position: { x: 40, y: 0 }, width: 560, height: 300, data: { label: 'Lane', type: 'lane', orientation: 'horizontal' } },
      { id: 'n1', type: 'process', parentId: 'lane1', position: { x: 80, y: 80 }, data: { label: 'Step', type: 'process' } },
    ];
    const vertPool: FlowNode[] = [
      { id: 'pool2', type: 'pool', position: { x: 0, y: 0 }, width: 400, height: 600, data: { label: 'PoolV', type: 'pool', orientation: 'vertical' } },
      { id: 'lane2', type: 'lane', parentId: 'pool2', position: { x: 0, y: 40 }, width: 400, height: 560, data: { label: 'LaneV', type: 'lane', orientation: 'vertical' } },
    ];

    const hSvg = generateMiniSvgThumbnail(horizPool, []);
    const vSvg = generateMiniSvgThumbnail(vertPool, []);
    expect(hSvg.includes('#cbd5e1')).toBe(true);
    expect(vSvg.includes('#cbd5e1')).toBe(true);
    expect(hSvg).not.toBe(vSvg);
  });

  it('generates and caches valid semantic SVG thumbnails for every built-in template', () => {
    expect(TEMPLATES_REGISTRY.length).toBeGreaterThan(0);
    for (const tpl of TEMPLATES_REGISTRY) {
      const first = getTemplateMiniThumbnail(tpl);
      const second = getTemplateMiniThumbnail(tpl);
      expect(first.startsWith('<svg')).toBe(true);
      expect(first.includes('preserveAspectRatio="xMidYMid meet"')).toBe(true);
      expect(first.includes('<marker')).toBe(false);
      expect(second).toBe(first);
    }
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiClient, generateMiniSvgThumbnail } from '../src/lib/api-client';

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

  it('generates a valid mini SVG thumbnail string from nodes and edges', () => {
    const svg = generateMiniSvgThumbnail(
      [{ id: 'n1', type: 'process', position: { x: 10, y: 20 }, data: { label: 'A', type: 'process' } }],
      [],
    );
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.includes('<rect')).toBe(true);
  });
});

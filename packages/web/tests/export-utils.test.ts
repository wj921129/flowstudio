import { describe, it, expect } from 'vitest';
import { generateDiagramSvg } from '../src/lib/export-utils.js';
import type { FlowNode, FlowEdge } from '@flowstudio/shared';

describe('export-utils: Pure Vector SVG & Export Data Generation', () => {
  it('generates a valid SVG document with correct namespaces, nodes, and orthogonal edges', () => {
    const nodes: FlowNode[] = [
      {
        id: 'pool-1',
        type: 'pool',
        position: { x: 50, y: 50 },
        width: 800,
        height: 400,
        data: { label: '审批泳道池', type: 'pool' },
      },
      {
        id: 'node-start',
        type: 'start-end',
        position: { x: 100, y: 150 },
        width: 120,
        height: 60,
        data: { label: '发起申请 & 校验', type: 'start-end' },
      },
      {
        id: 'node-audit',
        type: 'decision',
        position: { x: 300, y: 130 },
        width: 140,
        height: 100,
        data: { label: '风控审核', type: 'decision' },
      },
    ];

    const edges: FlowEdge[] = [
      {
        id: 'e-1',
        source: 'node-start',
        target: 'node-audit',
        data: { label: '提交审批' },
      },
    ];

    const svg = generateDiagramSvg(nodes, edges, '测试流程图');

    // 1. 验证 SVG 标准声明与视口
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox=');

    // 2. 验证箭头 Marker
    expect(svg).toContain('id="fs-arrow"');
    expect(svg).toContain('marker-end="url(#fs-arrow)"');

    // 3. 验证节点图形渲染
    expect(svg).toContain('审批泳道池');
    expect(svg).toContain('风控审核');
    expect(svg).toContain('提交审批');

    // 4. 验证 XML 特殊字符转义（& -> &amp;）
    expect(svg).toContain('发起申请 &amp; 校验');
  });

  it('handles empty diagram gracefully without throwing errors', () => {
    const svg = generateDiagramSvg([], [], '空图');
    expect(svg).toContain('<svg');
    expect(svg).toContain('空图表');
  });
});

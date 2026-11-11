import { describe, it, expect } from 'vitest';
import {
  generateDiagramSvg,
  validateAndParseDiagramJson,
} from '../src/lib/export-utils.js';
import type { FlowNode, FlowEdge } from '@flowstudio/shared';

describe('export-utils: Pure Vector SVG & High-Fidelity 9-Node Geometry', () => {
  it('generates high-fidelity SVG for 9 core node types with custom styles', () => {
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
        id: 'lane-1',
        type: 'lane',
        parentId: 'pool-1',
        position: { x: 0, y: 40 },
        width: 800,
        height: 180,
        data: { label: '研发泳道', type: 'lane' },
      },
      {
        id: 'node-start',
        type: 'start-end',
        parentId: 'lane-1',
        position: { x: 50, y: 30 },
        width: 120,
        height: 60,
        data: { label: '发起申请 & 校验', type: 'start-end' },
      },
      {
        id: 'node-audit',
        type: 'decision',
        parentId: 'lane-1',
        position: { x: 250, y: 20 },
        width: 140,
        height: 80,
        data: { label: '风控审核', type: 'decision' },
      },
      {
        id: 'node-io',
        type: 'io',
        parentId: 'lane-1',
        position: { x: 450, y: 30 },
        width: 140,
        height: 60,
        data: { label: '外部输入输出', type: 'io' },
      },
      {
        id: 'node-doc',
        type: 'document',
        position: { x: 100, y: 500 },
        width: 160,
        height: 80,
        data: { label: '打印报表', type: 'document' },
      },
      {
        id: 'node-db',
        type: 'database',
        position: { x: 300, y: 500 },
        width: 120,
        height: 90,
        data: { label: '持久化仓库', type: 'database', style: { fillColor: '#EFF6FF', borderColor: '#3B82F6' } },
      },
      {
        id: 'node-sub',
        type: 'subprocess',
        position: { x: 500, y: 500 },
        width: 160,
        height: 80,
        data: { label: '子流程调用', type: 'subprocess' },
      },
      {
        id: 'node-comment',
        type: 'comment',
        position: { x: 700, y: 500 },
        width: 140,
        height: 80,
        data: { label: '备忘便签', type: 'comment' },
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

    // 1. 标准声明
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox=');

    // 2. 9 种几何特征与标签
    expect(svg).toContain('审批泳道池');
    expect(svg).toContain('研发泳道');
    expect(svg).toContain('发起申请 &amp; 校验');
    expect(svg).toContain('风控审核');
    expect(svg).toContain('外部输入输出');
    expect(svg).toContain('打印报表');
    expect(svg).toContain('持久化仓库');
    expect(svg).toContain('子流程调用');
    expect(svg).toContain('备忘便签');

    // 3. 特殊几何形状验证 (如圆柱体数据库的 ellipse, 波浪文档的 path Q, 菱形的 polygon)
    expect(svg).toContain('<ellipse');
    expect(svg).toContain('<polygon');
    expect(svg).toContain('fill="#EFF6FF"');
    expect(svg).toContain('stroke="#3B82F6"');
  });

  describe('validateAndParseDiagramJson', () => {
    it('正确解析合法的 JSON 流程图工程文件', () => {
      const validJson = JSON.stringify({
        title: '我的流程图',
        nodes: [
          { id: '1', type: 'process', position: { x: 10, y: 20 }, data: { label: '节点1' } },
        ],
        edges: [
          { id: 'e1', source: '1', target: '2' },
        ],
      });

      const res = validateAndParseDiagramJson(validJson);
      expect(res.success).toBe(true);
      expect(res.title).toBe('我的流程图');
      expect(res.nodes?.length).toBe(1);
      expect(res.edges?.length).toBe(1);
    });

    it('拦截非对象或格式错乱的 JSON', () => {
      const bad = validateAndParseDiagramJson('not a json');
      expect(bad.success).toBe(false);
      expect(bad.error).toContain('JSON 解析失败');

      const missingNodes = validateAndParseDiagramJson(JSON.stringify({ title: 't' }));
      expect(missingNodes.success).toBe(false);
      expect(missingNodes.error).toContain('缺少有效的 nodes');
    });
  });
});

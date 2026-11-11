import { describe, it, expect } from 'vitest';
import type { FlowNode, FlowEdge } from '@flowstudio/shared';
import { buildStandaloneHtml } from '../src/lib/standalone-html';

describe('单文件交互式离线 HTML 生成器', () => {
  it('正确生成包含 SVG 图元与内置交互脚本的单文件 HTML', () => {
    const nodes: FlowNode[] = [
      {
        id: 'node-start',
        type: 'start-end',
        position: { x: 50, y: 50 },
        width: 120,
        height: 50,
        data: { label: '发起评审', type: 'start-end' },
      },
      {
        id: 'node-decision',
        type: 'decision',
        position: { x: 250, y: 40 },
        width: 100,
        height: 70,
        data: { label: '是否合规', type: 'decision' },
      },
    ];

    const edges: FlowEdge[] = [
      {
        id: 'edge-1',
        source: 'node-start',
        target: 'node-decision',
        type: 'orthogonal',
        data: { label: '送审' },
      },
    ];

    const html = buildStandaloneHtml(nodes, edges, '发布评审架构');

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>发布评审架构 · FlowStudio 离线快照</title>');
    expect(html).toContain('发布评审架构');
    expect(html).toContain('送审');
    expect(html).toContain('window.__FLOWSTUDIO_SNAPSHOT__');
    expect(html).toContain('id="stage"');
    expect(html).toContain('id="zin"');
    expect(html).toContain('id="zout"');
    expect(html).toContain('id="fit"');
  });
});
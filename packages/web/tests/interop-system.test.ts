import { describe, it, expect, beforeEach } from 'vitest';
import type { FlowNode, FlowEdge } from '@flowstudio/shared';
import { parseDrawioXml, parseBpmnXml, diagramToBpmnXml } from '@flowstudio/shared';
import { buildStandaloneHtml } from '../src/lib/standalone-html';
import { useFlowStore } from '../src/stores/flow-store';

describe('多格式数据导入与跨生态互通系统验收', () => {
  beforeEach(() => {
    useFlowStore.getState().resetDiagramState();
  });

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
        {
          id: 'node-service',
          type: 'arch-microservice',
          position: { x: 450, y: 40 },
          width: 140,
          height: 70,
          data: { label: '结算服务', type: 'arch-microservice' },
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
      expect(html).toContain('id="clear"');
      expect(html).toContain('applySpotlight');
    });
  });

  describe('FlowStore appendSubgraph 增量追加与 ID 防冲突', () => {
    it('支持平滑追加子图，并在 ID 重复时自动重映射 ID 保持引用完整', () => {
      const initialNodes: FlowNode[] = [
        {
          id: 'shared-id',
          type: 'process',
          position: { x: 100, y: 100 },
          data: { label: '初始节点', type: 'process' },
        },
      ];
      useFlowStore.getState().setDiagram(initialNodes, []);
      expect(useFlowStore.getState().nodes.length).toBe(1);

      // 追加包含同名 ID 的新子图
      const incomingNodes: FlowNode[] = [
        {
          id: 'shared-id',
          type: 'decision',
          position: { x: 300, y: 100 },
          data: { label: '冲突节点', type: 'decision' },
        },
        {
          id: 'child-node',
          type: 'process',
          position: { x: 500, y: 100 },
          parentId: 'shared-id',
          data: { label: '子节点', type: 'process' },
        },
      ];
      const incomingEdges: FlowEdge[] = [
        {
          id: 'edge-conflict',
          source: 'shared-id',
          target: 'child-node',
          type: 'orthogonal',
        },
      ];

      useFlowStore.getState().appendSubgraph(incomingNodes, incomingEdges);

      const currentNodes = useFlowStore.getState().nodes;
      const currentEdges = useFlowStore.getState().edges;

      expect(currentNodes.length).toBe(3);
      expect(currentEdges.length).toBe(1);

      // 验证原有节点保持原 ID
      const original = currentNodes.find((n) => n.id === 'shared-id' && n.data.label === '初始节点');
      expect(original).toBeDefined();

      // 验证冲突的新节点分配了全新安全 ID，且子节点 parentId 与连线 source 同步更新
      const remappedNode = currentNodes.find((n) => n.data.label === '冲突节点');
      expect(remappedNode).toBeDefined();
      expect(remappedNode?.id).not.toBe('shared-id');
      expect(remappedNode?.id.startsWith('shared-id-')).toBe(true);

      const child = currentNodes.find((n) => n.id === 'child-node');
      expect(child?.parentId).toBe(remappedNode?.id);

      const edge = currentEdges[0];
      expect(edge.source).toBe(remappedNode?.id);
      expect(edge.target).toBe('child-node');
    });
  });

  describe('跨生态 BPMN 2.0 与 Draw.io 端到端数据互通', () => {
    it('Draw.io XML 导入后可正确追加至画布并支持导出为 BPMN 2.0', async () => {
      const sampleDrawio = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net">
  <diagram name="Page-1" id="test-p1">
    <mxGraphModel dx="1000" dy="800" grid="1" gridSize="10">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="n-start" value="用户提交" vertex="1" parent="1" style="ellipse;whiteSpace=wrap;html=1;">
          <mxGeometry x="60" y="100" width="100" height="60" as="geometry" />
        </mxCell>
        <mxCell id="n-audit" value="人工审批" vertex="1" parent="1" style="rounded=1;whiteSpace=wrap;html=1;">
          <mxGeometry x="220" y="100" width="120" height="60" as="geometry" />
        </mxCell>
        <mxCell id="e-flow" value="送审" edge="1" parent="1" source="n-start" target="n-audit">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

      const res = await parseDrawioXml(sampleDrawio);
      expect(res.nodes.length).toBe(2);
      expect(res.edges.length).toBe(1);

      useFlowStore.getState().appendSubgraph(res.nodes, res.edges);

      const state = useFlowStore.getState();
      expect(state.nodes.length).toBe(2);
      expect(state.edges.length).toBe(1);

      // 验证导出为 BPMN 2.0
      const bpmnXml = diagramToBpmnXml(state.nodes, state.edges, '生态互通测试流程');
      expect(bpmnXml).toContain('<bpmn:definitions');
      expect(bpmnXml).toContain('name="生态互通测试流程"');
      expect(bpmnXml).toContain('sourceRef="dw-n-start"');
      expect(bpmnXml).toContain('targetRef="dw-n-audit"');
      expect(bpmnXml).toContain('<bpmndi:BPMNDiagram');
    });
  });
});

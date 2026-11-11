import { describe, it, expect } from 'vitest';
import {
  parseXml,
  walkTags,
  findChildren,
  findChild,
  escXml,
  parseDrawioXml,
  parseBpmnXml,
  diagramToBpmnXml,
  type FlowNode,
  type FlowEdge,
} from '../src/index.js';

describe('XML 零依赖流式解析器', () => {
  it('正确解析嵌套标签、属性、CDATA 与实体转义', () => {
    const xml = `<root id="1" name="测试 &amp; 样例">
      <child type="a" count="10">文本 &lt;值&gt;</child>
      <child type="b"><![CDATA[<raw>data</raw>]]></child>
    </root>`;
    const doc = parseXml(xml);
    expect(doc.tag).toBe('#root');
    const rootEl = doc.children[0];
    expect(rootEl.tag).toBe('root');
    expect(rootEl.attrs.id).toBe('1');
    expect(rootEl.attrs.name).toBe('测试 & 样例');
    expect(rootEl.children.length).toBe(2);
    expect(rootEl.children[0].attrs.type).toBe('a');
    expect(rootEl.children[0].attrs.count).toBe('10');
    expect(rootEl.children[0].text).toBe('文本 <值>');
    expect(rootEl.children[1].text).toBe('<raw>data</raw>');
  });

  it('支持自闭合标签与多层标签树检索', () => {
    const xml = `<defs>
      <group id="g1">
        <item code="c1" />
        <item code="c2" />
      </group>
      <other id="o1" />
    </defs>`;
    const doc = parseXml(xml);
    const items = walkTags(doc, 'item');
    expect(items.length).toBe(2);
    expect(items[0].attrs.code).toBe('c1');
    expect(items[1].attrs.code).toBe('c2');

    const group = walkTags(doc, 'group')[0];
    expect(group).toBeDefined();
    expect(findChildren(group, 'item').length).toBe(2);
    expect(escXml('<div class="a">&</div>')).toBe('&lt;div class=&quot;a&quot;&gt;&amp;&lt;/div&gt;');
  });
});

describe('Draw.io XML 导入桥接器', () => {
  it('成功将标准 mxGraphModel XML 转换为 FlowStudio 节点与连线', async () => {
    const drawioXml = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net">
  <diagram name="Page-1" id="test-1">
    <mxGraphModel dx="1000" dy="800" grid="1" gridSize="10">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="node-1" value="开始节点" vertex="1" parent="1" style="rounded=1;whiteSpace=wrap;html=1;">
          <mxGeometry x="100" y="100" width="120" height="60" as="geometry" />
        </mxCell>
        <mxCell id="node-2" value="条件判定" vertex="1" parent="1" style="rhombus;whiteSpace=wrap;html=1;">
          <mxGeometry x="300" y="90" width="100" height="80" as="geometry" />
        </mxCell>
        <mxCell id="node-3" value="数据库存储" vertex="1" parent="1" style="shape=cylinder;whiteSpace=wrap;html=1;">
          <mxGeometry x="500" y="90" width="80" height="80" as="geometry" />
        </mxCell>
        <mxCell id="edge-1" value="下一步" edge="1" parent="1" source="node-1" target="node-2" style="edgeStyle=orthogonalEdgeStyle;">
          <mxGeometry relative="1" as="geometry">
            <Array as="points">
              <mxPoint x="250" y="130" />
            </Array>
          </mxGeometry>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

    const res = await parseDrawioXml(drawioXml);
    expect(res.nodes.length).toBe(3);
    expect(res.edges.length).toBe(1);

    const n1 = res.nodes.find((n) => n.id === 'dw-node-1');
    expect(n1).toBeDefined();
    expect(n1?.data.label).toBe('开始节点');
    expect(n1?.position).toEqual({ x: 100, y: 100 });
    expect(n1?.width).toBe(120);
    expect(n1?.height).toBe(60);

    const n2 = res.nodes.find((n) => n.id === 'dw-node-2');
    expect(n2?.type).toBe('decision');

    const n3 = res.nodes.find((n) => n.id === 'dw-node-3');
    expect(n3?.type).toBe('database');

    const e1 = res.edges[0];
    expect(e1.id).toBe('dw-edge-1');
    expect(e1.source).toBe('dw-node-1');
    expect(e1.target).toBe('dw-node-2');
    expect(e1.data?.label).toBe('下一步');
    expect(e1.data?.waypoints).toEqual([{ x: 250, y: 130 }]);
  });

  it('无效 Drawio XML 抛出异常', async () => {
    await expect(parseDrawioXml('<xml>invalid</xml>')).rejects.toThrow('不是有效的 Draw.io / mxGraph XML 文件');
  });
});

describe('BPMN 2.0 互通桥接器', () => {
  const sampleBpmn = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  id="Def-1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" name="订单审批流程" isExecutable="false">
    <bpmn:startEvent id="Start_1" name="提交订单" />
    <bpmn:userTask id="Task_1" name="风控审核" />
    <bpmn:exclusiveGateway id="Gateway_1" name="风控通过?" />
    <bpmn:endEvent id="End_1" name="流程归档" />
    <bpmn:sequenceFlow id="Flow_1" name="审批中" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="Gateway_1" />
    <bpmn:sequenceFlow id="Flow_3" name="通过" sourceRef="Gateway_1" targetRef="End_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Shape_Start_1" bpmnElement="Start_1">
        <dc:Bounds x="100" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Shape_Task_1" bpmnElement="Task_1">
        <dc:Bounds x="200" y="180" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Shape_Gateway_1" bpmnElement="Gateway_1">
        <dc:Bounds x="360" y="195" width="50" height="50" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Shape_End_1" bpmnElement="End_1">
        <dc:Bounds x="480" y="200" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Edge_Flow_1" bpmnElement="Flow_1">
        <di:waypoint x="136" y="218" />
        <di:waypoint x="200" y="220" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

  it('成功从 BPMN 2.0 XML 解析图元与连线', () => {
    const res = parseBpmnXml(sampleBpmn);
    expect(res.nodes.length).toBe(4);
    expect(res.edges.length).toBe(3);

    const startNode = res.nodes.find((n) => n.id === 'bp-Start_1');
    expect(startNode).toBeDefined();
    expect(startNode?.type).toBe('start-end');
    expect(startNode?.data.label).toBe('提交订单');
    expect(startNode?.position).toEqual({ x: 100, y: 200 });
    expect(startNode?.width).toBe(36);
    expect(startNode?.height).toBe(36);

    const taskNode = res.nodes.find((n) => n.id === 'bp-Task_1');
    expect(taskNode?.type).toBe('process');
    expect(taskNode?.data.label).toBe('风控审核');

    const gwNode = res.nodes.find((n) => n.id === 'bp-Gateway_1');
    expect(gwNode?.type).toBe('decision');

    const e1 = res.edges.find((e) => e.id === 'bp-Flow_1');
    expect(e1).toBeDefined();
    expect(e1?.source).toBe('bp-Start_1');
    expect(e1?.target).toBe('bp-Task_1');
    expect(e1?.data?.label).toBe('审批中');
    expect(e1?.data?.waypoints).toEqual([{ x: 136, y: 218 }, { x: 200, y: 220 }]);
  });

  it('成功将 FlowStudio 流程图与泳道导出为标准 BPMN 2.0 XML', () => {
    const nodes: FlowNode[] = [
      {
        id: 'pool-1',
        type: 'pool',
        position: { x: 0, y: 0 },
        width: 800,
        height: 400,
        data: { label: '审批流程池', type: 'pool' },
      },
      {
        id: 'lane-1',
        type: 'lane',
        position: { x: 0, y: 0 },
        width: 800,
        height: 200,
        parentId: 'pool-1',
        data: { label: '风控组', type: 'lane' },
      },
      {
        id: 'n-start',
        type: 'start-end',
        position: { x: 50, y: 80 },
        width: 80,
        height: 40,
        parentId: 'lane-1',
        data: { label: '申请开始', type: 'start-end' },
      },
      {
        id: 'n-task',
        type: 'process',
        position: { x: 200, y: 70 },
        width: 120,
        height: 60,
        parentId: 'lane-1',
        data: { label: '合规核验', type: 'process' },
      },
    ];

    const edges: FlowEdge[] = [
      {
        id: 'e-1',
        source: 'n-start',
        target: 'n-task',
        type: 'orthogonal',
        data: { label: '提交' },
      },
    ];

    const xml = diagramToBpmnXml(nodes, edges, '自动化审批');
    expect(xml).toContain('<bpmn:definitions');
    expect(xml).toContain('name="自动化审批"');
    expect(xml).toContain('<laneSet id="laneSet-1">');
    expect(xml).toContain('<lane id="lane-1" name="风控组">');
    expect(xml).toContain('<flowNodeRef>n-start</flowNodeRef>');
    expect(xml).toContain('<flowNodeRef>n-task</flowNodeRef>');
    expect(xml).toContain('<startEvent id="n-start" name="申请开始"');
    expect(xml).toContain('<task id="n-task" name="合规核验"');
    expect(xml).toContain('<sequenceFlow id="e-1" name="提交" sourceRef="n-start" targetRef="n-task" />');
    expect(xml).toContain('<bpmndi:BPMNDiagram');
  });
});
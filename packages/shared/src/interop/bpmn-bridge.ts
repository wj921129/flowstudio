import type { FlowNode, FlowEdge, XYPosition, FlowNodeType } from '../types.js';
import { getNodeRegistryEntry } from '../node-registry.js';
import { flowNodeSchema, flowEdgeSchema } from '../schemas/diagram-schema.js';
import { parseXml, walkTags, findChildren, findChild, escXml, type XmlNode } from './xml-parser.js';

export interface BpmnImportResult {
  nodes: FlowNode[];
  edges: FlowEdge[];
  warnings: string[];
}

const END_EVENT_RE = /结束|终止|end/i;
const CHILD_TASK_TAGS = new Set([
  'task', 'userTask', 'serviceTask', 'scriptTask', 'manualTask', 'sendTask', 'receiveTask',
  'businessRuleTask', 'callActivity', 'subProcess',
]);
const GATEWAY_TAGS = new Set([
  'exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'eventBasedGateway', 'complexGateway',
]);
const DATA_TAGS = new Set(['dataObjectReference', 'dataStoreReference']);
const EVENT_TAGS = new Set([
  'startEvent', 'endEvent', 'intermediateCatchEvent', 'intermediateThrowEvent', 'boundaryEvent',
]);

const mapBpmnType = (tag: string): FlowNodeType => {
  if (tag === 'startEvent' || tag === 'endEvent') return 'start-end';
  if (tag === 'callActivity' || tag === 'subProcess') return 'subprocess';
  if (GATEWAY_TAGS.has(tag)) return 'decision';
  if (DATA_TAGS.has(tag)) return 'database';
  if (CHILD_TASK_TAGS.has(tag) || EVENT_TAGS.has(tag)) return 'process';
  return 'process';
};

const toNum = (v: string | undefined, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

interface DiShape {
  bpmnElement: string;
  x: number;
  y: number;
  w: number;
  h: number;
  isLane: boolean;
}

const readDiShapes = (doc: XmlNode): Map<string, DiShape> => {
  const map = new Map<string, DiShape>();
  for (const shape of walkTags(doc, 'BPMNShape')) {
    const ref = shape.attrs.bpmnElement;
    const bounds = findChild(shape, 'Bounds');
    if (!ref || !bounds) continue;
    map.set(ref, {
      bpmnElement: ref,
      x: toNum(bounds.attrs.x),
      y: toNum(bounds.attrs.y),
      w: toNum(bounds.attrs.width, 120),
      h: toNum(bounds.attrs.height, 70),
      isLane: shape.attrs.isLane === 'true',
    });
  }
  return map;
};

const readDiWaypoints = (doc: XmlNode): Map<string, XYPosition[]> => {
  const map = new Map<string, XYPosition[]>();
  for (const edge of walkTags(doc, 'BPMNEdge')) {
    const ref = edge.attrs.bpmnElement;
    if (!ref) continue;
    const pts = findChildren(edge, 'waypoint')
      .map((p) => ({ x: toNum(p.attrs.x), y: toNum(p.attrs.y) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (pts.length >= 2) map.set(ref, pts);
  }
  return map;
};

export function parseBpmnXml(xml: string): BpmnImportResult {
  const warnings: string[] = [];
  if (!/<definitions/i.test(xml) || !/<process/i.test(xml)) {
    throw new Error('不是有效的 BPMN 2.0 文件（缺少 definitions/process）');
  }
  const doc = parseXml(xml);
  const processes = walkTags(doc, 'process');
  if (processes.length === 0) throw new Error('未找到 BPMN process 定义');

  const diShapes = readDiShapes(doc);
  const diWaypoints = readDiWaypoints(doc);
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const idMap = new Map<string, string>();
  const registrySize = (t: FlowNodeType) => getNodeRegistryEntry(t)?.defaultSize ?? { width: 160, height: 80 };

  const labelOf = (el: XmlNode): string => (el.attrs.name || '').trim();

  const addNode = (el: XmlNode, tag: string, parentId?: string) => {
    const bpmnId = el.attrs.id || `${tag}-${nodes.length}`;
    if (idMap.has(bpmnId)) return;
    const mappedId = `bp-${bpmnId}`;
    idMap.set(bpmnId, mappedId);
    const type = mapBpmnType(tag);
    const di = diShapes.get(bpmnId);
    const rs = registrySize(type);
    const size = di ? { w: di.w, h: di.h } : { w: rs.width, h: rs.height };
    const label = labelOf(el) || (type === 'start-end' ? (tag === 'endEvent' ? '结束' : '开始') : getNodeRegistryEntry(type)?.label || type);
    const node: FlowNode = {
      id: mappedId,
      type,
      position: { x: Math.round(di?.x ?? 80 + (nodes.length % 8) * 220), y: Math.round(di?.y ?? 80 + Math.floor(nodes.length / 8) * 140) },
      data: { label, type },
      width: size.w,
      height: size.h,
    };
    if (parentId && idMap.has(parentId)) {
      node.parentId = idMap.get(parentId);
      node.extent = 'parent';
    }
    const parsed = flowNodeSchema.safeParse(node);
    if (parsed.success) nodes.push(parsed.data as FlowNode);
    else warnings.push(`元素「${label}」(${tag}) 校验失败已跳过`);
    if (!di && tag !== 'startEvent') warnings.push(`「${label}」缺少 BPMNDI 坐标，已自动排布`);
  };

  const addEdge = (el: XmlNode, tag: string) => {
    const bpmnId = el.attrs.id || `flow-${edges.length}`;
    const sourceRef = el.attrs.sourceRef;
    const targetRef = el.attrs.targetRef;
    const source = sourceRef ? idMap.get(sourceRef) : undefined;
    const target = targetRef ? idMap.get(targetRef) : undefined;
    if (!source || !target) {
      warnings.push(`连线「${labelOf(el) || bpmnId}」端点未解析已跳过`);
      return;
    }
    idMap.set(bpmnId, mappedEdgeId(bpmnId));
    const waypoints = diWaypoints.get(bpmnId);
    const edge: FlowEdge = {
      id: mappedEdgeId(bpmnId),
      source,
      target,
      type: 'orthogonal',
      data: {
        ...(labelOf(el) ? { label: labelOf(el) } : {}),
        ...(tag === 'messageFlow' ? { routingType: 'straight' as const } : {}),
        ...(waypoints ? { waypoints } : {}),
      },
    };
    const parsed = flowEdgeSchema.safeParse(edge);
    if (parsed.success) edges.push(parsed.data as FlowEdge);
  };

  const mappedEdgeId = (bpmnId: string) => `bp-${bpmnId}`;

  for (const process of processes) {
    const laneSet = findChild(process, 'laneSet');
    const lanes = laneSet ? findChildren(laneSet, 'lane') : [];
    const laneChildMap = new Map<string, string[]>();
    let poolId: string | undefined;

    if (lanes.length > 0) {
      poolId = `bp-pool-${process.attrs.id || processes.indexOf(process)}`;
      const laneGeos = lanes.map((l) => diShapes.get(l.attrs.id)).filter(Boolean) as DiShape[];
      let poolX = 0;
      let poolY = 0;
      let poolW = 800;
      let poolH = 400;
      if (laneGeos.length > 0) {
        poolX = Math.min(...laneGeos.map((g) => g.x));
        poolY = Math.min(...laneGeos.map((g) => g.y));
        poolW = Math.max(...laneGeos.map((g) => g.x + g.w)) - poolX;
        poolH = Math.max(...laneGeos.map((g) => g.y + g.h)) - poolY;
      }
      const poolNode: FlowNode = {
        id: poolId,
        type: 'pool',
        position: { x: Math.round(poolX), y: Math.round(poolY) },
        data: { label: labelOf(process) || '流程池', type: 'pool', orientation: 'vertical' },
        width: poolW,
        height: poolH,
      };
      const poolParsed = flowNodeSchema.safeParse(poolNode);
      if (poolParsed.success) nodes.push(poolParsed.data as FlowNode);
      else warnings.push('泳道池解析失败');

      lanes.forEach((lane, i) => {
        const laneId = `bp-lane-${lane.attrs.id || i}`;
        idMap.set(lane.attrs.id || `lane-${i}`, laneId);
        const geo = diShapes.get(lane.attrs.id);
        const laneNode: FlowNode = {
          id: laneId,
          type: 'lane',
          position: { x: Math.round(geo?.x ?? poolX), y: Math.round(geo?.y ?? poolY) },
          data: { label: labelOf(lane) || `泳道 ${i + 1}`, type: 'lane', parentId: poolId },
          width: geo?.w ?? poolW,
          height: geo?.h ?? Math.round(poolH / lanes.length),
          parentId: poolId,
          extent: 'parent',
        };
        const laneParsed = flowNodeSchema.safeParse(laneNode);
        if (laneParsed.success) nodes.push(laneParsed.data as FlowNode);
        laneChildMap.set(
          lane.attrs.id || `lane-${i}`,
          lane.children.filter((c) => c.tag === 'flowNodeRef').map((c) => c.text.trim()).filter(Boolean)
        );
      });
    }

    const laneOf = (bpmnId: string): string | undefined => {
      for (const [laneBpmnId, refs] of laneChildMap) if (refs.includes(bpmnId)) return idMap.get(laneBpmnId);
      return undefined;
    };

    for (const el of process.children) {
      const tag = el.tag;
      if (tag === 'laneSet') continue;
      if (EVENT_TAGS.has(tag) || CHILD_TASK_TAGS.has(tag) || GATEWAY_TAGS.has(tag) || DATA_TAGS.has(tag)) {
        addNode(el, tag, laneOf(el.attrs.id || ''));
      } else if (tag === 'sequenceFlow' || tag === 'messageFlow') {
        addEdge(el, tag);
      }
    }
  }

  if (nodes.length === 0) throw new Error('未从 BPMN 文件解析出有效节点');
  return { nodes, edges, warnings };
}

const BPMN_EXPORT_TYPE: Partial<Record<FlowNodeType, string>> = {
  'start-end': 'startEvent',
  process: 'task',
  subprocess: 'subProcess',
  decision: 'exclusiveGateway',
  database: 'dataStoreReference',
};

const centerOf = (n: FlowNode): XYPosition => ({
  x: n.position.x + (n.width ?? 160) / 2,
  y: n.position.y + (n.height ?? 80) / 2,
});

export function diagramToBpmnXml(nodes: FlowNode[], edges: FlowEdge[], title = 'FlowStudio 流程图'): string {
  const exportNodes = nodes.filter((n) => n.type !== 'pool' && n.type !== 'lane');
  const pools = nodes.filter((n) => n.type === 'pool');
  const lanes = nodes.filter((n) => n.type === 'lane');
  const idOf = (nodeId: string): string => nodeId;

  const flowNodeRefsByLane = new Map<string, string[]>();
  for (const lane of lanes) {
    const refs = exportNodes.filter((n) => n.parentId === lane.id).map((n) => idOf(n.id));
    if (refs.length) flowNodeRefsByLane.set(lane.id, refs);
  }

  const body: string[] = [];
  for (const n of exportNodes) {
    const tag = BPMN_EXPORT_TYPE[n.type] ?? 'task';
    const name = ` name="${escXml(n.data.label)}"`;
    const attrs = tag === 'exclusiveGateway' ? `${name} gatewayDirection="Unspecified"` : name;
    if (tag === 'dataStoreReference') body.push(`    <dataStoreReference id="${escXml(n.id)}"${name} />`);
    else body.push(`    <${tag} id="${escXml(n.id)}"${attrs} />`);
  }
  for (const e of edges) {
    const label = e.data?.label ? ` name="${escXml(e.data.label)}"` : '';
    body.push(`    <sequenceFlow id="${escXml(e.id)}"${label} sourceRef="${escXml(e.source)}" targetRef="${escXml(e.target)}" />`);
  }

  const di: string[] = [];
  for (const n of nodes) {
    const isLane = n.type === 'lane';
    di.push(
      `        <bpmndi:BPMNShape id="shape-${escXml(n.id)}" bpmnElement="${escXml(n.id)}"${isLane ? ' isLane="true"' : ''}>\n` +
        `          <dc:Bounds x="${Math.round(n.position.x)}" y="${Math.round(n.position.y)}" width="${Math.round(n.width ?? 160)}" height="${Math.round(n.height ?? 80)}" />\n` +
        `        </bpmndi:BPMNShape>`
    );
  }
  for (const e of edges) {
    const s = nodes.find((n) => n.id === e.source);
    const t = nodes.find((n) => n.id === e.target);
    if (!s || !t) continue;
    const pts = (e.data?.waypoints && e.data.waypoints.length >= 2 ? e.data.waypoints : [centerOf(s), centerOf(t)])
      .map((p) => `          <di:waypoint x="${Math.round(p.x)}" y="${Math.round(p.y)}" />`)
      .join('\n');
    di.push(
      `        <bpmndi:BPMNEdge id="edge-${escXml(e.id)}" bpmnElement="${escXml(e.id)}">\n${pts}\n        </bpmndi:BPMNEdge>`
    );
  }

  const laneSetXml =
    pools.length > 0 && lanes.length > 0
      ? `      <laneSet id="laneSet-1">\n` +
        lanes
          .map((l) => {
            const refs = flowNodeRefsByLane.get(l.id) ?? [];
            return (
              `        <lane id="${escXml(l.id)}" name="${escXml(l.data.label)}">\n` +
              refs.map((r) => `          <flowNodeRef>${escXml(r)}</flowNodeRef>`).join('\n') +
              `\n        </lane>`
            );
          })
          .join('\n') +
        `\n      </laneSet>`
      : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  id="Definitions_FlowStudio" targetNamespace="http://flowstudio.local/bpmn">
  <bpmn:process id="Process_FlowStudio" name="${escXml(title)}" isExecutable="false">
${laneSetXml ? laneSetXml + '\n' : ''}${body.join('\n')}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_FlowStudio">
${di.join('\n')}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}

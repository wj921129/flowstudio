import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as Y from 'yjs';
import {
  DIAGRAM_PRESETS,
  getBorderAnchorWorldPoint,
  resolveNodeWorldBoxes,
  type FlowEdge,
  type FlowNode,
} from '@flowstudio/shared';
import { buildServer } from '../src/server.js';

type Server = Awaited<ReturnType<typeof buildServer>>;

async function rpc(server: Server, method: string, params?: Record<string, unknown>, id = 1) {
  return server.app.inject({
    method: 'POST',
    url: '/mcp',
    payload: { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) },
  });
}

async function callTool(server: Server, name: string, args: Record<string, unknown>) {
  const res = await rpc(server, 'tools/call', { name, arguments: args });
  const body = res.json();
  const text = body.result.content[0].text as string;
  return { isError: Boolean(body.result?.isError), text, data: body.result?.isError ? null : JSON.parse(text) };
}

describe('MCP Resources、circuit-flow auto_layout 与协同修复闭环', () => {
  let tmpDbPath: string;
  let server: Server;

  beforeEach(async () => {
    tmpDbPath = path.join(os.tmpdir(), `flowstudio-circuit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`);
    server = await buildServer({ dbPath: tmpDbPath });
  });

  afterEach(async () => {
    await server.app.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        if (fs.existsSync(tmpDbPath + suffix)) fs.unlinkSync(tmpDbPath + suffix);
      } catch {}
    }
  });

  const newDiagram = async (title = '测试图') => (await callTool(server, 'create_diagram', { title })).data.id as string;

  it('initialize 声明 resources 且 tools/list 严格 9 工具；resources/list & read 返回指南与 13 套模板', async () => {
    const init = (await rpc(server, 'initialize')).json();
    expect(init.result.capabilities.resources).toEqual({});
    expect((await rpc(server, 'tools/list')).json().result.tools.length).toBe(9);

    const listRes = (await rpc(server, 'resources/list')).json();
    expect(listRes.result.resources.length).toBe(1 + DIAGRAM_PRESETS.length);

    const guide = (await rpc(server, 'resources/read', { uri: 'flowstudio://guide/ai-drawing' })).json();
    expect(guide.result.contents[0].text).toContain('circuit-flow');

    const tpl = (await rpc(server, 'resources/read', { uri: 'flowstudio://templates/flowchart-circuit-code' })).json();
    const parsed = JSON.parse(tpl.result.contents[0].text);
    expect(parsed.spec.paradigm).toBe('circuit-flow');

    const missing = await rpc(server, 'resources/read', { uri: 'flowstudio://templates/nope' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe(-32002);
  });

  it('auto_layout 支持 circuit 模式、保留纯直线不被洗成折线并回写 meta', async () => {
    const id = await newDiagram('电路直连');
    await callTool(server, 'scaffold_diagram', {
      diagramId: id,
      spec: DIAGRAM_PRESETS.find((p) => p.id === 'flowchart-circuit-straight')!.spec,
    });
    const layoutRes = await callTool(server, 'auto_layout', { diagramId: id, direction: 'RIGHT', mode: 'circuit' });
    expect(layoutRes.isError, layoutRes.text).toBe(false);
    const view = (await callTool(server, 'get_diagram', { diagramId: id })).data;
    expect(view.orientation).toBe('horizontal');
    expect(view.edgeRouting).toBe('straight');
    expect(view.edges.every((e: any) => e.routingType === 'straight')).toBe(true);
    const s = view.nodes.find((n: any) => n.id === 's');
    const e = view.nodes.find((n: any) => n.id === 'e');
    expect(e.position.x).toBeGreaterThan(s.position.x);
  });

  it('op-executor：add_node 无效 laneId 不写幽灵 parentId、move_to_lane 转局部坐标并扩容、insert_between 先顺推后选桩且跳过 loop', async () => {
    const id = await newDiagram('增量修复');
    await callTool(server, 'scaffold_diagram', {
      diagramId: id,
      spec: DIAGRAM_PRESETS.find((p) => p.id === 'swimlane-vertical-business')!.spec,
    });

    await callTool(server, 'apply_ops', {
      diagramId: id,
      ops: [
        { op: 'add_node', id: 'ghost-float', label: '浮动节点', laneId: 'non-existent-lane' },
        { op: 'add_node', id: 'extra-in-lane', label: '新泳道节点', laneId: 'lane-client' },
        { op: 'connect', source: 's-order', target: 'c-submit', kind: 'loop', label: '回跳' },
      ],
    });
    const ghostParent = await server.writer.readDocument(id, (doc) => doc.getMap<Y.Map<unknown>>('nodes').get('ghost-float')!.get('parentId'));
    expect(ghostParent).toBeUndefined();

    const moveRes = await callTool(server, 'apply_ops', {
      diagramId: id,
      ops: [{ op: 'move_to_lane', nodeId: 'ghost-float', laneId: 'lane-admin' }],
    });
    expect(moveRes.isError, moveRes.text).toBe(false);
    const adminCheck = await server.writer.readDocument(id, (doc) => {
      const m = doc.getMap<Y.Map<unknown>>('nodes').get('ghost-float')!;
      const lane = doc.getMap<Y.Map<unknown>>('nodes').get('lane-admin')!;
      const pos = m.get('position') as { x: number; y: number };
      return { parentId: m.get('parentId'), pos, lw: lane.get('width') as number, lh: lane.get('height') as number };
    });
    expect(adminCheck.parentId).toBe('lane-admin');
    expect(adminCheck.pos.x).toBeGreaterThanOrEqual(40);
    expect(adminCheck.pos.x + 160).toBeLessThanOrEqual(adminCheck.lw);

    const beforeSubmitY = (await callTool(server, 'get_diagram', { diagramId: id })).data.nodes.find((n: any) => n.id === 'c-submit').position.y;
    const insRes = await callTool(server, 'apply_ops', {
      diagramId: id,
      ops: [
        {
          op: 'insert_between',
          source: 's-order',
          target: 'c-result',
          node: { id: 'mid-audit', label: '中途插入' },
        },
      ],
    });
    expect(insRes.isError, insRes.text).toBe(false);
    const afterSubmitY = (await callTool(server, 'get_diagram', { diagramId: id })).data.nodes.find((n: any) => n.id === 'c-submit').position.y;
    expect(afterSubmitY).toBe(beforeSubmitY);
  });

  it('spec-ops：同向重渲染前泳道变高时不叠压下方泳道', async () => {
    const id = await newDiagram('泳道防叠压');
    const swimSpec = DIAGRAM_PRESETS.find((p) => p.id === 'swimlane-cross-department')!.spec;
    await callTool(server, 'scaffold_diagram', { diagramId: id, spec: swimSpec });
    const spec2 = {
      ...swimSpec,
      nodes: [
        ...swimSpec.nodes,
        { id: 'b-ann1', label: '说明1', attachTo: 'node-b1' },
        { id: 'b-ann2', label: '说明2', attachTo: 'node-b1' },
        { id: 'b-ann3', label: '说明3', attachTo: 'node-b1' },
      ],
    };
    await callTool(server, 'scaffold_diagram', { diagramId: id, spec: spec2 });
    const lanes = await server.writer.readDocument(id, (doc) => {
      const list: Array<{ id: string; y: number; h: number }> = [];
      doc.getMap<Y.Map<unknown>>('nodes').forEach((m, lid) => {
        if (m.get('type') === 'lane') list.push({ id: lid, y: (m.get('position') as any).y, h: m.get('height') as number });
      });
      return list.sort((a, b) => a.y - b.y);
    });
    expect(lanes[1].y).toBeGreaterThanOrEqual(lanes[0].y + lanes[0].h);
    expect(lanes[2].y).toBeGreaterThanOrEqual(lanes[1].y + lanes[1].h);
  });

  it('diagram-inspector 产出重叠、越界、逆流与负坐标/断链 4 项新软告警', async () => {
    const id = await newDiagram('软体检');
    await callTool(server, 'apply_ops', {
      diagramId: id,
      ops: [
        { op: 'add_lane', id: 'l1', label: 'L1' },
        { op: 'add_node', id: 'n1', label: '步骤1', laneId: 'l1' },
        { op: 'add_node', id: 'n2', label: '步骤2', laneId: 'l1' },
        { op: 'move_node', id: 'n1', position: { x: 400, y: 50 } },
        { op: 'move_node', id: 'n2', position: { x: 100, y: 55 } },
        { op: 'connect', source: 'n1', target: 'n2' },
        { op: 'add_node', id: 'n3', label: '步骤3' },
        { op: 'add_node', id: 'n4', label: '步骤4' },
        { op: 'move_node', id: 'n3', position: { x: -120, y: 100 } },
        { op: 'move_node', id: 'n4', position: { x: -120, y: 20 } },
        { op: 'connect', source: 'n3', target: 'n4' },
      ],
    });
    const out = await callTool(server, 'apply_ops', {
      diagramId: id,
      ops: [{ op: 'move_node', id: 'n2', position: { x: 900, y: 55 } }],
    });
    expect(out.data.warnings.some((w: string) => w.includes('越界'))).toBe(true);
    expect(out.data.warnings.some((w: string) => w.includes('负坐标'))).toBe(true);
    expect(out.data.warnings.some((w: string) => w.includes('断链'))).toBe(true);

    const outRev = await callTool(server, 'apply_ops', {
      diagramId: id,
      ops: [{ op: 'move_node', id: 'n2', position: { x: 100, y: 55 } }],
    });
    expect(outRev.data.warnings.some((w: string) => w.includes('逆流'))).toBe(true);

    const outOverlap = await callTool(server, 'apply_ops', {
      diagramId: id,
      ops: [{ op: 'move_node', id: 'n2', position: { x: 410, y: 55 } }],
    });
    expect(outOverlap.data.warnings.some((w: string) => w.includes('物理重叠'))).toBe(true);
  });

  it('circuit-flow 执行 scaffold_diagram 后再调用 auto_layout(circuit) 所有带 waypoints 的边保持严格正交', async () => {
    const id = await newDiagram('电路正交回归');
    await callTool(server, 'scaffold_diagram', {
      diagramId: id,
      spec: {
        paradigm: 'circuit-flow',
        orientation: 'vertical',
        edgeRouting: 'orthogonal',
        nodes: [
          { id: 's', label: '开始', type: 'start-end' },
          { id: 'd1', label: '条件1', type: 'decision' },
          { id: 'e1', label: '拦截1', type: 'start-end', earlyExit: true },
          { id: 'd2', label: '条件2', type: 'decision' },
          { id: 'b1', label: '分支A', type: 'process' },
          { id: 'b2', label: '分支B', type: 'process' },
          { id: 'm', label: '汇合落库', type: 'process' },
          { id: 'end', label: '结束', type: 'start-end' },
        ],
        edges: [
          { from: 's', to: 'd1' },
          { from: 'd1', to: 'e1', kind: 'branch', label: '是' },
          { from: 'd1', to: 'd2', kind: 'next', label: '否' },
          { from: 'd2', to: 'b1', kind: 'branch', label: 'A' },
          { from: 'd2', to: 'b2', kind: 'next', label: 'B' },
          { from: 'b1', to: 'm' },
          { from: 'b2', to: 'm' },
          { from: 'm', to: 'end' },
        ],
      },
    });
    const layoutRes = await callTool(server, 'auto_layout', { diagramId: id, mode: 'circuit' });
    expect(layoutRes.isError, layoutRes.text).toBe(false);

    const { nodes, edges } = await server.writer.readDocument(id, (doc) => {
      const nodeList: FlowNode[] = [];
      const edgeList: FlowEdge[] = [];
      doc.getMap<Y.Map<unknown>>('nodes').forEach((m) => nodeList.push(m.toJSON() as FlowNode));
      doc.getMap<Y.Map<unknown>>('edges').forEach((m) => edgeList.push(m.toJSON() as FlowEdge));
      return { nodes: nodeList, edges: edgeList };
    });

    const boxes = resolveNodeWorldBoxes(nodes);
    const wpEdges = edges.filter((e) => Array.isArray(e.data?.waypoints) && e.data.waypoints.length > 0);
    expect(wpEdges.length).toBeGreaterThan(0);

    for (const edge of wpEdges) {
      const sBox = boxes.get(edge.source)!;
      const tBox = boxes.get(edge.target)!;
      const sPt = getBorderAnchorWorldPoint(sBox, edge.sourceHandle, 'bottom', sBox.type);
      const tPt = getBorderAnchorWorldPoint(tBox, edge.targetHandle, 'top', tBox.type);
      const pts = [sPt, ...edge.data!.waypoints!, tPt];
      for (let i = 0; i < pts.length - 1; i++) {
        const dx = Math.abs(pts[i + 1].x - pts[i].x);
        const dy = Math.abs(pts[i + 1].y - pts[i].y);
        expect(dx < 0.5 || dy < 0.5, `${edge.id} seg ${i}: dx=${dx}, dy=${dy}`).toBe(true);
      }
    }
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as Y from 'yjs';
import { DIAGRAM_PRESETS } from '@flowstudio/shared';
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
});

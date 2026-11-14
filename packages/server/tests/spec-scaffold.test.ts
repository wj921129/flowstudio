import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as Y from 'yjs';
import { DIAGRAM_PRESETS } from '@flowstudio/shared';
import { buildServer } from '../src/server.js';

type Server = Awaited<ReturnType<typeof buildServer>>;

async function callTool(server: Server, name: string, args: Record<string, unknown>) {
  const res = await server.app.inject({
    method: 'POST',
    url: '/mcp',
    payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  const text = body.result.content[0].text as string;
  const isError = Boolean(body.result?.isError);
  return { isError, text, data: isError ? null : JSON.parse(text) };
}

const retrySpec = DIAGRAM_PRESETS.find((p) => p.id === 'flowchart-retry-compensation')!.spec;
const swimSpec = DIAGRAM_PRESETS.find((p) => p.id === 'swimlane-cross-department')!.spec;

describe('scaffold_diagram spec 差量渲染', () => {
  let tmpDbPath: string;
  let server: Server;

  beforeEach(async () => {
    tmpDbPath = path.join(os.tmpdir(), `flowstudio-spec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`);
    server = await buildServer({ dbPath: tmpDbPath });
  });

  afterEach(async () => {
    await server.app.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        if (fs.existsSync(tmpDbPath + suffix)) fs.unlinkSync(tmpDbPath + suffix);
      } catch {
        // ignore
      }
    }
  });

  const newDiagram = async () => (await callTool(server, 'create_diagram', { title: 'spec 测试' })).data.id as string;

  it('首渲 spec 产出预设全部节点与连线', async () => {
    const id = await newDiagram();
    const res = await callTool(server, 'scaffold_diagram', { diagramId: id, spec: retrySpec });
    expect(res.isError).toBe(false);
    const view = await callTool(server, 'get_diagram', { diagramId: id });
    expect(view.data.nodes.map((n: any) => n.id).sort()).toEqual(retrySpec.nodes.map((n) => n.id).sort());
    expect(view.data.edges.length).toBe(retrySpec.edges.length);
  });

  it('二渲同 spec 零删除零新增且坐标稳定', async () => {
    const id = await newDiagram();
    await callTool(server, 'scaffold_diagram', { diagramId: id, spec: retrySpec });
    const before = (await callTool(server, 'get_diagram', { diagramId: id })).data;
    await callTool(server, 'scaffold_diagram', { diagramId: id, spec: retrySpec });
    const after = (await callTool(server, 'get_diagram', { diagramId: id })).data;
    expect(after.nodes).toEqual(before.nodes);
    const batches = server.aiBatchManager.getBatches(id);
    const last = batches[0];
    expect(last.diffs.some((d: any) => d.opType === 'delete')).toBe(false);
    expect(last.diffs.some((d: any) => d.opType === 'add')).toBe(false);
  });

  it('人工新增的非锁节点在二渲时被删除（仅锁保护裁定）', async () => {
    const id = await newDiagram();
    await callTool(server, 'scaffold_diagram', { diagramId: id, spec: retrySpec });
    await server.writer.mutate(id, 'test:manual', (doc) => {
      const m = new Y.Map<unknown>();
      m.set('id', 'manual-1');
      m.set('type', 'process');
      m.set('position', { x: 900, y: 900 });
      m.set('width', 160);
      m.set('height', 80);
      m.set('data', { label: '人工新增', type: 'process' });
      doc.getMap('nodes').set('manual-1', m);
    });
    await callTool(server, 'scaffold_diagram', { diagramId: id, spec: retrySpec });
    const view = await callTool(server, 'get_diagram', { diagramId: id });
    expect(view.isError, view.text).toBe(false);
    expect(view.data.nodes.some((n: any) => n.id === 'manual-1')).toBe(false);
  });

  it('full 锁节点及其 lane/pool 祖先链在二渲后保留', async () => {
    const id = await newDiagram();
    await callTool(server, 'scaffold_diagram', { diagramId: id, spec: swimSpec });
    await server.writer.mutate(id, 'test:lock', (doc) => {
      const m = doc.getMap<Y.Map<unknown>>('nodes').get('node-t1')!;
      m.set('data', { ...(m.get('data') as object), lockMode: 'full' });
    });
    const before = (await callTool(server, 'get_diagram', { diagramId: id })).data;
    await callTool(server, 'scaffold_diagram', { diagramId: id, spec: swimSpec });
    const after = (await callTool(server, 'get_diagram', { diagramId: id })).data;
    const lockedBefore = before.nodes.find((n: any) => n.id === 'node-t1');
    const lockedAfter = after.nodes.find((n: any) => n.id === 'node-t1');
    expect(lockedAfter.position).toEqual(lockedBefore.position);
    expect(after.lanes.length).toBe(before.lanes.length);
  });

  it('position 锁节点坐标不动但文案可更新', async () => {
    const id = await newDiagram();
    await callTool(server, 'scaffold_diagram', { diagramId: id, spec: retrySpec });
    await server.writer.mutate(id, 'test:lock', (doc) => {
      const m = doc.getMap<Y.Map<unknown>>('nodes').get('proc-task')!;
      m.set('position', { x: 777, y: 123 });
      m.set('data', { ...(m.get('data') as object), lockMode: 'position' });
    });
    const renamed = { ...retrySpec, nodes: retrySpec.nodes.map((n) => (n.id === 'proc-task' ? { ...n, label: '改名后的调用' } : n)) };
    await callTool(server, 'scaffold_diagram', { diagramId: id, spec: renamed });
    const view = await callTool(server, 'get_diagram', { diagramId: id });
    expect(view.isError, view.text).toBe(false);
    const node = view.data.nodes.find((n: any) => n.id === 'proc-task');
    expect(node.position).toEqual({ x: 777, y: 123 });
    expect(node.label).toBe('改名后的调用');
  });

  it('人工撑开的 lane 宽度二渲后只扩不缩', async () => {
    const id = await newDiagram();
    await callTool(server, 'scaffold_diagram', { diagramId: id, spec: swimSpec });
    await server.writer.mutate(id, 'test:wide', (doc) => {
      const laneId = (doc.getMap<Y.Map<unknown>>('nodes').get('lane-biz') as Y.Map<unknown>).get('id') as string;
      doc.getMap<Y.Map<unknown>>('nodes').get(laneId)!.set('width', 1200);
    });
    await callTool(server, 'scaffold_diagram', { diagramId: id, spec: swimSpec });
    const width = await server.writer.readDocument(id, (doc) => {
      let w = 0;
      doc.getMap<Y.Map<unknown>>('nodes').forEach((m) => {
        if (m.get('type') === 'lane' && (m.get('data') as any).laneTitle === '业务部门') w = m.get('width') as number;
      });
      return w;
    });
    expect(width).toBeGreaterThanOrEqual(1200);
  });

  it('旧 flat 入参被校验拒绝', async () => {
    const id = await newDiagram();
    const res = await callTool(server, 'scaffold_diagram', { diagramId: id, lanes: [], nodes: [{ id: 'a', type: 'process', label: 'A' }], edges: [] });
    expect(res.isError).toBe(true);
  });

  it('人工调整过的 lane 位置与高度二渲后保留（位置仅新建时设定）', async () => {
    const id = await newDiagram();
    await callTool(server, 'scaffold_diagram', { diagramId: id, spec: swimSpec });
    await server.writer.mutate(id, 'test:lane', (doc) => {
      const nodes = doc.getMap<Y.Map<unknown>>('nodes');
      nodes.forEach((m) => {
        const data = m.get('data') as any;
        if (m.get('type') === 'lane' && data.laneTitle === '业务部门') m.set('height', 400);
        if (m.get('type') === 'lane' && data.laneTitle === '技术团队') m.set('position', { x: 0, y: 500 });
      });
    });
    await callTool(server, 'scaffold_diagram', { diagramId: id, spec: swimSpec });
    const frames = await server.writer.readDocument(id, (doc) => {
      const out: Array<{ title: string; y: number; h: number }> = [];
      doc.getMap<Y.Map<unknown>>('nodes').forEach((m) => {
        if (m.get('type') === 'lane') out.push({ title: (m.get('data') as any).laneTitle, y: (m.get('position') as any).y, h: m.get('height') as number });
      });
      return out;
    });
    const biz = frames.find((f) => f.title === '业务部门')!;
    const tech = frames.find((f) => f.title === '技术团队')!;
    expect(biz.h).toBeGreaterThanOrEqual(400);
    expect(tech.y).toBe(500);
  });

  it('泳道内 position 锁节点的世界坐标二渲后零改写', async () => {
    const id = await newDiagram();
    await callTool(server, 'scaffold_diagram', { diagramId: id, spec: swimSpec });
    const before = await server.writer.readDocument(id, (doc) => {
      const m = doc.getMap<Y.Map<unknown>>('nodes').get('node-t1')!;
      m.set('data', { ...(m.get('data') as object), lockMode: 'position' });
      const lane = doc.getMap<Y.Map<unknown>>('nodes').get(m.get('parentId') as string)!;
      return { local: m.get('position'), laneY: (lane.get('position') as any).y };
    });
    await callTool(server, 'scaffold_diagram', { diagramId: id, spec: swimSpec });
    const after = await server.writer.readDocument(id, (doc) => {
      const m = doc.getMap<Y.Map<unknown>>('nodes').get('node-t1')!;
      const lane = doc.getMap<Y.Map<unknown>>('nodes').get(m.get('parentId') as string)!;
      return { local: m.get('position'), laneY: (lane.get('position') as any).y };
    });
    expect(after.local).toEqual(before.local);
    expect(after.laneY).toBe(before.laneY);
  });

  it('tools/list 含 8 个工具且 list_templates 返回 8 个预设', async () => {
    const listRes = await server.app.inject({ method: 'POST', url: '/mcp', payload: { jsonrpc: '2.0', id: 2, method: 'tools/list' } });
    const tools = listRes.json().result.tools;
    expect(tools.length).toBe(14);
    expect(tools.map((t: any) => t.name)).toContain('list_templates');
    const res = await callTool(server, 'list_templates', {});
    expect(res.data.length).toBe(8);
    expect(res.data[0].spec.paradigm).toBeTruthy();
  });
});
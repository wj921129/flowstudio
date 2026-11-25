import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as Y from 'yjs';
import { DIAGRAM_PRESETS, type DiagramSpec } from '@flowstudio/shared';
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

describe('MCP 智能连线锚点分摊与虚线扩展全链路', () => {
  let tmpDbPath: string;
  let server: Server;

  beforeEach(async () => {
    tmpDbPath = path.join(os.tmpdir(), `flowstudio-edge-mcp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`);
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

  const newDiagram = async () => (await callTool(server, 'create_diagram', { title: '连线测试' })).data.id as string;

  it('scaffold_diagram 支持 strokeStyle（含 annotate 默认 dashed）、二渲改回 solid 保留 strokeColor 与锁节点旧边避让', async () => {
    const id = await newDiagram();
    const spec1: DiagramSpec = {
      paradigm: 'tiered-dag',
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ],
      edges: [
        { from: 'a', to: 'b', strokeStyle: 'dashed' },
        { from: 'a', to: 'c', strokeStyle: 'dotted' },
      ],
    };
    const r1 = await callTool(server, 'scaffold_diagram', { diagramId: id, spec: spec1 });
    expect(r1.isError, r1.text).toBe(false);

    const view1 = await callTool(server, 'get_diagram', { diagramId: id });
    const eAB = view1.data.edges.find((e: any) => e.target === 'b');
    const eAC = view1.data.edges.find((e: any) => e.target === 'c');
    expect(eAB.strokeStyle).toBe('dashed');
    expect(eAC.strokeStyle).toBe('dotted');
    expect(eAB.sourceHandle).not.toBe(eAC.sourceHandle);

    await server.writer.mutate(id, 'test:human-color', (doc) => {
      doc.getMap<Y.Map<unknown>>('nodes').get('b')!.set('data', { label: 'B', type: 'process', lockMode: 'full' });
      const edgeMap = doc.getMap<Y.Map<unknown>>('edges').get(eAB.id)!;
      edgeMap.set('sourceHandle', 'bottom@0.5');
      edgeMap.set('data', { ...(edgeMap.get('data') as object), style: { strokeColor: '#ef4444', strokeStyle: 'dashed' } });
    });

    const spec2: DiagramSpec = {
      paradigm: 'tiered-dag',
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
        { id: 'd', label: 'D' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
        { from: 'a', to: 'd' },
      ],
    };
    const r2 = await callTool(server, 'scaffold_diagram', { diagramId: id, spec: spec2 });
    expect(r2.isError, r2.text).toBe(false);

    const view2 = await callTool(server, 'get_diagram', { diagramId: id });
    const afterAB = view2.data.edges.find((e: any) => e.target === 'b');
    const afterAC = view2.data.edges.find((e: any) => e.target === 'c');
    const afterAD = view2.data.edges.find((e: any) => e.target === 'd');
    expect(afterAB.sourceHandle).toBe('bottom@0.5');
    expect(afterAC.strokeStyle).toBeUndefined();
    expect(afterAC.sourceHandle).not.toBe('bottom@0.5');
    expect(afterAD.sourceHandle).not.toBe('bottom@0.5');
    expect(afterAC.sourceHandle).not.toBe(afterAD.sourceHandle);
  });

  it('apply_ops.connect 增量连线自动错开且不动旧边；update_edge 校验越界并支持虚线；insert_between 继承虚线', async () => {
    const id = await newDiagram();
    const setup = await callTool(server, 'apply_ops', {
      diagramId: id,
      ops: [
        { op: 'add_node', id: 's', label: '起点' },
        { op: 'add_node', id: 't1', label: '目标1' },
        { op: 'add_node', id: 't2', label: '目标2' },
        { op: 'add_node', id: 't3', label: '目标3' },
        { op: 'move_node', id: 's', position: { x: 0, y: 200 } },
        { op: 'move_node', id: 't1', position: { x: 300, y: 100 } },
        { op: 'move_node', id: 't2', position: { x: 300, y: 200 } },
        { op: 'move_node', id: 't3', position: { x: 300, y: 300 } },
        { op: 'connect', source: 's', target: 't1', strokeStyle: 'dashed', label: '异步1' },
        { op: 'connect', source: 's', target: 't2', kind: 'annotate', label: '附注' },
        { op: 'connect', source: 's', target: 't3', sourceHandle: 'right@0.85', targetHandle: 'left@0.25' },
      ],
    });
    expect(setup.isError, setup.text).toBe(false);

    const view1 = await callTool(server, 'get_diagram', { diagramId: id });
    const e1 = view1.data.edges.find((e: any) => e.target === 't1');
    const e2 = view1.data.edges.find((e: any) => e.target === 't2');
    const e3 = view1.data.edges.find((e: any) => e.target === 't3');
    expect(e1.sourceHandle).toBe('right');
    expect(e1.strokeStyle).toBe('dashed');
    expect(e2.strokeStyle).toBe('dashed');
    expect(e2.sourceHandle).toMatch(/^right@/);
    expect(e2.sourceHandle).not.toBe(e1.sourceHandle);
    expect(e3.sourceHandle).toBe('right@0.85');
    expect(e3.targetHandle).toBe('left@0.25');

    const search = await callTool(server, 'search_nodes', { diagramId: id, query: '起点' });
    expect(search.data.relatedEdges.find((e: any) => e.id === e1.id).strokeStyle).toBe('dashed');

    const badUpdate = await callTool(server, 'apply_ops', {
      diagramId: id,
      ops: [{ op: 'update_edge', id: e1.id, sourceHandle: 'right@1.5' }],
    });
    expect(badUpdate.isError).toBe(true);

    const insertRes = await callTool(server, 'apply_ops', {
      diagramId: id,
      ops: [
        {
          op: 'insert_between',
          source: 's',
          target: 't1',
          node: { id: 'mid', label: '中间节点' },
          edgeLabel: '延续',
        },
      ],
    });
    expect(insertRes.isError, insertRes.text).toBe(false);
    const view2 = await callTool(server, 'get_diagram', { diagramId: id });
    const midEdges = view2.data.edges.filter((e: any) => e.source === 'mid' || e.target === 'mid');
    expect(midEdges.length).toBe(2);
    expect(midEdges.every((e: any) => e.strokeStyle === 'dashed')).toBe(true);
  });

  it('auto_layout 刷新自动分配端口并保留人工手调 side@offset 与锁定节点，支持 undo_ai_batch 撤回', async () => {
    const id = await newDiagram();
    await callTool(server, 'apply_ops', {
      diagramId: id,
      ops: [
        { op: 'add_node', id: 'a', label: 'A' },
        { op: 'add_node', id: 'b', label: 'B' },
        { op: 'add_node', id: 'c', label: 'C' },
        { op: 'add_node', id: 'd', label: 'D' },
        { op: 'move_node', id: 'a', position: { x: 0, y: 0 } },
        { op: 'move_node', id: 'b', position: { x: 300, y: 0 } },
        { op: 'move_node', id: 'c', position: { x: 0, y: 200 } },
        { op: 'move_node', id: 'd', position: { x: 300, y: 200 } },
        { op: 'connect', source: 'a', target: 'b' },
        { op: 'connect', source: 'c', target: 'd' },
      ],
    });

    const beforeView = await callTool(server, 'get_diagram', { diagramId: id });
    const eAB = beforeView.data.edges.find((e: any) => e.source === 'a' && e.target === 'b');
    const eCD = beforeView.data.edges.find((e: any) => e.source === 'c' && e.target === 'd');
    expect(eCD.sourceHandle).toBe('right');

    await server.writer.mutate(id, 'test:human-drag', (doc) => {
      doc.getMap<Y.Map<unknown>>('edges').get(eAB.id)!.set('sourceHandle', 'right@0.2');
    });

    const layoutRes = await callTool(server, 'auto_layout', { diagramId: id, direction: 'DOWN' });
    expect(layoutRes.isError, layoutRes.text).toBe(false);

    const afterView = await callTool(server, 'get_diagram', { diagramId: id });
    const afterAB = afterView.data.edges.find((e: any) => e.id === eAB.id);
    const afterCD = afterView.data.edges.find((e: any) => e.id === eCD.id);
    expect(afterAB.sourceHandle).toBe('right@0.2');
    expect(afterCD.sourceHandle).toBe('bottom');

    const undoRes = await callTool(server, 'undo_ai_batch', { diagramId: id, batchId: layoutRes.data.batchId });
    expect(undoRes.isError, undoRes.text).toBe(false);
    const revertedView = await callTool(server, 'get_diagram', { diagramId: id });
    expect(revertedView.data.edges.find((e: any) => e.id === eCD.id).sourceHandle).toBe(eCD.sourceHandle);
  });

  it('diagram-inspector 对人为写入的同点重叠连线输出告警', async () => {
    const id = await newDiagram();
    await callTool(server, 'apply_ops', {
      diagramId: id,
      ops: [
        { op: 'add_node', id: 'a', label: '主节点' },
        { op: 'add_node', id: 'b', label: '下游1' },
        { op: 'add_node', id: 'c', label: '下游2' },
        { op: 'connect', source: 'a', target: 'b', sourceHandle: 'right@0.5', targetHandle: 'left' },
        { op: 'connect', source: 'a', target: 'c', sourceHandle: 'right@0.5', targetHandle: 'left' },
      ],
    });

    const addMore = await callTool(server, 'apply_ops', {
      diagramId: id,
      ops: [{ op: 'update_node', id: 'b', label: '下游1-改' }],
    });
    expect(addMore.data.warnings.some((w: string) => w.includes('同点连线重叠'))).toBe(true);
  });

  it('apply_ops 支持 routingType=straight、纵向泳道 add_lane 与 auto_layout tree/纵向池默认 DOWN', async () => {
    const id = await newDiagram();
    const res = await callTool(server, 'apply_ops', {
      diagramId: id,
      ops: [
        { op: 'add_node', id: 'root', label: '入口' },
        { op: 'add_node', id: 'c1', label: '子1' },
        { op: 'add_node', id: 'c2', label: '子2' },
        { op: 'add_node', id: 'db', label: '共享库', type: 'database' },
        { op: 'connect', source: 'root', target: 'c1', routingType: 'straight' },
        { op: 'connect', source: 'root', target: 'c2', routingType: 'orthogonal' },
        { op: 'connect', source: 'c1', target: 'db', routingType: 'straight' },
        { op: 'connect', source: 'c2', target: 'db', routingType: 'straight' },
      ],
    });
    expect(res.isError, res.text).toBe(false);

    const view1 = await callTool(server, 'get_diagram', { diagramId: id });
    const eRootC2 = view1.data.edges.find((e: any) => e.source === 'root' && e.target === 'c2');
    expect(eRootC2.routingType).toBe('orthogonal');

    const up = await callTool(server, 'apply_ops', {
      diagramId: id,
      ops: [{ op: 'update_edge', id: eRootC2.id, routingType: 'straight' }],
    });
    expect(up.isError, up.text).toBe(false);

    const treeLayout = await callTool(server, 'auto_layout', { diagramId: id, mode: 'tree' });
    expect(treeLayout.isError, treeLayout.text).toBe(false);
    const afterTree = await callTool(server, 'get_diagram', { diagramId: id });
    const rootNode = afterTree.data.nodes.find((n: any) => n.id === 'root');
    const c1Node = afterTree.data.nodes.find((n: any) => n.id === 'c1');
    const dbNode = afterTree.data.nodes.find((n: any) => n.id === 'db');
    expect(c1Node.position.y).toBeGreaterThan(rootNode.position.y);
    expect(dbNode.position.y).toBeGreaterThan(c1Node.position.y);
    expect(afterTree.data.edges.every((e: any) => e.routingType === 'straight')).toBe(true);

    const vertId = await newDiagram();
    const vertSpec = DIAGRAM_PRESETS.find((p) => p.id === 'swimlane-vertical-business')!.spec;
    await callTool(server, 'scaffold_diagram', { diagramId: vertId, spec: vertSpec });
    const addLaneRes = await callTool(server, 'apply_ops', {
      diagramId: vertId,
      ops: [{ op: 'add_lane', id: 'lane-extra', label: '外部渠道', poolId: 'pool' }],
    });
    expect(addLaneRes.isError, addLaneRes.text).toBe(false);
    const vertLayout = await callTool(server, 'auto_layout', { diagramId: vertId });
    expect(vertLayout.isError, vertLayout.text).toBe(false);

    const extraPos = await server.writer.readDocument(vertId, (doc) => {
      const m = doc.getMap<Y.Map<unknown>>('nodes').get('lane-extra')!;
      return m.get('position') as { x: number; y: number };
    });
    expect(extraPos.y).toBe(40);
    expect(extraPos.x).toBeGreaterThan(0);
  });
});

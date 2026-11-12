import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { DIAGRAM_PRESETS } from '@flowstudio/shared';
import { buildServer } from '../src/server.js';

type Server = Awaited<ReturnType<typeof buildServer>>;

async function callTool(server: Server, name: string, args: Record<string, unknown>) {
  const res = await server.app.inject({
    method: 'POST',
    url: '/mcp',
    payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  });
  const body = res.json();
  const text = body.result.content[0].text as string;
  const isError = Boolean(body.result?.isError);
  return { isError, text, data: isError ? null : JSON.parse(text) };
}

const retrySpec = DIAGRAM_PRESETS.find((p) => p.id === 'flowchart-retry-compensation')!.spec;

describe('apply_ops 语义化与 get_diagram 语义读回', () => {
  let tmpDbPath: string;
  let server: Server;

  beforeEach(async () => {
    tmpDbPath = path.join(os.tmpdir(), `flowstudio-sem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`);
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

  const seeded = async () => {
    const id = (await callTool(server, 'create_diagram', { title: '语义闭环' })).data.id as string;
    await callTool(server, 'scaffold_diagram', { diagramId: id, spec: retrySpec });
    return id;
  };

  it('connect kind=loop 写入并读回', async () => {
    const id = await seeded();
    const res = await callTool(server, 'apply_ops', {
      diagramId: id,
      ops: [{ op: 'connect', source: 'proc-alarm', target: 'proc-task', kind: 'loop', label: '补偿重试' }],
    });
    expect(res.isError, res.text).toBe(false);
    const view = (await callTool(server, 'get_diagram', { diagramId: id })).data;
    const edge = view.edges.find((e: any) => e.source === 'proc-alarm' && e.target === 'proc-task');
    expect(edge.kind).toBe('loop');
  });

  it('add_node role=annotation + attachTo 写入并读回', async () => {
    const id = await seeded();
    const res = await callTool(server, 'apply_ops', {
      diagramId: id,
      ops: [{ op: 'add_node', id: 'note-1', label: '补充说明', role: 'annotation', attachTo: 'proc-task' }],
    });
    expect(res.isError, res.text).toBe(false);
    const view = (await callTool(server, 'get_diagram', { diagramId: id })).data;
    const node = view.nodes.find((n: any) => n.id === 'note-1');
    expect(node.role).toBe('annotation');
    expect(node.attachTo).toBe('proc-task');
  });

  it('scaffold 后读回 paradigm 与 mainOrder', async () => {
    const id = await seeded();
    const view = (await callTool(server, 'get_diagram', { diagramId: id })).data;
    expect(view.paradigm).toBe('vertical-flow');
    expect(view.mainOrder).toEqual(['start-2', 'proc-task', 'dec-status', 'end-success']);
  });

  it('scaffold 渲染的边读回 kind 与连接桩语义一致', async () => {
    const id = await seeded();
    const view = (await callTool(server, 'get_diagram', { diagramId: id })).data;
    const loop = view.edges.find((e: any) => e.source === 'dec-retry' && e.target === 'proc-task');
    expect(loop.kind).toBe('loop');
    const branch = view.edges.find((e: any) => e.source === 'dec-status' && e.target === 'dec-retry');
    expect(branch.kind).toBe('branch');
  });

  it('update_node 改文案不丢 role/attachTo', async () => {
    const id = await seeded();
    await callTool(server, 'apply_ops', {
      diagramId: id,
      ops: [{ op: 'add_node', id: 'note-1', label: '补充说明', role: 'annotation', attachTo: 'proc-task' }],
    });
    await callTool(server, 'apply_ops', { diagramId: id, ops: [{ op: 'update_node', id: 'note-1', label: '改名说明' }] });
    const view = (await callTool(server, 'get_diagram', { diagramId: id })).data;
    const node = view.nodes.find((n: any) => n.id === 'note-1');
    expect(node.label).toBe('改名说明');
    expect(node.role).toBe('annotation');
    expect(node.attachTo).toBe('proc-task');
  });
});
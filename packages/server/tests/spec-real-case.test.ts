import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as Y from 'yjs';
import type { FlowNode } from '@flowstudio/shared';
import { buildServer } from '../src/server.js';
import { buildSvnSpec, noOverlap } from '../../shared/tests/helpers/render-asserts.js';

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

describe('真实案例闭环：SVN 时间线 15 步 + 25 附注', () => {
  let tmpDbPath: string;
  let server: Server;

  beforeEach(async () => {
    tmpDbPath = path.join(os.tmpdir(), `flowstudio-svn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`);
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

  const fullNodes = (id: string) => server.writer.readDocument(id, (doc) => {
    const nodes: FlowNode[] = [];
    doc.getMap<Y.Map<unknown>>('nodes').forEach((m) => nodes.push({
      id: m.get('id') as string,
      type: m.get('type') as FlowNode['type'],
      position: m.get('position') as FlowNode['position'],
      width: m.get('width') as number,
      height: m.get('height') as number,
      data: m.get('data') as FlowNode['data'],
    }));
    return nodes;
  });

  it('相连主干净距恒 50、附注折列、全图无重叠', async () => {
    const id = (await callTool(server, 'create_diagram', { title: 'SVN 回归' })).data.id as string;
    const res = await callTool(server, 'scaffold_diagram', { diagramId: id, spec: buildSvnSpec() });
    expect(res.isError, res.text).toBe(false);
    const nodes = await fullNodes(id);
    expect(nodes.length).toBe(40);
    for (let i = 1; i <= 14; i++) {
      const a = nodes.find((n) => n.id === `t${i}`)!;
      const b = nodes.find((n) => n.id === `t${i + 1}`)!;
      expect(b.position.y - (a.position.y + a.height!)).toBe(50);
    }
    const t1Anns = nodes.filter((n) => n.data!.attachTo === 't1');
    expect(new Set(t1Anns.map((n) => n.position.x)).size).toBe(2);
    expect(noOverlap(nodes)).toBe(true);
    const bottom = Math.max(...nodes.map((n) => n.position.y + n.height!));
    expect(bottom).toBeLessThan(4000);
  });

  it('二渲同 spec 零删除零新增', async () => {
    const id = (await callTool(server, 'create_diagram', { title: 'SVN 二渲' })).data.id as string;
    await callTool(server, 'scaffold_diagram', { diagramId: id, spec: buildSvnSpec() });
    await callTool(server, 'scaffold_diagram', { diagramId: id, spec: buildSvnSpec() });
    const last = server.aiBatchManager.getBatches(id)[0];
    expect(last.diffs.some((d) => d.opType === 'delete')).toBe(false);
    expect(last.diffs.some((d) => d.opType === 'add')).toBe(false);
  });
});
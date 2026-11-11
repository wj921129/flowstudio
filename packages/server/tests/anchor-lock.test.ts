import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as Y from 'yjs';
import { buildServer } from '../src/server.js';

type Server = Awaited<ReturnType<typeof buildServer>>;

interface CompactDiagram {
  nodes: Array<{
    id: string;
    label: string;
    position: { x: number; y: number };
    lockMode?: string;
  }>;
  edges: Array<{ id: string; source: string; target: string; label?: string }>;
}

async function callTool(server: Server, id: number, name: string, args: Record<string, unknown>) {
  const res = await server.app.inject({
    method: 'POST',
    url: '/mcp',
    payload: {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args },
    },
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.json().result.content[0].text);
}

function seedDiagram(
  server: Server,
  title: string,
  nodes: Array<{ id: string; label: string; position: { x: number; y: number }; lockMode?: string }>,
  edges: Array<{ id: string; source: string; target: string }> = [],
): string {
  const diag = server.repo.createDiagram({ title });
  const doc = new Y.Doc();
  for (const node of nodes) {
    const nodeMap = new Y.Map<unknown>();
    nodeMap.set('id', node.id);
    nodeMap.set('type', 'process');
    nodeMap.set('position', node.position);
    nodeMap.set('width', 160);
    nodeMap.set('height', 80);
    nodeMap.set('data', {
      label: node.label,
      type: 'process',
      ...(node.lockMode ? { lockMode: node.lockMode } : {}),
    });
    doc.getMap('nodes').set(node.id, nodeMap);
  }
  for (const edge of edges) {
    const edgeMap = new Y.Map<unknown>();
    edgeMap.set('id', edge.id);
    edgeMap.set('source', edge.source);
    edgeMap.set('target', edge.target);
    edgeMap.set('data', {});
    doc.getMap('edges').set(edge.id, edgeMap);
  }
  server.repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc));
  return diag.id;
}

describe('节点锚定锁与 MCP 增强操作', () => {
  let tmpDbPath: string;

  beforeEach(() => {
    tmpDbPath = path.join(os.tmpdir(), `flowstudio-lock-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`);
  });

  afterEach(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        if (fs.existsSync(tmpDbPath + suffix)) {
          fs.unlinkSync(tmpDbPath + suffix);
        }
      } catch {
        // ignore
      }
    }
  });

  it('full 锁阻止修改与删除，position 锁阻止移动但允许改文案', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diagramId = seedDiagram(server, '锚定锁保护图', [
      { id: 'locked-full', label: '全锁节点', position: { x: 10, y: 10 }, lockMode: 'full' },
      { id: 'locked-pos', label: '锁坐标节点', position: { x: 50, y: 50 }, lockMode: 'position' },
      { id: 'free-node', label: '自由节点', position: { x: 0, y: 0 } },
    ]);

    const applied = await callTool(server, 1, 'apply_ops', {
      diagramId,
      ops: [
        { op: 'update_node', id: 'locked-full', label: 'AI 尝试篡改' },
        { op: 'delete_node', id: 'locked-full' },
        { op: 'move_node', id: 'locked-pos', position: { x: 999, y: 999 } },
        { op: 'update_node', id: 'locked-pos', label: '允许修改的文案' },
        { op: 'move_node', id: 'free-node', position: { x: 400, y: 400 } },
      ],
    });

    expect(applied.success).toBe(true);
    expect(applied.appliedCount).toBe(2);
    expect(applied.warnings.length).toBe(3);
    expect(applied.warnings.some((w: string) => w.includes('完全锁定'))).toBe(true);
    expect(applied.warnings.some((w: string) => w.includes('锁定坐标'))).toBe(true);

    const diagram = (await callTool(server, 2, 'get_diagram', { diagramId })) as CompactDiagram;
    const byId = new Map(diagram.nodes.map((n) => [n.id, n]));

    // full 锁：文案与存在性均保持原样
    expect(byId.get('locked-full')?.label).toBe('全锁节点');
    expect(byId.get('locked-full')?.lockMode).toBe('full');

    // position 锁：坐标不动，文案允许更新
    expect(byId.get('locked-pos')?.position).toEqual({ x: 50, y: 50 });
    expect(byId.get('locked-pos')?.label).toBe('允许修改的文案');

    // 自由节点正常移动
    expect(byId.get('free-node')?.position).toEqual({ x: 400, y: 400 });

    await server.app.close();
  });

  it('auto_layout 跳过全部锁定节点并给出中文告警', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diagramId = seedDiagram(
      server,
      '自动排版锁保护图',
      [
        { id: 'pos-locked', label: '锁坐标', position: { x: 777, y: 123 }, lockMode: 'position' },
        { id: 'full-locked', label: '全锁', position: { x: 5, y: 5 }, lockMode: 'full' },
        { id: 'free-a', label: '自由A', position: { x: 0, y: 0 } },
        { id: 'free-b', label: '自由B', position: { x: 100, y: 0 } },
      ],
      [{ id: 'e-free', source: 'free-a', target: 'free-b' }],
    );

    const result = await callTool(server, 1, 'auto_layout', { diagramId, direction: 'RIGHT' });
    expect(result.success).toBe(true);
    expect(result.warnings.length).toBe(2);
    expect(result.warnings.every((w: string) => w.includes('已锁定坐标，排版保持原位'))).toBe(true);

    const diagram = (await callTool(server, 2, 'get_diagram', { diagramId })) as CompactDiagram;
    const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
    expect(byId.get('pos-locked')?.position).toEqual({ x: 777, y: 123 });
    expect(byId.get('full-locked')?.position).toEqual({ x: 5, y: 5 });

    await server.app.close();
  });

  it('insert_between 断线串接与 update_edge 标签更新可用', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diagramId = seedDiagram(
      server,
      '断线串接图',
      [
        { id: 'node-a', label: '节点A', position: { x: 0, y: 0 } },
        { id: 'node-c', label: '节点C', position: { x: 300, y: 0 } },
      ],
      [{ id: 'edge-ac', source: 'node-a', target: 'node-c' }],
    );

    const applied = await callTool(server, 1, 'apply_ops', {
      diagramId,
      ops: [
        {
          op: 'insert_between',
          source: 'node-a',
          target: 'node-c',
          node: { id: 'node-b', type: 'process', label: '插入节点B' },
        },
      ],
    });
    expect(applied.success).toBe(true);
    expect(applied.appliedCount).toBe(1);

    let diagram = (await callTool(server, 2, 'get_diagram', { diagramId })) as CompactDiagram;
    expect(diagram.nodes.map((n) => n.id).sort()).toEqual(['node-a', 'node-b', 'node-c']);
    expect(diagram.edges.length).toBe(2);
    expect(diagram.edges.some((e) => e.source === 'node-a' && e.target === 'node-b')).toBe(true);
    expect(diagram.edges.some((e) => e.source === 'node-b' && e.target === 'node-c')).toBe(true);

    const edgeAB = diagram.edges.find((e) => e.source === 'node-a' && e.target === 'node-b')!;
    const updated = await callTool(server, 3, 'apply_ops', {
      diagramId,
      ops: [{ op: 'update_edge', id: edgeAB.id, label: '串接后标签' }],
    });
    expect(updated.success).toBe(true);

    diagram = (await callTool(server, 4, 'get_diagram', { diagramId })) as CompactDiagram;
    expect(diagram.edges.find((e) => e.id === edgeAB.id)?.label).toBe('串接后标签');

    await server.app.close();
  });
});

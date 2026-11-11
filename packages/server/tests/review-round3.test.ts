import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as Y from 'yjs';
import { DiagramRepository } from '../src/db/diagram-repository.js';
import { buildServer } from '../src/server.js';

type Server = Awaited<ReturnType<typeof buildServer>>;

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

function loadDoc(repo: DiagramRepository, diagramId: string): Y.Doc {
  const state = repo.getYDocState(diagramId);
  if (!state) throw new Error('文档状态不存在');
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc;
}

function makeNode(
  id: string,
  label: string,
  position: { x: number; y: number },
  extra: {
    type?: string;
    parentId?: string;
    width?: number;
    height?: number;
    lockMode?: string;
    data?: Record<string, unknown>;
  } = {},
): Y.Map<unknown> {
  const nodeMap = new Y.Map<unknown>();
  nodeMap.set('id', id);
  nodeMap.set('type', extra.type ?? 'process');
  nodeMap.set('position', position);
  nodeMap.set('width', extra.width ?? 160);
  nodeMap.set('height', extra.height ?? 80);
  if (extra.parentId) {
    nodeMap.set('parentId', extra.parentId);
    nodeMap.set('extent', 'parent');
  }
  nodeMap.set('data', {
    label,
    type: extra.type ?? 'process',
    ...(extra.lockMode ? { lockMode: extra.lockMode } : {}),
    ...(extra.data ?? {}),
  });
  return nodeMap;
}

function makeEdge(id: string, source: string, target: string, label?: string): Y.Map<unknown> {
  const edgeMap = new Y.Map<unknown>();
  edgeMap.set('id', id);
  edgeMap.set('source', source);
  edgeMap.set('target', target);
  edgeMap.set('data', label ? { label } : {});
  return edgeMap;
}

function worldOf(nodes: Y.Map<Y.Map<unknown>>, id: string): { x: number; y: number } {
  const world = { x: 0, y: 0 };
  let current = nodes.get(id);
  const visited = new Set<string>();
  while (current) {
    const currentId = current.get('id') as string;
    if (visited.has(currentId)) break;
    visited.add(currentId);
    const pos = (current.get('position') as { x: number; y: number } | undefined) ?? { x: 0, y: 0 };
    world.x += pos.x;
    world.y += pos.y;
    const parentId = current.get('parentId') as string | undefined;
    if (typeof parentId !== 'string') break;
    current = nodes.get(parentId);
  }
  return world;
}

function expectNoDanglingParent(nodes: Y.Map<Y.Map<unknown>>): void {
  nodes.forEach((nodeMap, id) => {
    const parentId = nodeMap.get('parentId');
    if (typeof parentId !== 'string') return;
    expect(nodes.has(parentId), `节点 ${id} 的父容器 ${parentId} 不存在`).toBe(true);
  });
}

describe('后端审查整改第三轮', () => {
  let tmpDbPath: string;

  beforeEach(() => {
    tmpDbPath = path.join(
      os.tmpdir(),
      `flowstudio-review3-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`,
    );
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

  it('S1: scaffold 保留锁定节点的祖先容器链，锁定节点本体与世界坐标零改写', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diag = server.repo.createDiagram({ title: '锁定子节点悬挂图' });

    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    nodes.set(
      'pool-1',
      makeNode('pool-1', '旧泳池', { x: 50, y: 50 }, {
        type: 'pool',
        width: 400,
        height: 240,
        data: { orientation: 'horizontal', headerSize: 40, laneOrder: ['lane-old'] },
      }),
    );
    nodes.set(
      'lane-old',
      makeNode('lane-old', '旧泳道', { x: 0, y: 40 }, {
        type: 'lane',
        parentId: 'pool-1',
        width: 400,
        height: 200,
      }),
    );
    nodes.set(
      'locked-node',
      makeNode('locked-node', '锁定节点', { x: 60, y: 60 }, {
        parentId: 'lane-old',
        lockMode: 'full',
      }),
    );
    server.repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc));

    const result = await callTool(server, 1, 'scaffold_diagram', {
      diagramId: diag.id,
      lanes: [{ id: 'lane-new', label: '新泳道' }],
      nodes: [{ id: 'n-new', type: 'process', label: '新节点', laneId: 'lane-new' }],
      edges: [],
    });
    expect(result.success).toBe(true);
    expect(result.warnings.some((w: string) => w.includes('已一并保留'))).toBe(true);
    expect(result.warnings.some((w: string) => w.includes('下移至'))).toBe(true);

    const reloaded = loadDoc(server.repo, diag.id);
    const nextNodes = reloaded.getMap<Y.Map<unknown>>('nodes');

    // 祖先容器链被保留，锁定节点原样留在原泳道
    expect(nextNodes.has('pool-1')).toBe(true);
    expect(nextNodes.has('lane-old')).toBe(true);
    const locked = nextNodes.get('locked-node')!;
    expect(locked.get('parentId')).toBe('lane-old');
    expect(locked.get('position')).toEqual({ x: 60, y: 60 });
    expect(worldOf(nextNodes, 'locked-node')).toEqual({ x: 110, y: 150 });
    expectNoDanglingParent(nextNodes);

    // 新骨架与旧容器共存，新池下移避让
    expect(nextNodes.has('n-new')).toBe(true);
    expect(nextNodes.get('n-new')!.get('parentId')).toBe('lane-new');
    const pools: Array<{ id: string; pos: { x: number; y: number } }> = [];
    nextNodes.forEach((nodeMap, id) => {
      if (nodeMap.get('type') === 'pool') {
        pools.push({ id, pos: nodeMap.get('position') as { x: number; y: number } });
      }
    });
    expect(pools.length).toBe(2);
    const newPool = pools.find((pool) => pool.id !== 'pool-1')!;
    expect(newPool.pos.y).toBeGreaterThanOrEqual(340);

    await server.app.close();
  }, 20000);

  it('R2: scaffold 输入边引用锁定/不存在节点时不崩溃，布局阶段忽略并告警', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diag = server.repo.createDiagram({ title: 'ELK 缺端点图' });

    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    nodes.set('locked-a', makeNode('locked-a', '锁定节点', { x: 10, y: 10 }, { lockMode: 'full' }));
    nodes.set('free-node', makeNode('free-node', '自由节点', { x: 100, y: 200 }));
    doc.getMap<Y.Map<unknown>>('edges').set('edge-old', makeEdge('edge-old', 'free-node', 'locked-a'));
    server.repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc));

    const result = await callTool(server, 1, 'scaffold_diagram', {
      diagramId: diag.id,
      nodes: [{ id: 'n-new', type: 'process', label: '新节点' }],
      edges: [
        { source: 'n-new', target: 'locked-a' },
        { source: 'n-new', target: 'ghost-node' },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.warnings.some((w: string) => w.includes('布局阶段忽略'))).toBe(true);

    const reloaded = loadDoc(server.repo, diag.id);
    const nextNodes = reloaded.getMap<Y.Map<unknown>>('nodes');
    const nextEdges = reloaded.getMap<Y.Map<unknown>>('edges');

    // 锁定节点被保留，因此指向它的边仍可创建；不存在端点的边必须跳过
    expect(nextNodes.has('locked-a')).toBe(true);
    expect(nextNodes.has('n-new')).toBe(true);
    expect(nextNodes.has('free-node')).toBe(false);

    const edgeList: Array<{ source?: string; target?: string }> = [];
    nextEdges.forEach((edgeMap) => {
      edgeList.push({
        source: edgeMap.get('source') as string | undefined,
        target: edgeMap.get('target') as string | undefined,
      });
    });
    expect(
      edgeList.some((edge) => edge.source === 'n-new' && edge.target === 'locked-a'),
    ).toBe(true);
    expect(edgeList.some((edge) => edge.source === 'ghost-node' || edge.target === 'ghost-node')).toBe(false);

    await server.app.close();
  }, 20000);

  it('R3: insert_between 撑开泳道后按 laneOrder 重排兄弟泳道，避免重叠', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diag = server.repo.createDiagram({ title: '泳道重排图' });

    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    nodes.set(
      'pool-1',
      makeNode('pool-1', '泳池', { x: 50, y: 50 }, {
        type: 'pool',
        width: 400,
        height: 440,
        data: { orientation: 'horizontal', headerSize: 40, laneOrder: ['lane-a', 'lane-b'] },
      }),
    );
    nodes.set(
      'lane-a',
      makeNode('lane-a', '泳道A', { x: 0, y: 40 }, {
        type: 'lane',
        parentId: 'pool-1',
        width: 400,
        height: 200,
      }),
    );
    nodes.set(
      'lane-b',
      makeNode('lane-b', '泳道B', { x: 0, y: 240 }, {
        type: 'lane',
        parentId: 'pool-1',
        width: 400,
        height: 200,
      }),
    );
    nodes.set('node-a', makeNode('node-a', '节点A', { x: 40, y: 40 }, { parentId: 'lane-a' }));
    nodes.set('node-c', makeNode('node-c', '节点C', { x: 40, y: 40 }, { parentId: 'lane-a' }));
    doc.getMap<Y.Map<unknown>>('edges').set('edge-ac', makeEdge('edge-ac', 'node-a', 'node-c'));
    server.repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc));

    const applied = await callTool(server, 1, 'apply_ops', {
      diagramId: diag.id,
      ops: [
        {
          op: 'insert_between',
          source: 'node-a',
          target: 'node-c',
          direction: 'DOWN',
          node: { id: 'node-insert', type: 'process', label: '插入节点' },
        },
      ],
    });
    expect(applied.success).toBe(true);

    const reloaded = loadDoc(server.repo, diag.id);
    const nextNodes = reloaded.getMap<Y.Map<unknown>>('nodes');
    const laneA = nextNodes.get('lane-a')!;
    const laneB = nextNodes.get('lane-b')!;
    const pool = nextNodes.get('pool-1')!;

    const laneAPos = laneA.get('position') as { x: number; y: number };
    const laneAHeight = laneA.get('height') as number;
    const laneBPos = laneB.get('position') as { x: number; y: number };
    const laneBHeight = laneB.get('height') as number;
    const poolHeight = pool.get('height') as number;

    // 泳道 A 被撑高后，泳道 B 必须顺延到 A 的下方，不能与 A 重叠
    expect(laneAHeight).toBe(440);
    expect(laneBPos.y).toBe(laneAPos.y + laneAHeight);
    expect(poolHeight).toBe(laneAPos.y + laneAHeight + laneBHeight);

    // 重排必须记账本，撤回时才能恢复兄弟泳道位置
    const batch = server.repo.getAiBatch(diag.id, applied.batchId)!;
    expect(
      batch.diffs.some(
        (diff) => diff.entityId === 'lane-b' && diff.opType === 'update' && diff.afterState,
      ),
    ).toBe(true);

    await server.app.close();
  }, 20000);

  it('R4: insert_between 跨泳道插入与顺推按世界坐标换算，落点不使用源泳道局部坐标', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diag = server.repo.createDiagram({ title: '跨泳道顺推图' });

    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    nodes.set(
      'pool-1',
      makeNode('pool-1', '泳池', { x: 50, y: 50 }, {
        type: 'pool',
        width: 400,
        height: 440,
        data: { orientation: 'horizontal', headerSize: 40, laneOrder: ['lane-a', 'lane-b'] },
      }),
    );
    nodes.set(
      'lane-a',
      makeNode('lane-a', '泳道A', { x: 0, y: 40 }, {
        type: 'lane',
        parentId: 'pool-1',
        width: 400,
        height: 200,
      }),
    );
    nodes.set(
      'lane-b',
      makeNode('lane-b', '泳道B', { x: 0, y: 240 }, {
        type: 'lane',
        parentId: 'pool-1',
        width: 400,
        height: 200,
      }),
    );
    nodes.set('node-a', makeNode('node-a', '源节点', { x: 40, y: 40 }, { parentId: 'lane-a' }));
    nodes.set('node-b', makeNode('node-b', '目标节点', { x: 40, y: 40 }, { parentId: 'lane-b' }));
    nodes.set('node-d', makeNode('node-d', '下游节点', { x: 40, y: 120 }, { parentId: 'lane-a' }));
    const edges = doc.getMap<Y.Map<unknown>>('edges');
    edges.set('edge-ab', makeEdge('edge-ab', 'node-a', 'node-b'));
    edges.set('edge-bd', makeEdge('edge-bd', 'node-b', 'node-d'));
    server.repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc));

    const applied = await callTool(server, 1, 'apply_ops', {
      diagramId: diag.id,
      ops: [
        {
          op: 'insert_between',
          source: 'node-a',
          target: 'node-b',
          direction: 'RIGHT',
          node: { id: 'node-insert', type: 'process', label: '跨泳道节点', laneId: 'lane-b' },
        },
      ],
    });
    expect(applied.success).toBe(true);

    const reloaded = loadDoc(server.repo, diag.id);
    const nextNodes = reloaded.getMap<Y.Map<unknown>>('nodes');

    const inserted = nextNodes.get('node-insert')!;
    expect(inserted.get('parentId')).toBe('lane-b');
    // 目标泳道原点为 (50, 50+280)（lane-a 因内容+内边距撑到 240），
    // 源节点世界坐标 (90,130) → 落点世界 (310,130)，局部 y 收敛到内边距 40
    expect(inserted.get('position')).toEqual({ x: 260, y: 40 });
    expect(worldOf(nextNodes, 'node-insert')).toEqual({ x: 310, y: 370 });

    // 下游顺推量按世界坐标计算：位移 440，再换算回各自泳道局部坐标
    expect(nextNodes.get('node-b')!.get('position')).toEqual({ x: 480, y: 40 });
    expect(nextNodes.get('node-d')!.get('position')).toEqual({ x: 480, y: 120 });
    expect(worldOf(nextNodes, 'node-b')).toEqual({ x: 530, y: 370 });
    expect(worldOf(nextNodes, 'node-d')).toEqual({ x: 530, y: 210 });

    await server.app.close();
  }, 20000);
});

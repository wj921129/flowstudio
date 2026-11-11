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

function makeEdge(id: string, source: string, target: string): Y.Map<unknown> {
  const edgeMap = new Y.Map<unknown>();
  edgeMap.set('id', id);
  edgeMap.set('source', source);
  edgeMap.set('target', target);
  edgeMap.set('data', {});
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
  nodes.forEach((map, id) => {
    const parentId = map.get('parentId');
    if (typeof parentId === 'string') {
      expect(nodes.has(parentId), `节点 ${id} 悬挂父容器 ${parentId}`).toBe(true);
    }
  });
}

function seedPool(
  repo: DiagramRepository,
  diagramId: string,
  options: {
    laneAHeight?: number;
    laneBHeight?: number;
    laneBY?: number;
    poolHeight?: number;
    laneALock?: string;
    laneBLock?: string;
    laneBLockedChild?: boolean;
  } = {},
): void {
  const doc = new Y.Doc();
  const nodes = doc.getMap<Y.Map<unknown>>('nodes');
  const laneBHeight = options.laneBHeight ?? 200;
  const laneBY = options.laneBY ?? 240;
  nodes.set(
    'pool-1',
    makeNode('pool-1', '泳池', { x: 50, y: 50 }, {
      type: 'pool',
      width: 400,
      height: options.poolHeight ?? Math.max(440, laneBY + laneBHeight),
      data: { orientation: 'horizontal', headerSize: 40, laneOrder: ['lane-a', 'lane-b'] },
    }),
  );
  nodes.set(
    'lane-a',
    makeNode('lane-a', '泳道A', { x: 0, y: 40 }, {
      type: 'lane',
      parentId: 'pool-1',
      width: 400,
      height: options.laneAHeight ?? 200,
      lockMode: options.laneALock,
    }),
  );
  nodes.set(
    'lane-b',
    makeNode('lane-b', '泳道B', { x: 0, y: laneBY }, {
      type: 'lane',
      parentId: 'pool-1',
      width: 400,
      height: laneBHeight,
      lockMode: options.laneBLock,
    }),
  );
  nodes.set('node-a', makeNode('node-a', '节点A', { x: 40, y: 40 }, { parentId: 'lane-a' }));
  nodes.set('node-c', makeNode('node-c', '节点C', { x: 40, y: 40 }, { parentId: 'lane-a' }));
  doc.getMap<Y.Map<unknown>>('edges').set('edge-ac', makeEdge('edge-ac', 'node-a', 'node-c'));
  if (options.laneBLockedChild) {
    nodes.set(
      'node-locked',
      makeNode('node-locked', '锁定节点', { x: 40, y: 40 }, {
        parentId: 'lane-b',
        lockMode: 'full',
      }),
    );
  }
  repo.saveYDocState(diagramId, Y.encodeStateAsUpdate(doc));
}

function seedNested(
  repo: DiagramRepository,
  diagramId: string,
  mode: 'locked-inner' | 'locked-group',
): void {
  const doc = new Y.Doc();
  const nodes = doc.getMap<Y.Map<unknown>>('nodes');
  nodes.set(
    'pool-1',
    makeNode('pool-1', '泳池', { x: 50, y: 50 }, {
      type: 'pool',
      width: 400,
      height: 940,
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
  nodes.set(
    'group-1',
    makeNode('group-1', '分组', { x: 20, y: 20 }, {
      type: 'group',
      parentId: 'lane-b',
      width: 300,
      height: 150,
      lockMode: mode === 'locked-group' ? 'full' : undefined,
    }),
  );
  nodes.set(
    'inner-node',
    makeNode('inner-node', '内部节点', { x: 30, y: 30 }, {
      parentId: 'group-1',
      lockMode: mode === 'locked-inner' ? 'full' : undefined,
    }),
  );
  repo.saveYDocState(diagramId, Y.encodeStateAsUpdate(doc));
}

describe('后端审查整改第四轮·锚定锁容器语义', () => {
  let tmpDbPath: string;

  beforeEach(() => {
    tmpDbPath = path.join(
      os.tmpdir(),
      `flowstudio-review4-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`,
    );
  });

  afterEach(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        if (fs.existsSync(tmpDbPath + suffix)) fs.unlinkSync(tmpDbPath + suffix);
      } catch {
        // ignore
      }
    }
  });

  it('S2: auto_layout 不移动含锁定子节点的泳道，锁定子节点世界坐标绝对不动', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diag = server.repo.createDiagram({ title: '含锁泳道排版图' });
    seedPool(server.repo, diag.id, { laneBLockedChild: true });

    const result = await callTool(server, 1, 'auto_layout', {
      diagramId: diag.id,
      direction: 'RIGHT',
    });
    expect(result.success).toBe(true);
    expect(result.warnings.some((w: string) => w.includes('含锁定子节点'))).toBe(true);

    const reloaded = loadDoc(server.repo, diag.id);
    const nodes = reloaded.getMap<Y.Map<unknown>>('nodes');

    const laneB = nodes.get('lane-b')!;
    expect(laneB.get('position')).toEqual({ x: 0, y: 240 });
    expect(laneB.get('width')).toBe(400);
    expect(laneB.get('height')).toBe(200);

    const locked = nodes.get('node-locked')!;
    expect(locked.get('position')).toEqual({ x: 40, y: 40 });
    // 世界坐标 = 泳池 (50,50) + 泳道 (0,240) + 局部 (40,40)
    expect(worldOf(nodes, 'node-locked')).toEqual({ x: 90, y: 330 });

    await server.app.close();
  }, 20000);

  it('S3: insert_between 禁止撑开 position 锁定泳道并告警', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diag = server.repo.createDiagram({ title: '锁定泳道禁撑图' });
    seedPool(server.repo, diag.id, { laneALock: 'position' });

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
    expect(applied.warnings.some((w: string) => w.includes('跳过自动撑开'))).toBe(true);

    const reloaded = loadDoc(server.repo, diag.id);
    const nodes = reloaded.getMap<Y.Map<unknown>>('nodes');
    const laneA = nodes.get('lane-a')!;
    expect(laneA.get('position')).toEqual({ x: 0, y: 40 });
    expect(laneA.get('width')).toBe(400);
    expect(laneA.get('height')).toBe(200);

    await server.app.close();
  }, 20000);

  it('S4a: 兄弟泳道按重叠增量顺延，保留人工间距', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diag = server.repo.createDiagram({ title: '人工间距图' });
    // lane-a 与 lane-b 之间保留 260px 人工间距
    seedPool(server.repo, diag.id, { laneBY: 500, poolHeight: 940 });

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
    const nodes = reloaded.getMap<Y.Map<unknown>>('nodes');
    const laneA = nodes.get('lane-a')!;
    const laneB = nodes.get('lane-b')!;
    expect(laneA.get('height')).toBe(440);
    // 撑开后 lane-a 底部 480 仍低于 lane-b(500)，人工间距保留不清零
    expect(laneB.get('position')).toEqual({ x: 0, y: 500 });

    await server.app.close();
  }, 20000);

  it('S4b: 含锁定子节点的兄弟泳道不参与移动，锁定节点世界坐标不变', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diag = server.repo.createDiagram({ title: '锁定兄弟泳道图' });
    seedPool(server.repo, diag.id, { laneBLockedChild: true });

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
    const nodes = reloaded.getMap<Y.Map<unknown>>('nodes');
    const laneA = nodes.get('lane-a')!;
    const laneB = nodes.get('lane-b')!;

    // lane-a 撑到 440 已与 lane-b 重叠，但含锁定后代的 lane-b 必须原地不动
    expect(laneA.get('height')).toBe(440);
    expect(laneB.get('position')).toEqual({ x: 0, y: 240 });
    const locked = nodes.get('node-locked')!;
    expect(locked.get('position')).toEqual({ x: 40, y: 40 });
    expect(worldOf(nodes, 'node-locked')).toEqual({ x: 90, y: 330 });

    await server.app.close();
  }, 20000);

  it('S5: 纵向池撑开后兄弟泳道沿 x 轴按重叠增量顺延', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diag = server.repo.createDiagram({ title: '纵向池重排图' });

    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    nodes.set(
      'pool-v',
      makeNode('pool-v', '纵向泳池', { x: 50, y: 50 }, {
        type: 'pool',
        width: 440,
        height: 600,
        data: { orientation: 'vertical', headerSize: 40, laneOrder: ['lane-va', 'lane-vb'] },
      }),
    );
    for (const [laneId, label, x] of [
      ['lane-va', '纵向泳道A', 40],
      ['lane-vb', '纵向泳道B', 240],
    ] as const) {
      nodes.set(
        laneId,
        makeNode(laneId, label, { x, y: 0 }, {
          type: 'lane',
          parentId: 'pool-v',
          width: 200,
          height: 600,
        }),
      );
    }
    nodes.set('node-va', makeNode('node-va', '节点VA', { x: 40, y: 40 }, { parentId: 'lane-va' }));
    nodes.set('node-vc', makeNode('node-vc', '节点VC', { x: 40, y: 40 }, { parentId: 'lane-va' }));
    doc.getMap<Y.Map<unknown>>('edges').set('edge-vac', makeEdge('edge-vac', 'node-va', 'node-vc'));
    server.repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc));

    const applied = await callTool(server, 1, 'apply_ops', {
      diagramId: diag.id,
      ops: [
        {
          op: 'insert_between',
          source: 'node-va',
          target: 'node-vc',
          direction: 'RIGHT',
          node: { id: 'node-v-insert', type: 'process', label: '纵向插入' },
        },
      ],
    });
    expect(applied.success).toBe(true);

    const reloaded = loadDoc(server.repo, diag.id);
    const nextNodes = reloaded.getMap<Y.Map<unknown>>('nodes');
    const laneA = nextNodes.get('lane-va')!;
    const laneB = nextNodes.get('lane-vb')!;
    const laneAPos = laneA.get('position') as { x: number; y: number };
    const laneAWidth = laneA.get('width') as number;
    const laneBPos = laneB.get('position') as { x: number; y: number };
    const poolWidth = nextNodes.get('pool-v')!.get('width') as number;

    expect(laneAWidth).toBe(680);
    expect(laneBPos.x).toBe(laneAPos.x + laneAWidth);
    expect(laneBPos.y).toBe(0);
    expect(poolWidth).toBeGreaterThanOrEqual(laneBPos.x + 200);

    await server.app.close();
  }, 20000);

  it('T2a: insert_between 经 group 传递识别锁定后代，兄弟泳道禁止移动', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diag = server.repo.createDiagram({ title: 'group 嵌套顺延图' });
    seedNested(server.repo, diag.id, 'locked-inner');

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
    const nodes = reloaded.getMap<Y.Map<unknown>>('nodes');
    expect(nodes.get('lane-b')!.get('position')).toEqual({ x: 0, y: 240 });
    expect(nodes.get('lane-b')!.get('width')).toBe(400);
    expect(nodes.get('lane-b')!.get('height')).toBe(200);
    expect(nodes.get('group-1')!.get('position')).toEqual({ x: 20, y: 20 });
    expect(nodes.get('inner-node')!.get('position')).toEqual({ x: 30, y: 30 });
    expect(worldOf(nodes, 'inner-node')).toEqual({ x: 100, y: 340 });

    await server.app.close();
  }, 20000);

  it('T2b: auto_layout 经 group 传递识别锁定后代，泳道与锁定节点均原位', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diag = server.repo.createDiagram({ title: 'group 嵌套排版图' });
    seedNested(server.repo, diag.id, 'locked-inner');

    const result = await callTool(server, 1, 'auto_layout', {
      diagramId: diag.id,
      direction: 'RIGHT',
    });
    expect(result.success).toBe(true);
    expect(result.warnings.some((w: string) => w.includes('含锁定子节点'))).toBe(true);

    const reloaded = loadDoc(server.repo, diag.id);
    const nodes = reloaded.getMap<Y.Map<unknown>>('nodes');
    expect(nodes.get('lane-b')!.get('position')).toEqual({ x: 0, y: 240 });
    expect(nodes.get('group-1')!.get('position')).toEqual({ x: 20, y: 20 });
    expect(nodes.get('inner-node')!.get('position')).toEqual({ x: 30, y: 30 });
    expect(worldOf(nodes, 'inner-node')).toEqual({ x: 100, y: 340 });

    await server.app.close();
  }, 20000);

  it('T1a: 锁定 group 内部未锁定后代整体冻结，auto_layout 不重排', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diag = server.repo.createDiagram({ title: '锁定分组排版图' });
    seedNested(server.repo, diag.id, 'locked-group');

    const result = await callTool(server, 1, 'auto_layout', {
      diagramId: diag.id,
      direction: 'RIGHT',
    });
    expect(result.success).toBe(true);
    expect(result.warnings.some((w: string) => w.includes('位于锁定容器内'))).toBe(true);

    const reloaded = loadDoc(server.repo, diag.id);
    const nodes = reloaded.getMap<Y.Map<unknown>>('nodes');
    expect(nodes.get('lane-b')!.get('position')).toEqual({ x: 0, y: 240 });
    expect(nodes.get('group-1')!.get('position')).toEqual({ x: 20, y: 20 });
    expect(nodes.get('inner-node')!.get('position')).toEqual({ x: 30, y: 30 });
    expect(worldOf(nodes, 'inner-node')).toEqual({ x: 100, y: 340 });

    await server.app.close();
  }, 20000);

  it('T1b: insert_between 顺推跳过锁定祖先下的后代节点', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diag = server.repo.createDiagram({ title: '锁定容器顺推图' });

    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    nodes.set(
      'pool-1',
      makeNode('pool-1', '泳池', { x: 50, y: 50 }, {
        type: 'pool',
        width: 400,
        height: 940,
        data: { orientation: 'horizontal', headerSize: 40, laneOrder: ['lane-a'] },
      }),
    );
    nodes.set(
      'lane-a',
      makeNode('lane-a', '泳道A', { x: 0, y: 40 }, {
        type: 'lane',
        parentId: 'pool-1',
        width: 400,
        height: 600,
      }),
    );
    nodes.set(
      'group-1',
      makeNode('group-1', '分组', { x: 20, y: 20 }, {
        type: 'group',
        parentId: 'lane-a',
        width: 300,
        height: 150,
        lockMode: 'full',
      }),
    );
    nodes.set('node-c', makeNode('node-c', '节点C', { x: 30, y: 30 }, { parentId: 'group-1' }));
    nodes.set('node-a', makeNode('node-a', '节点A', { x: 40, y: 300 }, { parentId: 'lane-a' }));
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
    expect(applied.warnings.some((w: string) => w.includes('位于锁定容器内'))).toBe(true);

    const reloaded = loadDoc(server.repo, diag.id);
    const nextNodes = reloaded.getMap<Y.Map<unknown>>('nodes');
    expect(nextNodes.get('node-c')!.get('position')).toEqual({ x: 30, y: 30 });
    expect(worldOf(nextNodes, 'node-c')).toEqual({ x: 100, y: 140 });

    await server.app.close();
  }, 20000);

  it('T4: 泳道自身锁定同样在兄弟重排中保持原位', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diag = server.repo.createDiagram({ title: '锁定泳道重排图' });
    seedPool(server.repo, diag.id, { laneBLock: 'position' });

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
    const nodes = reloaded.getMap<Y.Map<unknown>>('nodes');
    expect(nodes.get('lane-a')!.get('height')).toBe(440);
    expect(nodes.get('lane-b')!.get('position')).toEqual({ x: 0, y: 240 });
    expect(nodes.get('lane-b')!.get('width')).toBe(400);
    expect(nodes.get('lane-b')!.get('height')).toBe(200);

    await server.app.close();
  }, 20000);

  it('P0-1a: delete_node 含 full 锁后代的泳道/泳池被整体拦截', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diag = server.repo.createDiagram({ title: '容器删除保护图' });

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
    nodes.set(
      'locked-child',
      makeNode('locked-child', '锁定子节点', { x: 40, y: 40 }, {
        parentId: 'lane-a',
        lockMode: 'full',
      }),
    );
    nodes.set(
      'free-child',
      makeNode('free-child', '自由子节点', { x: 40, y: 140 }, { parentId: 'lane-a' }),
    );
    server.repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc));

    const laneDelete = await callTool(server, 1, 'apply_ops', {
      diagramId: diag.id,
      ops: [{ op: 'delete_node', id: 'lane-a' }],
    });
    expect(laneDelete.success).toBe(true);
    expect(laneDelete.appliedCount).toBe(0);
    expect(laneDelete.warnings.some((w: string) => w.includes('内含人工锁定节点'))).toBe(true);

    const poolDelete = await callTool(server, 2, 'apply_ops', {
      diagramId: diag.id,
      ops: [{ op: 'delete_node', id: 'pool-1' }],
    });
    expect(poolDelete.success).toBe(true);
    expect(poolDelete.appliedCount).toBe(0);
    expect(poolDelete.warnings.some((w: string) => w.includes('内含人工锁定节点'))).toBe(true);

    const reloaded = loadDoc(server.repo, diag.id);
    const nextNodes = reloaded.getMap<Y.Map<unknown>>('nodes');
    expect(nextNodes.has('pool-1')).toBe(true);
    expect(nextNodes.has('lane-a')).toBe(true);
    expect(nextNodes.has('lane-b')).toBe(true);
    expect(nextNodes.has('locked-child')).toBe(true);
    expect(nextNodes.has('free-child')).toBe(true);
    expect(nextNodes.get('locked-child')!.get('parentId')).toBe('lane-a');
    expect(nextNodes.get('locked-child')!.get('position')).toEqual({ x: 40, y: 40 });
    expect(worldOf(nextNodes, 'locked-child')).toEqual({ x: 90, y: 130 });
    expect(nextNodes.get('free-child')!.get('parentId')).toBe('lane-a');
    expectNoDanglingParent(nextNodes);

    await server.app.close();
  }, 20000);

  it('P0-1b: delete_node 含 full 锁后代的 group 同样整体拦截', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diag = server.repo.createDiagram({ title: '分组删除保护图' });

    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    nodes.set(
      'pool-1',
      makeNode('pool-1', '泳池', { x: 50, y: 50 }, {
        type: 'pool',
        width: 400,
        height: 440,
        data: { orientation: 'horizontal', headerSize: 40, laneOrder: ['lane-a'] },
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
      'group-1',
      makeNode('group-1', '分组', { x: 20, y: 20 }, {
        type: 'group',
        parentId: 'lane-a',
        width: 300,
        height: 150,
      }),
    );
    nodes.set(
      'inner-node',
      makeNode('inner-node', '内部锁定节点', { x: 10, y: 10 }, {
        parentId: 'group-1',
        lockMode: 'full',
      }),
    );
    server.repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc));

    const groupDelete = await callTool(server, 1, 'apply_ops', {
      diagramId: diag.id,
      ops: [{ op: 'delete_node', id: 'group-1' }],
    });
    expect(groupDelete.success).toBe(true);
    expect(groupDelete.appliedCount).toBe(0);
    expect(groupDelete.warnings.some((w: string) => w.includes('内含人工锁定节点'))).toBe(true);

    const laneDelete = await callTool(server, 2, 'apply_ops', {
      diagramId: diag.id,
      ops: [{ op: 'delete_node', id: 'lane-a' }],
    });
    expect(laneDelete.success).toBe(true);
    expect(laneDelete.appliedCount).toBe(0);
    expect(laneDelete.warnings.some((w: string) => w.includes('内含人工锁定节点'))).toBe(true);

    const reloaded = loadDoc(server.repo, diag.id);
    const nextNodes = reloaded.getMap<Y.Map<unknown>>('nodes');
    expect(nextNodes.has('group-1')).toBe(true);
    expect(nextNodes.has('inner-node')).toBe(true);
    expect(nextNodes.get('inner-node')!.get('parentId')).toBe('group-1');
    expect(nextNodes.get('inner-node')!.get('position')).toEqual({ x: 10, y: 10 });
    expect(worldOf(nextNodes, 'inner-node')).toEqual({ x: 80, y: 120 });
    expectNoDanglingParent(nextNodes);

    await server.app.close();
  }, 20000);

  it('B: add_node 按空闲位落点，跨调用不与既有节点重叠且不越出泳道', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diag = server.repo.createDiagram({ title: '新增落点图' });

    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    nodes.set(
      'lane-a',
      makeNode('lane-a', '泳道A', { x: 0, y: 0 }, { type: 'lane', width: 400, height: 600 }),
    );
    nodes.set('existing', makeNode('existing', '既有节点', { x: 40, y: 40 }, { parentId: 'lane-a' }));
    server.repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc));

    const first = await callTool(server, 1, 'apply_ops', {
      diagramId: diag.id,
      ops: [{ op: 'add_node', id: 'n-1', type: 'process', label: '新增一', laneId: 'lane-a' }],
    });
    expect(first.success).toBe(true);
    const second = await callTool(server, 2, 'apply_ops', {
      diagramId: diag.id,
      ops: [{ op: 'add_node', id: 'n-2', type: 'process', label: '新增二', laneId: 'lane-a' }],
    });
    expect(second.success).toBe(true);
    const third = await callTool(server, 3, 'apply_ops', {
      diagramId: diag.id,
      ops: [
        { op: 'add_node', id: 'f-1', type: 'process', label: '浮动一' },
        { op: 'add_node', id: 'f-2', type: 'process', label: '浮动二' },
      ],
    });
    expect(third.success).toBe(true);

    const reloaded = loadDoc(server.repo, diag.id);
    const nextNodes = reloaded.getMap<Y.Map<unknown>>('nodes');
    const rectOf = (id: string) => {
      const map = nextNodes.get(id)!;
      const pos = map.get('position') as { x: number; y: number };
      return {
        x: pos.x,
        y: pos.y,
        width: map.get('width') as number,
        height: map.get('height') as number,
      };
    };
    const overlaps = (
      a: { x: number; y: number; width: number; height: number },
      b: { x: number; y: number; width: number; height: number },
    ) =>
      a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

    const laneRects = ['existing', 'n-1', 'n-2'].map(rectOf);
    for (let i = 0; i < laneRects.length; i++) {
      for (let j = i + 1; j < laneRects.length; j++) {
        expect(overlaps(laneRects[i], laneRects[j])).toBe(false);
      }
    }
    for (const rect of laneRects) {
      expect(rect.x).toBeGreaterThanOrEqual(40);
      expect(rect.y).toBeGreaterThanOrEqual(40);
      expect(rect.x + rect.width).toBeLessThanOrEqual(400);
      expect(rect.y + rect.height).toBeLessThanOrEqual(600);
    }

    const floating = ['f-1', 'f-2'].map(rectOf);
    expect(overlaps(floating[0], floating[1])).toBe(false);
    expect(nextNodes.get('n-1')!.get('parentId')).toBe('lane-a');
    expect(nextNodes.get('n-2')!.get('parentId')).toBe('lane-a');

    await server.app.close();
  }, 20000);
});

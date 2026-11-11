import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as Y from 'yjs';
import { initDatabase } from '../src/db/database.js';
import { DiagramRepository } from '../src/db/diagram-repository.js';
import { DocumentWriter } from '../src/collaboration/document-writer.js';
import { AiBatchManager } from '../src/collaboration/ai-batch-manager.js';
import { snapshotMap } from '../src/collaboration/entity-state.js';
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

function seedSwimlaneDoc(
  repo: DiagramRepository,
  diagramId: string,
  options: { laneWidth?: number; laneHeight?: number } = {},
): void {
  const doc = new Y.Doc();
  const nodes = doc.getMap<Y.Map<unknown>>('nodes');
  nodes.set(
    'pool-1',
    makeNode('pool-1', '泳池', { x: 50, y: 50 }, {
      type: 'pool',
      width: 400,
      height: 240,
      data: { orientation: 'horizontal', headerSize: 40, laneOrder: ['lane-a', 'lane-b'] },
    }),
  );
  nodes.set(
    'lane-a',
    makeNode('lane-a', '泳道A', { x: 0, y: 40 }, {
      type: 'lane',
      parentId: 'pool-1',
      width: options.laneWidth ?? 400,
      height: options.laneHeight ?? 200,
    }),
  );
  nodes.set(
    'lane-b',
    makeNode('lane-b', '泳道B', { x: 0, y: 240 }, {
      type: 'lane',
      parentId: 'pool-1',
      width: options.laneWidth ?? 400,
      height: options.laneHeight ?? 200,
    }),
  );
  nodes.set('node-a', makeNode('node-a', '节点A', { x: 40, y: 40 }, { parentId: 'lane-a' }));
  nodes.set('node-c', makeNode('node-c', '节点C', { x: 40, y: 40 }, { parentId: 'lane-a' }));
  nodes.set('node-b', makeNode('node-b', '节点B', { x: 40, y: 40 }, { parentId: 'lane-b' }));
  doc.getMap<Y.Map<unknown>>('edges').set('edge-ac', makeEdge('edge-ac', 'node-a', 'node-c', '是'));
  repo.saveYDocState(diagramId, Y.encodeStateAsUpdate(doc));
}

describe('后端审查整改第二轮', () => {
  let tmpDbPath: string;

  beforeEach(() => {
    tmpDbPath = path.join(
      os.tmpdir(),
      `flowstudio-review2-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`,
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

  it('N4: scaffold 把 ELK 全局坐标换算为泳道局部坐标，节点全部落在泳道内', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diagramId = (await callTool(server, 1, 'create_diagram', { title: '泳道坐标图' })).id;

    const result = await callTool(server, 2, 'scaffold_diagram', {
      diagramId,
      title: '泳道坐标图',
      lanes: [
        { id: 'lane-a', label: '泳道A' },
        { id: 'lane-b', label: '泳道B' },
      ],
      nodes: [
        { id: 'n1', type: 'start-end', label: '起点', laneId: 'lane-a' },
        { id: 'n2', type: 'process', label: '步骤', laneId: 'lane-a' },
        { id: 'n3', type: 'decision', label: '判断', laneId: 'lane-b' },
        { id: 'n4', type: 'process', label: '处理', laneId: 'lane-b' },
      ],
      edges: [
        { source: 'n1', target: 'n2' },
        { source: 'n2', target: 'n3' },
        { source: 'n3', target: 'n4' },
      ],
    });
    expect(result.success).toBe(true);

    const doc = loadDoc(server.repo, diagramId);
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');

    let poolId: string | undefined;
    nodes.forEach((nodeMap, id) => {
      if (nodeMap.get('type') === 'pool') poolId = id;
    });
    expect(poolId).toBeTruthy();
    const pool = nodes.get(poolId!)! as Y.Map<unknown>;
    const poolPos = pool.get('position') as { x: number; y: number };
    const poolWidth = pool.get('width') as number;
    const poolHeight = pool.get('height') as number;

    const laneIds = ['lane-a', 'lane-b'];
    let laneHeightSum = 0;
    for (const laneId of laneIds) {
      const lane = nodes.get(laneId)! as Y.Map<unknown>;
      const lanePos = lane.get('position') as { x: number; y: number };
      const laneWidth = lane.get('width') as number;
      const laneHeight = lane.get('height') as number;
      laneHeightSum += laneHeight;

      expect(lanePos.x).toBe(0);
      expect(laneWidth).toBe(poolWidth);

      nodes.forEach((childMap, childId) => {
        if (childMap.get('parentId') !== laneId) return;
        const childPos = childMap.get('position') as { x: number; y: number };
        const childWidth = childMap.get('width') as number;
        const childHeight = childMap.get('height') as number;

        // 局部坐标必须是相对泳道原点的非负小值，而不是 ELK 全局坐标
        expect(childPos.x).toBeGreaterThanOrEqual(40);
        expect(childPos.y).toBeGreaterThanOrEqual(40);
        expect(childPos.x + childWidth).toBeLessThanOrEqual(laneWidth);
        expect(childPos.y + childHeight).toBeLessThanOrEqual(laneHeight);

        // 世界坐标落在泳道容器矩形内
        const worldX = poolPos.x + lanePos.x + childPos.x;
        const worldY = poolPos.y + lanePos.y + childPos.y;
        expect(worldX).toBeGreaterThanOrEqual(poolPos.x + lanePos.x);
        expect(worldY).toBeGreaterThanOrEqual(poolPos.y + lanePos.y);
        expect(worldX + childWidth).toBeLessThanOrEqual(
          poolPos.x + lanePos.x + laneWidth,
        );
        expect(worldY + childHeight).toBeLessThanOrEqual(
          poolPos.y + lanePos.y + laneHeight,
        );
      });
    }

    // 横向泳道：池高 = 表头 + 各泳道高度之和
    expect(poolHeight).toBe(40 + laneHeightSum);
    await server.app.close();
  }, 20000);

  it('N4: auto_layout 重排后泳道子节点仍保持局部坐标并落在泳道内', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diag = server.repo.createDiagram({ title: '泳道自动排版图' });
    seedSwimlaneDoc(server.repo, diag.id);

    const result = await callTool(server, 1, 'auto_layout', {
      diagramId: diag.id,
      direction: 'RIGHT',
    });
    expect(result.success).toBe(true);

    const doc = loadDoc(server.repo, diag.id);
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    const pool = nodes.get('pool-1')! as Y.Map<unknown>;
    const poolPos = pool.get('position') as { x: number; y: number };
    const poolWidth = pool.get('width') as number;
    const poolHeight = pool.get('height') as number;

    for (const laneId of ['lane-a', 'lane-b']) {
      const lane = nodes.get(laneId)! as Y.Map<unknown>;
      const lanePos = lane.get('position') as { x: number; y: number };
      const laneWidth = lane.get('width') as number;
      const laneHeight = lane.get('height') as number;
      expect(laneWidth).toBe(poolWidth);

      nodes.forEach((childMap, childId) => {
        if (childMap.get('parentId') !== laneId) return;
        const childPos = childMap.get('position') as { x: number; y: number };
        const childWidth = childMap.get('width') as number;
        const childHeight = childMap.get('height') as number;

        expect(childPos.x).toBeGreaterThanOrEqual(0);
        expect(childPos.y).toBeGreaterThanOrEqual(0);
        expect(childPos.x + childWidth).toBeLessThanOrEqual(laneWidth);
        expect(childPos.y + childHeight).toBeLessThanOrEqual(laneHeight);

        const worldY = poolPos.y + lanePos.y + childPos.y;
        expect(worldY).toBeGreaterThanOrEqual(poolPos.y + lanePos.y);
        expect(worldY + childHeight).toBeLessThanOrEqual(
          poolPos.y + lanePos.y + laneHeight,
        );
      });
    }
    expect(poolHeight).toBeGreaterThanOrEqual(440);
    await server.app.close();
  }, 20000);

  it('N5: 禁止把 A 图快照恢复进 B 图', async () => {
    const db = initDatabase(tmpDbPath);
    const repo = new DiagramRepository(db);
    const writer = new DocumentWriter(repo);

    const diagA = repo.createDiagram({ title: '图A' });
    const diagB = repo.createDiagram({ title: '图B' });
    const docA = loadDoc(repo, diagA.id);
    docA.getMap('nodes').set('a-node', makeNode('a-node', 'A节点', { x: 0, y: 0 }));
    repo.saveYDocState(diagA.id, Y.encodeStateAsUpdate(docA));
    const docB = loadDoc(repo, diagB.id);
    docB.getMap('nodes').set('b-node', makeNode('b-node', 'B节点', { x: 0, y: 0 }));
    repo.saveYDocState(diagB.id, Y.encodeStateAsUpdate(docB));

    const snapshot = repo.createSnapshot(diagA.id, 'A 图快照', 'manual')!;

    const result = await writer.restoreSnapshot(diagB.id, snapshot.id);
    expect(result.success).toBe(false);
    expect(result.error).toContain('不属于当前图表');

    // B 图内容未被 A 图快照污染
    const after = loadDoc(repo, diagB.id);
    expect(after.getMap('nodes').has('b-node')).toBe(true);
    expect(after.getMap('nodes').has('a-node')).toBe(false);

    db.close();
  });

  it('N6: 在线优先快照截取 Live Doc，不遗漏未落库的最新编辑', () => {
    const db = initDatabase(tmpDbPath);
    const repo = new DiagramRepository(db);
    const diag = repo.createDiagram({ title: '在线快照图' });

    const liveDoc = new Y.Doc();
    Y.applyUpdate(liveDoc, repo.getYDocState(diag.id)!);
    liveDoc.getMap<Y.Map<unknown>>('nodes').set(
      'live-only',
      makeNode('live-only', '尚未落库的节点', { x: 0, y: 0 }),
    );

    // 模拟 Hocuspocus 内存中的 Live Doc（SQLite 尚未收到防抖落库）
    const fakeHocuspocus = { documents: new Map([[diag.id, liveDoc]]) };
    const writer = new DocumentWriter(repo, fakeHocuspocus as never);

    const snapshot = writer.createSnapshot(diag.id, '在线快照', 'manual')!;
    expect(snapshot).toBeTruthy();

    const dbDoc = loadDoc(repo, diag.id);
    expect(dbDoc.getMap('nodes').has('live-only')).toBe(false);

    const snapState = repo.getSnapshotState(snapshot.id)!;
    const snapDoc = new Y.Doc();
    Y.applyUpdate(snapDoc, snapState);
    expect(snapDoc.getMap('nodes').has('live-only')).toBe(true);

    db.close();
  });

  it('N7: scaffold 保留完全锁定节点及其两端连线，并记录告警', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diag = server.repo.createDiagram({ title: '骨架锁保护图' });
    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    nodes.set('locked-a', makeNode('locked-a', '锁定A', { x: 10, y: 10 }, { lockMode: 'full' }));
    nodes.set('locked-b', makeNode('locked-b', '锁定B', { x: 300, y: 10 }, { lockMode: 'full' }));
    nodes.set('free-node', makeNode('free-node', '自由节点', { x: 100, y: 200 }));
    const edges = doc.getMap<Y.Map<unknown>>('edges');
    edges.set('edge-locked', makeEdge('edge-locked', 'locked-a', 'locked-b'));
    edges.set('edge-dangling', makeEdge('edge-dangling', 'locked-a', 'free-node'));
    server.repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc));

    const result = await callTool(server, 1, 'scaffold_diagram', {
      diagramId: diag.id,
      nodes: [{ id: 'n-new', type: 'process', label: '新节点' }],
      edges: [],
    });
    expect(result.success).toBe(true);
    expect(result.warnings.some((w: string) => w.includes('完全锁定'))).toBe(true);

    const reloaded = loadDoc(server.repo, diag.id);
    const nextNodes = reloaded.getMap<Y.Map<unknown>>('nodes');
    const nextEdges = reloaded.getMap<Y.Map<unknown>>('edges');
    expect(nextNodes.has('locked-a')).toBe(true);
    expect(nextNodes.has('locked-b')).toBe(true);
    expect(nextNodes.has('free-node')).toBe(false);
    expect(nextNodes.has('n-new')).toBe(true);

    // 两端都锁定的连线保留；一端节点被清理的连线必须删除，避免悬挂边
    expect(nextEdges.has('edge-locked')).toBe(true);
    expect(nextEdges.has('edge-dangling')).toBe(false);

    await server.app.close();
  }, 20000);

  it('N9a: insert_between 继承原连线分支标签（上游边）', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diag = server.repo.createDiagram({ title: '断线标签继承图' });
    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    nodes.set('node-a', makeNode('node-a', '判断', { x: 0, y: 0 }, { type: 'decision' }));
    nodes.set('node-c', makeNode('node-c', '通过', { x: 300, y: 0 }));
    doc.getMap<Y.Map<unknown>>('edges').set('edge-ac', makeEdge('edge-ac', 'node-a', 'node-c', '是'));
    server.repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc));

    const applied = await callTool(server, 1, 'apply_ops', {
      diagramId: diag.id,
      ops: [
        {
          op: 'insert_between',
          source: 'node-a',
          target: 'node-c',
          node: { id: 'node-b', type: 'process', label: '插入节点' },
        },
      ],
    });
    expect(applied.success).toBe(true);

    const diagram = await callTool(server, 2, 'get_diagram', { diagramId: diag.id });
    const upstream = diagram.edges.find(
      (edge: { source: string; target: string }) =>
        edge.source === 'node-a' && edge.target === 'node-b',
    );
    const downstream = diagram.edges.find(
      (edge: { source: string; target: string }) =>
        edge.source === 'node-b' && edge.target === 'node-c',
    );
    expect(upstream?.label).toBe('是');
    expect(downstream?.label).toBeUndefined();

    await server.app.close();
  }, 20000);

  it('N9b: insert_between 下游顺推后自动撑开泳道与泳池', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diag = server.repo.createDiagram({ title: '断线撑开图' });
    seedSwimlaneDoc(server.repo, diag.id, { laneWidth: 400 });

    const applied = await callTool(server, 1, 'apply_ops', {
      diagramId: diag.id,
      ops: [
        {
          op: 'insert_between',
          source: 'node-a',
          target: 'node-c',
          node: { id: 'node-insert', type: 'process', label: '插入节点' },
        },
      ],
    });
    expect(applied.success).toBe(true);

    const doc = loadDoc(server.repo, diag.id);
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    const lane = nodes.get('lane-a')! as Y.Map<unknown>;
    const pool = nodes.get('pool-1')! as Y.Map<unknown>;
    const inserted = nodes.get('node-insert')! as Y.Map<unknown>;
    const target = nodes.get('node-c')! as Y.Map<unknown>;

    const laneWidth = lane.get('width') as number;
    const laneHeight = lane.get('height') as number;
    const poolWidth = pool.get('width') as number;
    const insertedPos = inserted.get('position') as { x: number; y: number };
    const targetPos = target.get('position') as { x: number; y: number };

    expect(targetPos.x).toBeGreaterThan(40);
    expect(laneWidth).toBeGreaterThanOrEqual(insertedPos.x + 160 + 40);
    expect(laneWidth).toBeGreaterThanOrEqual(targetPos.x + 160 + 40);
    expect(laneHeight).toBeGreaterThanOrEqual(targetPos.y + 80 + 40);
    expect(poolWidth).toBeGreaterThanOrEqual(laneWidth);

    await server.app.close();
  }, 20000);

  it('N8: 同批次连线被人工修改时，撤回新增节点必须整体跳过，绝不留下悬挂边', async () => {
    const db = initDatabase(tmpDbPath);
    const repo = new DiagramRepository(db);
    const manager = new AiBatchManager(repo);
    const diag = repo.createDiagram({ title: '悬挂边保护图' });

    const baseDoc = new Y.Doc();
    baseDoc.getMap('nodes').set('node-a', makeNode('node-a', '原节点', { x: 0, y: 0 }));
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(baseDoc));

    const aiDoc = loadDoc(repo, diag.id);
    const aiNode = makeNode('node-b', 'AI节点', { x: 200, y: 0 });
    const aiEdge = makeEdge('edge-ba', 'node-b', 'node-a', '原始标签');
    aiDoc.getMap('nodes').set('node-b', aiNode);
    aiDoc.getMap('edges').set('edge-ba', aiEdge);
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(aiDoc));

    manager.recordBatch({
      batchId: 'batch-dangling',
      diagramId: diag.id,
      summary: 'AI 新增节点与连线',
      createdAt: new Date().toISOString(),
      diffs: [
        {
          entityId: 'node-b',
          entityType: 'node',
          opType: 'add',
          beforeState: null,
          afterState: snapshotMap(aiNode),
        },
        {
          entityId: 'edge-ba',
          entityType: 'edge',
          opType: 'add',
          beforeState: null,
          afterState: snapshotMap(aiEdge),
        },
      ],
    });

    // 同事手工修改了同批次新增的连线
    const humanDoc = loadDoc(repo, diag.id);
    (humanDoc.getMap('edges').get('edge-ba') as Y.Map<unknown>).set('data', { label: '人工改标签' });
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(humanDoc));

    const revert = await manager.revertBatch(diag.id, 'batch-dangling');
    expect(revert.success).toBe(true);
    expect(revert.skippedCount).toBeGreaterThan(0);

    const after = loadDoc(repo, diag.id);
    expect(after.getMap('nodes').has('node-b')).toBe(true);
    expect(after.getMap('edges').has('edge-ba')).toBe(true);

    db.close();
  });

  it('N10: 并发精细撤回不同实体时，账本标记不丢失', async () => {
    const db = initDatabase(tmpDbPath);
    const repo = new DiagramRepository(db);
    const manager = new AiBatchManager(repo);
    const diag = repo.createDiagram({ title: '并发撤回图' });

    const doc = new Y.Doc();
    const nodeA = makeNode('node-a', 'AI A', { x: 0, y: 0 });
    const nodeB = makeNode('node-b', 'AI B', { x: 200, y: 0 });
    doc.getMap('nodes').set('node-a', nodeA);
    doc.getMap('nodes').set('node-b', nodeB);
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc));

    manager.recordBatch({
      batchId: 'batch-concurrent',
      diagramId: diag.id,
      summary: 'AI 并发撤回测试',
      createdAt: new Date().toISOString(),
      diffs: [
        {
          entityId: 'node-a',
          entityType: 'node',
          opType: 'add',
          beforeState: null,
          afterState: snapshotMap(nodeA),
        },
        {
          entityId: 'node-b',
          entityType: 'node',
          opType: 'add',
          beforeState: null,
          afterState: snapshotMap(nodeB),
        },
      ],
    });

    const [revertA, revertB] = await Promise.all([
      manager.revertItems(diag.id, 'batch-concurrent', ['node-a']),
      manager.revertItems(diag.id, 'batch-concurrent', ['node-b']),
    ]);
    expect(revertA.success).toBe(true);
    expect(revertB.success).toBe(true);

    const after = loadDoc(repo, diag.id);
    expect(after.getMap('nodes').has('node-a')).toBe(false);
    expect(after.getMap('nodes').has('node-b')).toBe(false);

    const ledger = repo.getAiBatch(diag.id, 'batch-concurrent')!;
    expect(ledger.diffs.every((diff) => diff.reverted)).toBe(true);
    expect(ledger.status).toBe('reverted');

    db.close();
  });

  it('N11: add_node 拒绝 pool/lane 等容器类型，保护泳道层级', async () => {
    const server = await buildServer({ dbPath: tmpDbPath });
    const diag = server.repo.createDiagram({ title: '非法类型图' });

    const res = await server.app.inject({
      method: 'POST',
      url: '/mcp',
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'apply_ops',
          arguments: {
            diagramId: diag.id,
            ops: [{ op: 'add_node', id: 'fake-pool', type: 'pool', label: '伪造泳池' }],
          },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const payload = res.json().result;
    expect(payload.isError).toBe(true);
    expect(payload.content[0].text).toContain('执行失败');

    const after = loadDoc(server.repo, diag.id);
    expect(after.getMap('nodes').has('fake-pool')).toBe(false);

    await server.app.close();
  }, 20000);
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as Y from 'yjs';
import { initDatabase } from '../src/db/database.js';
import { DiagramRepository } from '../src/db/diagram-repository.js';
import { AiBatchManager, isEntityModifiedByHuman } from '../src/collaboration/ai-batch-manager.js';

describe('AI 批次撤回拓扑完整度校验与细粒度样式退让', () => {
  let tmpDbPath: string;
  let repo: DiagramRepository;
  let batchManager: AiBatchManager;
  let db: ReturnType<typeof initDatabase>;

  beforeEach(() => {
    tmpDbPath = path.join(os.tmpdir(), `flowstudio-batch-topo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`);
    db = initDatabase(tmpDbPath);
    repo = new DiagramRepository(db);
    batchManager = new AiBatchManager(repo);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        if (fs.existsSync(tmpDbPath + suffix)) fs.unlinkSync(tmpDbPath + suffix);
      } catch {
        // ignore
      }
    }
  });

  it('1. 连线恢复时拓扑校验（防幽灵边）：两端节点不存在时跳过恢复并记入 skipped', async () => {
    const diag = repo.createDiagram({ title: '防幽灵边测试图' });

    // 初始画布包含节点 A、B 和连线 edge-1
    const doc = new Y.Doc();
    const nodeA = new Y.Map();
    nodeA.set('id', 'node-a');
    nodeA.set('data', { label: '节点A' });
    doc.getMap('nodes').set('node-a', nodeA);

    const nodeB = new Y.Map();
    nodeB.set('id', 'node-b');
    nodeB.set('data', { label: '节点B' });
    doc.getMap('nodes').set('node-b', nodeB);

    const edge = new Y.Map();
    edge.set('id', 'edge-1');
    edge.set('source', 'node-a');
    edge.set('target', 'node-b');
    doc.getMap('edges').set('edge-1', edge);

    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc));

    // 模拟 AI 批次删除了 edge-1
    const docAfterAi = new Y.Doc();
    Y.applyUpdate(docAfterAi, repo.getYDocState(diag.id)!);
    docAfterAi.getMap('edges').delete('edge-1');
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(docAfterAi));

    batchManager.recordBatch({
      batchId: 'batch-del-edge',
      diagramId: diag.id,
      summary: 'AI 删除了 edge-1',
      diffs: [
        {
          entityId: 'edge-1',
          entityType: 'edge',
          opType: 'delete',
          beforeState: { id: 'edge-1', source: 'node-a', target: 'node-b' },
          afterState: null,
        },
      ],
      createdAt: new Date().toISOString(),
    });

    // 随后人类删除了目标节点 B
    const docAfterHuman = new Y.Doc();
    Y.applyUpdate(docAfterHuman, repo.getYDocState(diag.id)!);
    docAfterHuman.getMap('nodes').delete('node-b');
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(docAfterHuman));

    // 执行撤回该批次
    const res = await batchManager.revertBatch(diag.id, 'batch-del-edge');

    expect(res.success).toBe(true);
    expect(res.revertedEntityIds).not.toContain('edge-1');
    expect(res.skippedCount).toBe(1);
    expect(res.skipped[0].entityId).toBe('edge-1');
    expect(res.skipped[0].reason).toContain('端点');

    // 画布中不得存在 edge-1
    const finalDoc = new Y.Doc();
    Y.applyUpdate(finalDoc, repo.getYDocState(diag.id)!);
    expect(finalDoc.getMap('edges').has('edge-1')).toBe(false);
  });

  it('2. 节点恢复时父容器失效容错（防孤儿子节点）：父容器已删除时剥离 parentId 保留为顶层节点', async () => {
    const diag = repo.createDiagram({ title: '防孤儿子节点测试图' });

    // 初始画布包含泳道 pool-1 和其内部节点 task-1
    const doc = new Y.Doc();
    const pool = new Y.Map();
    pool.set('id', 'pool-1');
    pool.set('type', 'pool');
    doc.getMap('nodes').set('pool-1', pool);

    const task = new Y.Map();
    task.set('id', 'task-1');
    task.set('parentId', 'pool-1');
    task.set('extent', 'parent');
    task.set('data', { label: '任务1' });
    doc.getMap('nodes').set('task-1', task);

    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc));

    // 模拟 AI 批次删除了 task-1
    const docAfterAi = new Y.Doc();
    Y.applyUpdate(docAfterAi, repo.getYDocState(diag.id)!);
    docAfterAi.getMap('nodes').delete('task-1');
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(docAfterAi));

    batchManager.recordBatch({
      batchId: 'batch-del-node',
      diagramId: diag.id,
      summary: 'AI 删除了 task-1',
      diffs: [
        {
          entityId: 'task-1',
          entityType: 'node',
          opType: 'delete',
          beforeState: {
            id: 'task-1',
            parentId: 'pool-1',
            extent: 'parent',
            data: { label: '任务1' },
          },
          afterState: null,
        },
      ],
      createdAt: new Date().toISOString(),
    });

    // 随后人类删除了父容器 pool-1
    const docAfterHuman = new Y.Doc();
    Y.applyUpdate(docAfterHuman, repo.getYDocState(diag.id)!);
    docAfterHuman.getMap('nodes').delete('pool-1');
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(docAfterHuman));

    // 执行撤回该批次
    const res = await batchManager.revertBatch(diag.id, 'batch-del-node');

    expect(res.success).toBe(true);
    expect(res.revertedEntityIds).toContain('task-1');

    // 验证恢复出来的 task-1 节点剥离了 parentId 和 extent，成为自由顶层节点
    const finalDoc = new Y.Doc();
    Y.applyUpdate(finalDoc, repo.getYDocState(diag.id)!);
    const restoredTask = finalDoc.getMap('nodes').get('task-1') as Y.Map<unknown>;
    expect(restoredTask).toBeDefined();
    expect(restoredTask.has('parentId')).toBe(false);
    expect(restoredTask.has('extent')).toBe(false);
    expect((restoredTask.get('data') as any).label).toBe('任务1');
  });

  it('3. 容器撤回前检查人工子节点（防人工孤儿）：挂载了人工子节点时安全跳过撤回容器', async () => {
    const diag = repo.createDiagram({ title: '防人工孤儿测试图' });

    // 模拟 AI 批次新建了一个泳道 lane-ai-1
    const doc = new Y.Doc();
    const laneNode = new Y.Map();
    laneNode.set('id', 'lane-ai-1');
    laneNode.set('type', 'lane');
    laneNode.set('data', { label: 'AI创建泳道' });
    doc.getMap('nodes').set('lane-ai-1', laneNode);
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc));

    batchManager.recordBatch({
      batchId: 'batch-add-lane',
      diagramId: diag.id,
      summary: 'AI 创建泳道 lane-ai-1',
      diffs: [
        {
          entityId: 'lane-ai-1',
          entityType: 'node',
          opType: 'add',
          beforeState: null,
          afterState: { id: 'lane-ai-1', type: 'lane', data: { label: 'AI创建泳道' } },
        },
      ],
      createdAt: new Date().toISOString(),
    });

    // 随后人类手工在泳道内创建了一个新子节点 human-node-1
    const docAfterHuman = new Y.Doc();
    Y.applyUpdate(docAfterHuman, repo.getYDocState(diag.id)!);
    const humanChild = new Y.Map();
    humanChild.set('id', 'human-node-1');
    humanChild.set('parentId', 'lane-ai-1');
    humanChild.set('data', { label: '人工录入需求' });
    docAfterHuman.getMap('nodes').set('human-node-1', humanChild);
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(docAfterHuman));

    // 执行撤回该批次
    const res = await batchManager.revertBatch(diag.id, 'batch-add-lane');

    expect(res.success).toBe(true);
    // 泳道应当被跳过删除，因为挂有人工子节点
    expect(res.revertedEntityIds).not.toContain('lane-ai-1');
    expect(res.skippedCount).toBe(1);
    expect(res.skipped[0].entityId).toBe('lane-ai-1');
    expect(res.skipped[0].reason).toContain('人工');

    // 画布上的泳道与人工子节点均完整保留
    const finalDoc = new Y.Doc();
    Y.applyUpdate(finalDoc, repo.getYDocState(diag.id)!);
    expect(finalDoc.getMap('nodes').has('lane-ai-1')).toBe(true);
    expect(finalDoc.getMap('nodes').has('human-node-1')).toBe(true);
  });

  it('4. 细粒度样式子键比对（防误判冲突）：人类仅修改 borderColor 时，撤回仅还原 AI 修改的 backgroundColor 并保留 borderColor', async () => {
    const diag = repo.createDiagram({ title: '细粒度样式比对图' });

    // 初始节点包含样式
    const doc = new Y.Doc();
    const node = new Y.Map();
    node.set('id', 'node-style-1');
    node.set('data', {
      label: '样式节点',
      style: { backgroundColor: '#ffffff', borderColor: '#000000' },
    });
    doc.getMap('nodes').set('node-style-1', node);
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc));

    // AI 修改了 backgroundColor 为 #ff0000
    const docAfterAi = new Y.Doc();
    Y.applyUpdate(docAfterAi, repo.getYDocState(diag.id)!);
    (docAfterAi.getMap('nodes').get('node-style-1') as Y.Map<unknown>).set('data', {
      label: '样式节点',
      style: { backgroundColor: '#ff0000', borderColor: '#000000' },
    });
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(docAfterAi));

    batchManager.recordBatch({
      batchId: 'batch-update-style',
      diagramId: diag.id,
      summary: 'AI 修改背景色',
      diffs: [
        {
          entityId: 'node-style-1',
          entityType: 'node',
          opType: 'update',
          beforeState: {
            data: {
              label: '样式节点',
              style: { backgroundColor: '#ffffff', borderColor: '#000000' },
            },
          },
          afterState: {
            data: {
              label: '样式节点',
              style: { backgroundColor: '#ff0000', borderColor: '#000000' },
            },
          },
        },
      ],
      createdAt: new Date().toISOString(),
    });

    // 随后人类手工修改了 borderColor 为 #0000ff（未动 backgroundColor）
    const docAfterHuman = new Y.Doc();
    Y.applyUpdate(docAfterHuman, repo.getYDocState(diag.id)!);
    (docAfterHuman.getMap('nodes').get('node-style-1') as Y.Map<unknown>).set('data', {
      label: '样式节点',
      style: { backgroundColor: '#ff0000', borderColor: '#0000ff' },
    });
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(docAfterHuman));

    // 执行撤回该批次
    const res = await batchManager.revertBatch(diag.id, 'batch-update-style');

    expect(res.success).toBe(true);
    expect(res.revertedEntityIds).toContain('node-style-1');
    expect(res.skippedCount).toBe(0);

    // 验证撤回后状态：backgroundColor 还原为 #ffffff，borderColor 保留人类设置的 #0000ff
    const finalDoc = new Y.Doc();
    Y.applyUpdate(finalDoc, repo.getYDocState(diag.id)!);
    const finalNode = finalDoc.getMap('nodes').get('node-style-1') as Y.Map<unknown>;
    const finalData = finalNode.get('data') as any;

    expect(finalData.style.backgroundColor).toBe('#ffffff');
    expect(finalData.style.borderColor).toBe('#0000ff');
  });

  it('5. 细粒度样式比对函数 isEntityModifiedByHuman：准确识别冲突与非冲突字段', () => {
    const beforeState = {
      data: {
        label: '节点',
        style: { backgroundColor: '#ffffff', borderColor: '#000000' },
      },
    };
    const afterState = {
      data: {
        label: '节点',
        style: { backgroundColor: '#ff0000', borderColor: '#000000' },
      },
    };

    // 人类仅修改了 borderColor（AI 没碰过的子键） -> 不冲突，返回 false
    const currentNonConflict = {
      data: {
        label: '节点',
        style: { backgroundColor: '#ff0000', borderColor: '#123456' },
      },
    };
    expect(isEntityModifiedByHuman(currentNonConflict, afterState, beforeState)).toBe(false);

    // 人类修改了 backgroundColor（AI 修改过的子键） -> 冲突，返回 true
    const currentConflict = {
      data: {
        label: '节点',
        style: { backgroundColor: '#00ff00', borderColor: '#000000' },
      },
    };
    expect(isEntityModifiedByHuman(currentConflict, afterState, beforeState)).toBe(true);
  });

  it('6. 样式冲突时精细化记录 skipped 字段且非冲突子键正常还原', async () => {
    const diag = repo.createDiagram({ title: '样式部分冲突图' });

    // AI 同时修改了 backgroundColor 和 color
    const doc = new Y.Doc();
    const node = new Y.Map();
    node.set('id', 'node-mix-style');
    node.set('data', {
      label: '混合样式节点',
      style: { backgroundColor: '#ffffff', color: '#000000' },
    });
    doc.getMap('nodes').set('node-mix-style', node);
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc));

    const docAfterAi = new Y.Doc();
    Y.applyUpdate(docAfterAi, repo.getYDocState(diag.id)!);
    (docAfterAi.getMap('nodes').get('node-mix-style') as Y.Map<unknown>).set('data', {
      label: '混合样式节点',
      style: { backgroundColor: '#ff0000', color: '#333333' },
    });
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(docAfterAi));

    batchManager.recordBatch({
      batchId: 'batch-mix-style',
      diagramId: diag.id,
      summary: 'AI 修改背景色与文字色',
      diffs: [
        {
          entityId: 'node-mix-style',
          entityType: 'node',
          opType: 'update',
          beforeState: {
            data: {
              label: '混合样式节点',
              style: { backgroundColor: '#ffffff', color: '#000000' },
            },
          },
          afterState: {
            data: {
              label: '混合样式节点',
              style: { backgroundColor: '#ff0000', color: '#333333' },
            },
          },
        },
      ],
      createdAt: new Date().toISOString(),
    });

    // 人类随后把 backgroundColor 改成 #00ff00，但未动 color
    const docAfterHuman = new Y.Doc();
    Y.applyUpdate(docAfterHuman, repo.getYDocState(diag.id)!);
    (docAfterHuman.getMap('nodes').get('node-mix-style') as Y.Map<unknown>).set('data', {
      label: '混合样式节点',
      style: { backgroundColor: '#00ff00', color: '#333333' },
    });
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(docAfterHuman));

    const res = await batchManager.revertBatch(diag.id, 'batch-mix-style');
    expect(res.success).toBe(true);
    expect(res.revertedEntityIds).toContain('node-mix-style');
    expect(res.skippedCount).toBe(1);
    expect(res.skipped[0].field).toBe('data.style');

    const finalDoc = new Y.Doc();
    Y.applyUpdate(finalDoc, repo.getYDocState(diag.id)!);
    const finalNode = finalDoc.getMap('nodes').get('node-mix-style') as Y.Map<unknown>;
    const finalData = finalNode.get('data') as any;
    // 人类修改的背景色得到保护，未被触碰的文字色被还原为 #000000
    expect(finalData.style.backgroundColor).toBe('#00ff00');
    expect(finalData.style.color).toBe('#000000');
  });

  it('7. 容器与同批次 AI 子节点均未被人类修改时，两者应正常全部撤回', async () => {
    const diag = repo.createDiagram({ title: '纯AI批次容器撤回图' });

    const doc = new Y.Doc();
    const laneNode = new Y.Map();
    laneNode.set('id', 'lane-pure-ai');
    laneNode.set('type', 'lane');
    doc.getMap('nodes').set('lane-pure-ai', laneNode);

    const childNode = new Y.Map();
    childNode.set('id', 'child-pure-ai');
    childNode.set('parentId', 'lane-pure-ai');
    doc.getMap('nodes').set('child-pure-ai', childNode);

    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(doc));

    batchManager.recordBatch({
      batchId: 'batch-pure-ai-lane',
      diagramId: diag.id,
      summary: 'AI 同时创建泳道与子节点',
      diffs: [
        {
          entityId: 'lane-pure-ai',
          entityType: 'node',
          opType: 'add',
          beforeState: null,
          afterState: { id: 'lane-pure-ai', type: 'lane' },
        },
        {
          entityId: 'child-pure-ai',
          entityType: 'node',
          opType: 'add',
          beforeState: null,
          afterState: { id: 'child-pure-ai', parentId: 'lane-pure-ai' },
        },
      ],
      createdAt: new Date().toISOString(),
    });

    const res = await batchManager.revertBatch(diag.id, 'batch-pure-ai-lane');
    expect(res.success).toBe(true);
    expect(res.revertedEntityIds).toContain('lane-pure-ai');
    expect(res.revertedEntityIds).toContain('child-pure-ai');
    expect(res.skippedCount).toBe(0);

    const finalDoc = new Y.Doc();
    Y.applyUpdate(finalDoc, repo.getYDocState(diag.id)!);
    expect(finalDoc.getMap('nodes').has('lane-pure-ai')).toBe(false);
    expect(finalDoc.getMap('nodes').has('child-pure-ai')).toBe(false);
  });
});

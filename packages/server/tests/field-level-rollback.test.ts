import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as Y from 'yjs';
import { initDatabase } from '../src/db/database.js';
import { DiagramRepository } from '../src/db/diagram-repository.js';
import { AiBatchManager } from '../src/collaboration/ai-batch-manager.js';
import { snapshotMap } from '../src/collaboration/entity-state.js';

function readDoc(repo: DiagramRepository, diagramId: string): Y.Doc {
  const state = repo.getYDocState(diagramId);
  if (!state) throw new Error('文档状态不存在');
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc;
}

describe('AI 批次字段级防冲突撤回', () => {
  let tmpDbPath: string;

  beforeEach(() => {
    tmpDbPath = path.join(os.tmpdir(), `flowstudio-field-revert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`);
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

  it('仅还原未被人工改动的字段，人工改写的 label 原样保留并标记 partially_reverted', async () => {
    const db = initDatabase(tmpDbPath);
    const repo = new DiagramRepository(db);
    const batchManager = new AiBatchManager(repo);
    const diag = repo.createDiagram({ title: '字段级撤回图' });

    // 1. 初始节点：原始文案 + 白色填充
    const seed = new Y.Doc();
    const node = new Y.Map<unknown>();
    node.set('id', 'n-1');
    node.set('type', 'process');
    node.set('position', { x: 10, y: 20 });
    node.set('data', {
      label: '原始文案',
      type: 'process',
      style: { fillColor: '#FFFFFF', fontSize: 12 },
    });
    seed.getMap('nodes').set('n-1', node);
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(seed));

    const before = snapshotMap(seed.getMap<Y.Map<unknown>>('nodes').get('n-1')!);

    // 2. 模拟 AI 更新 label 与 style，并落库
    const aiDoc = readDoc(repo, diag.id);
    const aiNode = aiDoc.getMap<Y.Map<unknown>>('nodes').get('n-1')!;
    aiNode.set('data', {
      label: 'AI 智能文案',
      type: 'process',
      style: { fillColor: '#FF0000', fontSize: 12 },
    });
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(aiDoc));

    const after = snapshotMap(aiNode);

    batchManager.recordBatch({
      batchId: 'batch-field-1',
      diagramId: diag.id,
      summary: 'AI 优化文案与配色',
      status: 'active',
      diffs: [
        {
          entityId: 'n-1',
          entityType: 'node',
          opType: 'update',
          beforeState: before,
          afterState: after,
        },
      ],
      createdAt: new Date().toISOString(),
    });

    // 3. 同事仅手工改写 label，style 保持 AI 写入值
    const humanDoc = readDoc(repo, diag.id);
    const humanNode = humanDoc.getMap<Y.Map<unknown>>('nodes').get('n-1')!;
    const humanData = (humanNode.get('data') as Record<string, unknown>) || {};
    humanNode.set('data', { ...humanData, label: '【人工终审】放款审批文案' });
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(humanDoc));

    // 4. 撤回 AI 批次
    const res = await batchManager.revertBatch(diag.id, 'batch-field-1');
    expect(res.success).toBe(true);
    expect(res.status).toBe('partially_reverted');
    expect(res.skippedCount).toBe(1);
    expect(res.skipped[0].entityId).toBe('n-1');
    expect(res.skipped[0].field).toBe('data.label');
    expect(res.skipped[0].reason).toContain('人工修改');

    // 5. 字段级断言：label 保留人工版本，style 还原为原始值
    const revertedDoc = readDoc(repo, diag.id);
    const revertedNode = revertedDoc.getMap<Y.Map<unknown>>('nodes').get('n-1')!;
    const data = revertedNode.get('data') as {
      label: string;
      style: { fillColor: string; fontSize: number };
    };
    expect(data.label).toBe('【人工终审】放款审批文案');
    expect(data.style.fillColor).toBe('#FFFFFF');
    expect(data.style.fontSize).toBe(12);

    // 6. 账本持久化状态同步更新
    const batches = batchManager.getBatches(diag.id);
    expect(batches[0].status).toBe('partially_reverted');
    expect(batches[0].diffs[0].reverted).toBe(true);

    db.close();
  });

  it('人工调整过坐标时，撤回 AI 更新仅还原文案，不抢占人工位置', async () => {
    const db = initDatabase(tmpDbPath);
    const repo = new DiagramRepository(db);
    const batchManager = new AiBatchManager(repo);
    const diag = repo.createDiagram({ title: '坐标人工优先图' });

    const seed = new Y.Doc();
    const node = new Y.Map<unknown>();
    node.set('id', 'n-2');
    node.set('type', 'process');
    node.set('position', { x: 0, y: 0 });
    node.set('data', { label: '原始步骤', type: 'process' });
    seed.getMap('nodes').set('n-2', node);
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(seed));

    const before = snapshotMap(node);

    // AI 同时修改文案与坐标
    const aiDoc = readDoc(repo, diag.id);
    const aiNode = aiDoc.getMap<Y.Map<unknown>>('nodes').get('n-2')!;
    aiNode.set('position', { x: 100, y: 100 });
    aiNode.set('data', { label: 'AI 改写文案', type: 'process' });
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(aiDoc));
    const after = snapshotMap(aiNode);

    batchManager.recordBatch({
      batchId: 'batch-field-2',
      diagramId: diag.id,
      summary: 'AI 移动并改写',
      status: 'active',
      diffs: [
        {
          entityId: 'n-2',
          entityType: 'node',
          opType: 'update',
          beforeState: before,
          afterState: after,
        },
      ],
      createdAt: new Date().toISOString(),
    });

    // 同事手工把节点拖到别处
    const humanDoc = readDoc(repo, diag.id);
    humanDoc.getMap<Y.Map<unknown>>('nodes').get('n-2')!.set('position', { x: 300, y: 300 });
    repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(humanDoc));

    const res = await batchManager.revertBatch(diag.id, 'batch-field-2');
    expect(res.success).toBe(true);
    expect(res.skipped.some((item) => item.field === 'position')).toBe(true);

    const revertedDoc = readDoc(repo, diag.id);
    const revertedNode = revertedDoc.getMap<Y.Map<unknown>>('nodes').get('n-2')!;
    expect(revertedNode.get('position')).toEqual({ x: 300, y: 300 });
    expect((revertedNode.get('data') as { label: string }).label).toBe('原始步骤');

    db.close();
  });
});

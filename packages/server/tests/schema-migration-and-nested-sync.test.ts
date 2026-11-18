import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as Y from 'yjs';
import {
  initDatabase,
  runDatabaseMigrations,
  CURRENT_DB_VERSION,
  type DatabaseMigration,
} from '../src/db/database.js';
import { DiagramRepository } from '../src/db/diagram-repository.js';
import { SqlitePersistenceExtension } from '../src/collaboration/sqlite-extension.js';
import {
  CURRENT_SCHEMA_VERSION,
  migrateYDocSchema,
  getNestedNodeData,
  setNestedNodeData,
} from '../src/collaboration/shared-maps.js';

describe('Schema Migration and Nested Conflict-Free Sync', () => {
  let tmpDbPath: string;

  beforeEach(() => {
    tmpDbPath = path.join(
      os.tmpdir(),
      `fs-migration-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`,
    );
  });

  afterEach(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        if (fs.existsSync(tmpDbPath + suffix)) {
          fs.unlinkSync(tmpDbPath + suffix);
        }
      } catch {
        // 忽略临时文件释放异常
      }
    }
  });

  describe('SQLite PRAGMA user_version 迁移流水线', () => {
    it('初始化时读取 user_version 并顺序执行迁移脚本至最新版本', () => {
      const db = initDatabase(tmpDbPath);
      const version = db.pragma('user_version', { simple: true }) as number;
      expect(version).toBe(CURRENT_DB_VERSION);
      expect(version).toBeGreaterThanOrEqual(1);

      // 验证核心表已创建
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as Array<{ name: string }>;
      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain('diagrams');
      expect(tableNames).toContain('snapshots');
      expect(tableNames).toContain('ai_batches');

      db.close();
    });

    it('重复执行迁移流水线具备幂等性', () => {
      const db1 = initDatabase(tmpDbPath);
      const v1 = db1.pragma('user_version', { simple: true }) as number;
      db1.close();

      const db2 = initDatabase(tmpDbPath);
      const v2 = db2.pragma('user_version', { simple: true }) as number;
      expect(v2).toBe(v1);
      db2.close();
    });

    it('支持按版本序列扩展自定义迁移脚本并递增 version', () => {
      const db = initDatabase(':memory:');
      const startVersion = db.pragma('user_version', { simple: true }) as number;

      const executed: number[] = [];
      const testMigrations: DatabaseMigration[] = [
        {
          version: startVersion + 1,
          name: 'test_add_dummy_column',
          up: (database) => {
            executed.push(startVersion + 1);
            database.exec('CREATE TABLE test_extra (id TEXT PRIMARY KEY)');
          },
        },
        {
          version: startVersion + 2,
          name: 'test_add_dummy_column_2',
          up: (database) => {
            executed.push(startVersion + 2);
            database.exec('ALTER TABLE test_extra ADD COLUMN notes TEXT');
          },
        },
      ];

      runDatabaseMigrations(db, testMigrations);
      expect(executed).toEqual([startVersion + 1, startVersion + 2]);
      expect(db.pragma('user_version', { simple: true })).toBe(startVersion + 2);

      // 再次执行，幂等跳过
      runDatabaseMigrations(db, testMigrations);
      expect(executed).toEqual([startVersion + 1, startVersion + 2]);

      db.close();
    });
  });

  describe('Y.Doc Schema 版本升级与向后兼容 (onLoadDocument)', () => {
    it('老版本 Y.Doc（schemaVersion 缺失）在 onLoadDocument 时自动补全为最新 schemaVersion: 2 且数据零丢失', async () => {
      const db = initDatabase(tmpDbPath);
      const repo = new DiagramRepository(db);
      const diag = repo.createDiagram({ title: '老版本测试图' });

      // 构建一个没有 schemaVersion 的老版本 Y.Doc
      const legacyDoc = new Y.Doc();
      legacyDoc.getMap('meta').set('title', '老版本测试图');

      const nodeMap = new Y.Map<unknown>();
      nodeMap.set('id', 'node-legacy-1');
      nodeMap.set('type', 'process');
      nodeMap.set('position', { x: 100, y: 150 });
      nodeMap.set('data', {
        label: '老旧文本',
        type: 'process',
        customField: '保留字段',
        style: { backgroundColor: '#ffffff', fontSize: 14 },
      });
      legacyDoc.getMap('nodes').set('node-legacy-1', nodeMap);

      const edgeMap = new Y.Map<unknown>();
      edgeMap.set('id', 'edge-1');
      edgeMap.set('source', 'node-legacy-1');
      edgeMap.set('target', 'node-legacy-2');
      legacyDoc.getMap('edges').set('edge-1', edgeMap);

      // 持久化老版本二进制状态
      repo.saveYDocState(diag.id, Y.encodeStateAsUpdate(legacyDoc));
      legacyDoc.destroy();

      // 模拟协作服务通过 onLoadDocument 加载
      const extension = new SqlitePersistenceExtension(repo);
      const loadedDoc = new Y.Doc();
      await extension.onLoadDocument({
        documentName: diag.id,
        document: loadedDoc,
      } as any);

      // 验证版本号已自动补全为 2
      expect(loadedDoc.getMap('meta').get('schemaVersion')).toBe(CURRENT_SCHEMA_VERSION);
      expect(CURRENT_SCHEMA_VERSION).toBe(2);

      // 验证节点、连线与属性数据零丢失
      expect(loadedDoc.getMap('nodes').has('node-legacy-1')).toBe(true);
      expect(loadedDoc.getMap('edges').has('edge-1')).toBe(true);

      const migratedNode = loadedDoc.getMap<Y.Map<unknown>>('nodes').get('node-legacy-1')!;
      expect(migratedNode.get('type')).toBe('process');
      expect(migratedNode.get('position')).toEqual({ x: 100, y: 150 });

      // 读取节点数据，所有属性完好无损
      const nodeData = getNestedNodeData(migratedNode);
      expect(nodeData.label).toBe('老旧文本');
      expect(nodeData.customField).toBe('保留字段');
      expect(nodeData.style).toEqual({ backgroundColor: '#ffffff', fontSize: 14 });

      loadedDoc.destroy();
      db.close();
    });

    it('老版本 Y.Doc（schemaVersion: 1）调用 migrateYDocSchema 幂等升级', () => {
      const doc = new Y.Doc();
      doc.getMap('meta').set('schemaVersion', 1);

      const nodeMap = new Y.Map<unknown>();
      nodeMap.set('id', 'n-1');
      nodeMap.set('data', { label: 'V1 节点', style: { color: '#000' } });
      doc.getMap('nodes').set('n-1', nodeMap);

      migrateYDocSchema(doc);
      expect(doc.getMap('meta').get('schemaVersion')).toBe(2);

      const data = getNestedNodeData(doc.getMap<Y.Map<unknown>>('nodes').get('n-1')!);
      expect(data.label).toBe('V1 节点');
      expect(data.style).toEqual({ color: '#000' });

      // 重复调用幂等
      migrateYDocSchema(doc);
      expect(doc.getMap('meta').get('schemaVersion')).toBe(2);
      doc.destroy();
    });
  });

  describe('并发字段级无冲突嵌套协同 (Concurrent Field-Level Merge)', () => {
    it('客户端 A 修改 label、客户端 B 修改 style.backgroundColor，增量合并后双方保留且无整包覆盖', () => {
      // 1. 初始化基准文档（schemaVersion: 2，具备嵌套 CRDT 属性结构）
      const baseDoc = new Y.Doc();
      baseDoc.getMap('meta').set('schemaVersion', CURRENT_SCHEMA_VERSION);
      const baseNode = new Y.Map<unknown>();
      baseNode.set('id', 'task-node-1');
      baseNode.set('type', 'process');
      baseDoc.getMap('nodes').set('task-node-1', baseNode);

      setNestedNodeData(baseNode, {
        label: '原始标题',
        type: 'process',
        style: { backgroundColor: '#ffffff', fontSize: 14 },
      });

      const initialState = Y.encodeStateAsUpdate(baseDoc);

      // 2. 模拟客户端 A 和客户端 B 分别载入相同基线
      const clientADoc = new Y.Doc();
      Y.applyUpdate(clientADoc, initialState);

      const clientBDoc = new Y.Doc();
      Y.applyUpdate(clientBDoc, initialState);

      const nodeA = clientADoc.getMap<Y.Map<unknown>>('nodes').get('task-node-1')!;
      const nodeB = clientBDoc.getMap<Y.Map<unknown>>('nodes').get('task-node-1')!;

      // 3. 客户端 A 并发修改 label = '新标题'
      clientADoc.transact(() => {
        setNestedNodeData(nodeA, { label: '新标题' });
      }, 'client-a');

      // 4. 客户端 B 并发修改 style.backgroundColor = '#ff0000'
      clientBDoc.transact(() => {
        setNestedNodeData(nodeB, {
          style: { backgroundColor: '#ff0000' },
        });
      }, 'client-b');

      // 5. 互相交换双向增量更新
      const updateA = Y.encodeStateAsUpdate(clientADoc);
      const updateB = Y.encodeStateAsUpdate(clientBDoc);

      Y.applyUpdate(clientADoc, updateB);
      Y.applyUpdate(clientBDoc, updateA);

      // 6. 验证收敛状态：两端完全一致，同时包含新标题和新背景色，且未被覆盖！
      const finalDataA = getNestedNodeData(nodeA);
      const finalDataB = getNestedNodeData(nodeB);

      expect(finalDataA).toEqual(finalDataB);
      expect(finalDataA.label).toBe('新标题');
      expect((finalDataA.style as Record<string, unknown>).backgroundColor).toBe('#ff0000');
      // 原有未修改的 style.fontSize 也得以保留
      expect((finalDataA.style as Record<string, unknown>).fontSize).toBe(14);

      baseDoc.destroy();
      clientADoc.destroy();
      clientBDoc.destroy();
    });

    it('原生嵌套 Y.Map 操作与细粒度合并', () => {
      const docA = new Y.Doc();
      const nodeA = new Y.Map<unknown>();
      nodeA.set('id', 'n-sync');
      docA.getMap('nodes').set('n-sync', nodeA);

      setNestedNodeData(nodeA, {
        label: '原文本',
        style: { color: '#111111', fontSize: 12 },
      });

      const docB = new Y.Doc();
      Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

      const nodeB = docB.getMap<Y.Map<unknown>>('nodes').get('n-sync')!;

      // A 修改文本
      const dataMapA = nodeA.get('data') as Y.Map<unknown>;
      dataMapA.set('label', '客户A修改文本');

      // B 修改样式中某个子字段
      const dataMapB = nodeB.get('data') as Y.Map<unknown>;
      const styleMapB = dataMapB.get('style') as Y.Map<unknown>;
      styleMapB.set('color', '#ff5500');

      // 交叉合并
      Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
      Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

      const resA = getNestedNodeData(nodeA);
      const resB = getNestedNodeData(nodeB);
      expect(resA.label).toBe('客户A修改文本');
      expect((resA.style as Record<string, unknown>).color).toBe('#ff5500');
      expect((resA.style as Record<string, unknown>).fontSize).toBe(12);
      expect(resA).toEqual(resB);

      docA.destroy();
      docB.destroy();
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { initDatabase } from '../src/db/database.js';
import { DiagramRepository } from '../src/db/diagram-repository.js';
import type Database from 'better-sqlite3';

describe('DiagramRepository', () => {
  let db: Database.Database;
  let repo: DiagramRepository;

  beforeEach(() => {
    db = initDatabase(':memory:');
    repo = new DiagramRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('supports create, search list, update, and delete', () => {
    const d1 = repo.createDiagram({ title: '订单履约主流程', description: '核心链路' });
    repo.createDiagram({ title: '退货逆向流程' });

    expect(repo.listDiagrams().length).toBe(2);
    expect(repo.listDiagrams('退货').length).toBe(1);

    const updated = repo.updateDiagram(d1.id, { title: '订单履约 V2', thumbnail: '<svg></svg>' });
    expect(updated?.title).toBe('订单履约 V2');
    expect(updated?.thumbnail).toBe('<svg></svg>');

    expect(repo.deleteDiagram(d1.id)).toBe(true);
    expect(repo.getDiagramById(d1.id)).toBeNull();
  });

  it('persists Y.Doc state and duplicates diagram with deep-copied Y.Doc state', () => {
    const src = repo.createDiagram({ title: '原流程图', thumbnail: '<svg id="thumb"/>' });

    const doc = new Y.Doc();
    doc.getMap('meta').set('title', '原流程图');
    const nodes = doc.getMap('nodes');
    const n1 = new Y.Map();
    n1.set('id', 'node-1');
    n1.set('label', '开始');
    nodes.set('node-1', n1);

    repo.saveYDocState(src.id, Y.encodeStateAsUpdate(doc));

    const copy = repo.duplicateDiagram(src.id);
    expect(copy).not.toBeNull();
    expect(copy!.id).not.toBe(src.id);
    expect(copy!.title).toBe('原流程图 (副本)');
    expect(copy!.thumbnail).toBe('<svg id="thumb"/>');

    const copyUpdate = repo.getYDocState(copy!.id);
    expect(copyUpdate).not.toBeNull();
    const copyDoc = new Y.Doc();
    Y.applyUpdate(copyDoc, copyUpdate!);
    expect(copyDoc.getMap('meta').get('title')).toBe('原流程图 (副本)');
    expect(copyDoc.getMap('nodes').has('node-1')).toBe(true);
  });
});

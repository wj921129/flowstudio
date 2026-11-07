import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { initDatabase } from '../src/db/database.js';
import { DiagramRepository } from '../src/db/diagram-repository.js';
import { SqlitePersistenceExtension } from '../src/collaboration/sqlite-extension.js';

describe('SqlitePersistenceExtension', () => {
  let repo: DiagramRepository;
  let ext: SqlitePersistenceExtension;

  beforeEach(() => {
    const db = initDatabase(':memory:');
    repo = new DiagramRepository(db);
    ext = new SqlitePersistenceExtension(repo);
  });

  it('loads existing Y.Doc state from SQLite and stores updates back', async () => {
    const diagram = repo.createDiagram({ title: '初始标题' });
    const seedDoc = new Y.Doc();
    seedDoc.getMap('meta').set('title', '协同修改后标题');
    seedDoc.getMap('nodes').set('n1', new Y.Map([['id', 'n1']]));

    await ext.onStoreDocument({
      documentName: diagram.id,
      document: seedDoc,
    } as any);

    // 验证标题与二进制状态均已落盘
    expect(repo.getDiagramById(diagram.id)?.title).toBe('协同修改后标题');

    const targetDoc = new Y.Doc();
    await ext.onLoadDocument({
      documentName: diagram.id,
      document: targetDoc,
    } as any);

    expect(targetDoc.getMap('meta').get('title')).toBe('协同修改后标题');
    expect(targetDoc.getMap('nodes').has('n1')).toBe(true);
  });
});

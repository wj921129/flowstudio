import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { initDatabase } from '../src/db/database.js';
import { DiagramRepository } from '../src/db/diagram-repository.js';
import { DocumentWriter } from '../src/collaboration/document-writer.js';
import { SqlitePersistenceExtension } from '../src/collaboration/sqlite-extension.js';
import { clearStaleEmptyThumbnails } from '../src/db/thumbnail-hygiene.js';

const STALE_SVG = '<svg><rect width="10" height="10"/></svg>';

function seedNode(repo: DiagramRepository, diagramId: string, nodeId: string): void {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, repo.getYDocState(diagramId)!);
  doc.getMap('nodes').set(nodeId, new Y.Map([['id', nodeId], ['type', 'process']]));
  repo.saveYDocState(diagramId, Y.encodeStateAsUpdate(doc));
  doc.destroy();
}

describe('空 ydoc 陈旧缩略图数据卫生', () => {
  it('仅清空 0 节点图的陈旧缩略图，健康图缩略图与 updated_at 无损', () => {
    const db = initDatabase(':memory:');
    const repo = new DiagramRepository(db);

    const stale = repo.createDiagram({ title: '空图', thumbnail: STALE_SVG });
    const healthy = repo.createDiagram({ title: '健康图', thumbnail: STALE_SVG });
    const emptyClean = repo.createDiagram({ title: '空图无缩略图' });
    seedNode(repo, healthy.id, 'n1');

    const staleUpdatedAt = repo.getDiagramById(stale.id)!.updatedAt;

    const report = clearStaleEmptyThumbnails(repo);

    expect(report.scanned).toBe(3);
    expect(report.cleared).toEqual([stale.id]);
    expect(repo.getDiagramById(stale.id)!.thumbnail).toBe('');
    expect(repo.getDiagramById(stale.id)!.updatedAt).toBe(staleUpdatedAt);
    expect(repo.getDiagramById(healthy.id)!.thumbnail).toBe(STALE_SVG);
    expect(repo.getDiagramById(emptyClean.id)!.thumbnail).toBe('');

    expect(clearStaleEmptyThumbnails(repo).cleared).toEqual([]);
    db.close();
  });

  it('onStoreDocument 落库空文档时同步清空陈旧缩略图，非空文档保留缩略图', async () => {
    const db = initDatabase(':memory:');
    const repo = new DiagramRepository(db);
    const ext = new SqlitePersistenceExtension(repo);

    const diagram = repo.createDiagram({ title: '协同清空图', thumbnail: STALE_SVG });
    seedNode(repo, diagram.id, 'n1');

    const withNode = new Y.Doc();
    Y.applyUpdate(withNode, repo.getYDocState(diagram.id)!);
    await ext.onStoreDocument({ documentName: diagram.id, document: withNode } as any);
    expect(repo.getDiagramById(diagram.id)!.thumbnail).toBe(STALE_SVG);
    withNode.destroy();

    const emptied = new Y.Doc();
    Y.applyUpdate(emptied, repo.getYDocState(diagram.id)!);
    emptied.getMap('nodes').delete('n1');
    await ext.onStoreDocument({ documentName: diagram.id, document: emptied } as any);
    expect(repo.getDiagramById(diagram.id)!.thumbnail).toBe('');
    emptied.destroy();

    db.close();
  });

  it('DocumentWriter.mutate 清空节点后同步清空陈旧缩略图', async () => {
    const db = initDatabase(':memory:');
    const repo = new DiagramRepository(db);
    const writer = new DocumentWriter(repo);

    const diagram = repo.createDiagram({ title: 'AI 清空图', thumbnail: STALE_SVG });
    seedNode(repo, diagram.id, 'n1');

    await writer.mutate(diagram.id, 'ai:test-clear', (doc) => {
      doc.getMap('nodes').delete('n1');
    });

    expect(repo.getDiagramById(diagram.id)!.thumbnail).toBe('');
    db.close();
  });
});

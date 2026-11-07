import type { Extension, onLoadDocumentPayload, onStoreDocumentPayload } from '@hocuspocus/server';
import * as Y from 'yjs';
import type { DiagramRepository } from '../db/diagram-repository.js';

export class SqlitePersistenceExtension implements Extension {
  constructor(private repo: DiagramRepository) {}

  async onLoadDocument(data: onLoadDocumentPayload): Promise<void> {
    const { documentName, document } = data;
    const existingState = this.repo.getYDocState(documentName);

    if (existingState && existingState.byteLength > 0) {
      Y.applyUpdate(document, existingState);
    } else {
      // 若数据库无二进制状态，但有图元记录，初始化 meta 标题
      const meta = this.repo.getDiagramById(documentName);
      if (meta) {
        document.getMap('meta').set('title', meta.title);
      }
    }
  }

  async onStoreDocument(data: onStoreDocumentPayload): Promise<void> {
    const { documentName, document } = data;
    const update = Y.encodeStateAsUpdate(document);
    const metaTitle = document.getMap('meta').get('title');
    const title = typeof metaTitle === 'string' ? metaTitle : undefined;

    this.repo.saveYDocState(documentName, update, title);
  }
}

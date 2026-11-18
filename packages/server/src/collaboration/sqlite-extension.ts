import type { Extension, onLoadDocumentPayload, onStoreDocumentPayload } from '@hocuspocus/server';
import * as Y from 'yjs';
import type { DiagramRepository } from '../db/diagram-repository.js';
import type { SaveStatusTracker } from './save-status.js';

export class SqlitePersistenceExtension implements Extension {
  constructor(
    private repo: DiagramRepository,
    private saveStatus?: SaveStatusTracker,
  ) {}

  async onLoadDocument(data: onLoadDocumentPayload): Promise<void> {
    const { documentName, document } = data;
    const existingState = this.repo.getYDocState(documentName);

    if (!existingState || existingState.byteLength === 0) {
      const meta = this.repo.getDiagramById(documentName);
      if (meta) {
        document.getMap('meta').set('title', meta.title);
      }
      return;
    }

    Y.applyUpdate(document, existingState);
  }

  async onStoreDocument(data: onStoreDocumentPayload): Promise<void> {
    const { documentName, document } = data;
    const update = Y.encodeStateAsUpdate(document);
    const metaTitle = document.getMap('meta').get('title');
    const title = typeof metaTitle === 'string' ? metaTitle : undefined;

    const saved = this.repo.saveYDocState(documentName, update, title);
    if (!saved) return;

    this.saveStatus?.markSaved(documentName);
    if (document.getMap('nodes').size === 0) {
      this.repo.clearThumbnail(documentName);
    }
  }
}

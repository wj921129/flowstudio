import type { Extension, onLoadDocumentPayload, onStoreDocumentPayload } from '@hocuspocus/server';
import * as Y from 'yjs';
import type { DiagramRepository } from '../db/diagram-repository.js';
import type { SaveStatusTracker } from './save-status.js';
import { compactYDocState } from './yjs-compaction.js';

export class SqlitePersistenceExtension implements Extension {
  constructor(
    private repo: DiagramRepository,
    private saveStatus?: SaveStatusTracker,
  ) {}

  async onLoadDocument(data: onLoadDocumentPayload): Promise<void> {
    const { documentName, document } = data;
    let existingState = this.repo.getYDocState(documentName);

    if (!existingState || existingState.byteLength === 0) {
      // 若数据库无二进制状态，但有图元记录，初始化 meta 标题
      const meta = this.repo.getDiagramById(documentName);
      if (meta) {
        document.getMap('meta').set('title', meta.title);
      }
      return;
    }

    // 膨胀状态的 applyUpdate 会独占主线程数十秒，先在线程里剥离历史垃圾
    const compacted = await compactYDocState(existingState);
    if (compacted) {
      this.repo.replaceYDocState(documentName, compacted);
      existingState = compacted;
    }

    Y.applyUpdate(document, existingState);
  }

  async onStoreDocument(data: onStoreDocumentPayload): Promise<void> {
    const { documentName, document } = data;
    const update = Y.encodeStateAsUpdate(document);
    const metaTitle = document.getMap('meta').get('title');
    const title = typeof metaTitle === 'string' ? metaTitle : undefined;

    // 仍持有膨胀历史的旧客户端会把大状态写回来，落库前再压一次守住体积上限
    const compacted = await compactYDocState(update);

    const saved = this.repo.saveYDocState(documentName, compacted ?? update, title);
    if (!saved) return;

    this.saveStatus?.markSaved(documentName);
    if (document.getMap('nodes').size === 0) {
      this.repo.clearThumbnail(documentName);
    }
  }
}

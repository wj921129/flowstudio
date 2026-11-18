import { Hocuspocus } from '@hocuspocus/server';
import type { DiagramRepository } from '../db/diagram-repository.js';
import type { SaveStatusTracker } from './save-status.js';
import { SqlitePersistenceExtension } from './sqlite-extension.js';

export interface CollaborationServerOptions {
  debounce?: number;
  maxDebounce?: number;
  saveStatus?: SaveStatusTracker;
}

export function createCollaborationServer(
  repo: DiagramRepository,
  options?: CollaborationServerOptions,
): Hocuspocus {
  return new Hocuspocus({
    debounce: options?.debounce ?? 500,
    maxDebounce: options?.maxDebounce ?? 2000,
    extensions: [new SqlitePersistenceExtension(repo, options?.saveStatus)],
  });
}

export async function closeCollaborationServer(hocuspocus: Hocuspocus): Promise<void> {
  hocuspocus.closeConnections();

  const debouncer = (hocuspocus as unknown as {
    debouncer?: { isDebounced?: (id: string) => boolean; isCurrentlyExecuting?: (id: string) => boolean };
  }).debouncer;

  let confirmedQuiescent = false;
  for (;;) {
    if (hocuspocus.loadingDocuments.size > 0) {
      await Promise.allSettled([...hocuspocus.loadingDocuments.values()]);
      hocuspocus.closeConnections();
      confirmedQuiescent = false;
    }

    hocuspocus.flushPendingStores();

    const lockWaits: Promise<void>[] = [];
    for (const doc of hocuspocus.documents.values()) {
      if (doc.saveMutex.isLocked()) {
        lockWaits.push(doc.saveMutex.waitForUnlock());
      }
    }
    if (lockWaits.length > 0) {
      await Promise.allSettled(lockWaits);
      confirmedQuiescent = false;
      continue;
    }

    if (hocuspocus.unloadingDocuments.size > 0) {
      await Promise.allSettled([...hocuspocus.unloadingDocuments.values()]);
      confirmedQuiescent = false;
      continue;
    }

    const hasPendingDebounce = [...hocuspocus.documents.values()].some((doc) => {
      const id = `onStoreDocument-${doc.name}`;
      return !doc.isLoading && Boolean(debouncer?.isDebounced?.(id) || debouncer?.isCurrentlyExecuting?.(id));
    });
    if (hasPendingDebounce) {
      await new Promise<void>((r) => setTimeout(r, 0));
      confirmedQuiescent = false;
      continue;
    }

    if (hocuspocus.documents.size === 0 && hocuspocus.loadingDocuments.size === 0) {
      break;
    }
    if (confirmedQuiescent) {
      break;
    }
    confirmedQuiescent = true;
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

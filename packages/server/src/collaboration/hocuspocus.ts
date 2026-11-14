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

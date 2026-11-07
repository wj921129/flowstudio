import { Server as HocuspocusServer } from '@hocuspocus/server';
import type { DiagramRepository } from '../db/diagram-repository.js';
import { SqlitePersistenceExtension } from './sqlite-extension.js';

export interface CollaborationServerOptions {
  debounce?: number;
  maxDebounce?: number;
}

export function createCollaborationServer(
  repo: DiagramRepository,
  options?: CollaborationServerOptions,
): HocuspocusServer {
  return new HocuspocusServer({
    debounce: options?.debounce ?? 500,
    maxDebounce: options?.maxDebounce ?? 2000,
    extensions: [new SqlitePersistenceExtension(repo)],
  });
}

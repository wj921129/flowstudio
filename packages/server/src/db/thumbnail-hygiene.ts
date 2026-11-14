import * as Y from 'yjs';
import type { DiagramRepository } from './diagram-repository.js';

export interface ThumbnailHygieneReport {
  scanned: number;
  cleared: string[];
}

export function clearStaleEmptyThumbnails(repo: DiagramRepository): ThumbnailHygieneReport {
  const rows = repo.listDiagramStates();
  const cleared: string[] = [];

  for (const row of rows) {
    if (!row.thumbnail.trim()) continue;
    if (countNodes(row.ydocState) > 0) continue;
    if (repo.clearThumbnail(row.id)) cleared.push(row.id);
  }

  return { scanned: rows.length, cleared };
}

function countNodes(state: Uint8Array | null): number {
  if (!state || state.byteLength === 0) return 0;
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    return doc.getMap('nodes').size;
  } catch {
    return 1;
  } finally {
    doc.destroy();
  }
}

import type { DiagramRepository } from '../db/diagram-repository.js';

export class SaveStatusTracker {
  private lastSavedAt = new Map<string, string>();

  constructor(private repo: DiagramRepository) {}

  markSaved(diagramId: string, at: string = new Date().toISOString()): void {
    this.lastSavedAt.set(diagramId, at);
  }

  getLastSavedAt(diagramId: string): string | null {
    return this.lastSavedAt.get(diagramId) ?? this.repo.getDiagramById(diagramId)?.updatedAt ?? null;
  }
}

import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import type { SnapshotSummary } from '@flowstudio/shared';
import type { DiagramRepository } from '../db/diagram-repository.js';
import type { DocumentWriter } from './document-writer.js';

export interface AutoSnapshotOptions {
  intervalMs?: number;
  label?: string;
}

const DEFAULT_INTERVAL_MS = 5 * 60_000;
const DEFAULT_LABEL = '定时自动快照';

export class AutoSnapshotScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private fingerprints = new Map<string, string>();

  constructor(
    private repo: DiagramRepository,
    private writer: DocumentWriter,
    private options: AutoSnapshotOptions = {},
  ) {}

  start(): void {
    if (this.timer) return;
    this.captureBaseline();
    this.timer = setInterval(() => this.runOnce(), this.options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  runOnce(): SnapshotSummary[] {
    const created: SnapshotSummary[] = [];
    const alive = new Set<string>();

    for (const { id } of this.repo.listDiagrams()) {
      alive.add(id);
      const state = this.readState(id);
      if (!state || state.byteLength === 0) continue;

      const fingerprint = createHash('sha256').update(state).digest('hex');
      const previous = this.fingerprints.get(id);
      this.fingerprints.set(id, fingerprint);
      if (!previous || previous === fingerprint) continue;

      created.push(
        this.repo.createSnapshotFromState(id, state, this.options.label ?? DEFAULT_LABEL, 'timer'),
      );
    }

    for (const id of [...this.fingerprints.keys()]) {
      if (!alive.has(id)) this.fingerprints.delete(id);
    }

    return created;
  }

  private captureBaseline(): void {
    this.fingerprints.clear();
    for (const { id } of this.repo.listDiagrams()) {
      const state = this.readState(id);
      if (!state || state.byteLength === 0) continue;
      this.fingerprints.set(id, createHash('sha256').update(state).digest('hex'));
    }
  }

  private readState(diagramId: string): Uint8Array | null {
    const live = this.writer.getLiveDocument(diagramId);
    if (live) return Y.encodeStateAsUpdate(live);
    return this.repo.getYDocState(diagramId);
  }
}

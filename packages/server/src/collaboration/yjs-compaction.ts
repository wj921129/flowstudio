import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker, type WorkerOptions } from 'node:worker_threads';
import * as Y from 'yjs';
import type { DiagramRepository } from '../db/diagram-repository.js';
import { rebuildCleanYDocState } from './yjs-compaction-worker.js';

export const COMPACT_THRESHOLD_BYTES = 2 * 1024 * 1024;
const MIN_SAVINGS_RATIO = 0.5;
const WORKER_MAX_OLD_GEN_MB = 3072;

const workerUrl = new URL('./yjs-compaction-worker.js', import.meta.url);

type EsmWorkerOptions = WorkerOptions & { type: 'module' };

export interface CompactOptions {
  force?: boolean;
  minSavingsRatio?: number;
  useWorker?: boolean;
}

export interface OfflineCompactResult {
  compacted: boolean;
  beforeBytes: number;
  afterBytes: number;
  docEpoch?: number;
}

function runCompactionWorker(update: Uint8Array): Promise<ArrayBuffer | null> {
  return new Promise((resolve) => {
    const options: EsmWorkerOptions = {
      type: 'module',
      workerData: { update },
      resourceLimits: { maxOldGenerationSizeMb: WORKER_MAX_OLD_GEN_MB },
    };
    const worker = new Worker(workerUrl, options);

    let settled = false;
    const settle = (value: ArrayBuffer | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
      void worker.terminate();
    };

    worker.on('message', (message: { bytes?: ArrayBuffer }) => {
      settle(message.bytes ?? null);
    });
    worker.on('error', () => settle(null));
    worker.on('exit', () => settle(null));
  });
}

function canUseCompiledWorker(): boolean {
  try {
    return fs.existsSync(fileURLToPath(workerUrl));
  } catch {
    return false;
  }
}

/**
 * 显式离线状态清洗：剥离 CRDT 历史垃圾、保留全量顶层容器（含 comments）并递增 meta.docEpoch
 */
export async function compactYDocState(
  update: Uint8Array,
  options?: CompactOptions,
): Promise<Uint8Array | null> {
  const force = options?.force ?? false;
  if (!force && update.byteLength < COMPACT_THRESHOLD_BYTES) return null;

  let compacted: Uint8Array | null;
  if (options?.useWorker !== false && canUseCompiledWorker()) {
    const bytes = await runCompactionWorker(update);
    compacted = bytes ? new Uint8Array(bytes) : null;
  } else {
    compacted = rebuildCleanYDocState(update);
  }

  if (!compacted) return null;
  const ratio = options?.minSavingsRatio ?? MIN_SAVINGS_RATIO;
  if (!force && compacted.byteLength >= update.byteLength * ratio) return null;

  return compacted;
}

export async function compactDiagramStateOffline(
  repo: DiagramRepository,
  diagramId: string,
  options?: CompactOptions,
): Promise<OfflineCompactResult> {
  const current = repo.getYDocState(diagramId);
  if (!current || current.byteLength === 0) {
    return { compacted: false, beforeBytes: 0, afterBytes: 0 };
  }

  const compacted = await compactYDocState(current, options);
  if (!compacted) {
    return {
      compacted: false,
      beforeBytes: current.byteLength,
      afterBytes: current.byteLength,
    };
  }

  repo.replaceYDocState(diagramId, compacted);
  const doc = new Y.Doc();
  let docEpoch: number | undefined;
  try {
    Y.applyUpdate(doc, compacted);
    const rawEpoch = doc.getMap('meta').get('docEpoch');
    if (typeof rawEpoch === 'number') docEpoch = rawEpoch;
  } finally {
    doc.destroy();
  }

  return {
    compacted: true,
    beforeBytes: current.byteLength,
    afterBytes: compacted.byteLength,
    docEpoch,
  };
}

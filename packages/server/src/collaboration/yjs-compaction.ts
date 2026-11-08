import { Worker, type WorkerOptions } from 'node:worker_threads';

/**
 * 超过该体积的 Y.Doc 状态被视为携带了过量 CRDT 历史，交给线程压缩。
 */
export const COMPACT_THRESHOLD_BYTES = 2 * 1024 * 1024;

/**
 * 压缩后至少要比原始状态小到该比例才值得替换，避免大图被反复无效压缩。
 */
const MIN_SAVINGS_RATIO = 0.5;

/**
 * 压缩单张图需要重建整棵结构树，实测 45MB 状态峰值堆内存约 2GB。
 */
const WORKER_MAX_OLD_GEN_MB = 3072;

const workerUrl = new URL('./yjs-compaction-worker.js', import.meta.url);

// @types/node 尚未收录 Worker 的 type 选项，但 Node 20/22 运行时必须显式声明才能加载 ESM worker
type EsmWorkerOptions = WorkerOptions & { type: 'module' };

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

/**
 * 剥离 Y.Doc 状态中的 CRDT 历史垃圾，只保留可见图数据。
 * 返回 null 表示无需压缩、压缩无收益或工作线程失败，调用方按原始状态继续。
 */
export async function compactYDocState(update: Uint8Array): Promise<Uint8Array | null> {
  if (update.byteLength < COMPACT_THRESHOLD_BYTES) return null;

  const bytes = await runCompactionWorker(update);
  if (!bytes) return null;

  const compacted = new Uint8Array(bytes);
  if (compacted.byteLength >= update.byteLength * MIN_SAVINGS_RATIO) return null;

  return compacted;
}

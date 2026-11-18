import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import * as Y from 'yjs';
import { YDOC_TOP_LEVEL_MAPS } from '@flowstudio/shared';

function copyNestedMap(src: Y.Map<unknown>, dst: Y.Map<unknown>): void {
  src.forEach((value, key) => {
    if (value instanceof Y.Map) {
      const inner = new Y.Map<unknown>();
      value.forEach((fieldValue, fieldKey) => {
        inner.set(fieldKey, fieldValue);
      });
      dst.set(key, inner);
    } else {
      dst.set(key, value);
    }
  });
}

function copyFlatMap(src: Y.Map<unknown>, dst: Y.Map<unknown>): void {
  src.forEach((value, key) => {
    dst.set(key, value);
  });
}

export function rebuildCleanYDocState(update: Uint8Array): Uint8Array {
  const bloated = new Y.Doc();
  Y.applyUpdate(bloated, update);

  let maxClientId = 0;
  for (const clientId of bloated.store.clients.keys()) {
    if (clientId > maxClientId) maxClientId = clientId;
  }

  const fresh = new Y.Doc();
  // 确保新血缘 clientID 大于历史所有写入者，防止合并时旧 docEpoch 在 LWW 中胜出
  fresh.clientID = maxClientId < 0xffffffff ? maxClientId + 1 : 0xffffffff;
  try {
    fresh.transact(() => {
      for (const mapName of YDOC_TOP_LEVEL_MAPS) {
        if (mapName === 'meta') {
          copyFlatMap(bloated.getMap<unknown>(mapName), fresh.getMap<unknown>(mapName));
        } else {
          copyNestedMap(bloated.getMap<unknown>(mapName), fresh.getMap<unknown>(mapName));
        }
      }
      const prevEpoch = bloated.getMap<unknown>('meta').get('docEpoch');
      const baseEpoch = typeof prevEpoch === 'number' && Number.isFinite(prevEpoch) ? prevEpoch : 1;
      fresh.getMap<unknown>('meta').set('docEpoch', baseEpoch + 1);
    });
    return Y.encodeStateAsUpdate(fresh);
  } finally {
    bloated.destroy();
    fresh.destroy();
  }
}

if (!isMainThread && parentPort) {
  const compacted = rebuildCleanYDocState(new Uint8Array(workerData.update as ArrayBuffer));
  parentPort.postMessage({ bytes: compacted.slice().buffer });
}

import { parentPort, workerData } from 'node:worker_threads';
import * as Y from 'yjs';

/**
 * 节点/连线根表的下钻一层结构: key -> Y.Map<字段>
 */
function copyNestedMap(src: Y.Map<Y.Map<unknown>>, dst: Y.Map<Y.Map<unknown>>): void {
  src.forEach((value, key) => {
    const inner = new Y.Map<unknown>();
    value.forEach((fieldValue, fieldKey) => {
      inner.set(fieldKey, fieldValue);
    });
    dst.set(key, inner);
  });
}

function copyFlatMap(src: Y.Map<unknown>, dst: Y.Map<unknown>): void {
  src.forEach((value, key) => {
    dst.set(key, value);
  });
}

const bloated = new Y.Doc();
Y.applyUpdate(bloated, new Uint8Array(workerData.update as ArrayBuffer));

const fresh = new Y.Doc();
fresh.transact(() => {
  copyNestedMap(bloated.getMap<Y.Map<unknown>>('nodes'), fresh.getMap<Y.Map<unknown>>('nodes'));
  copyNestedMap(bloated.getMap<Y.Map<unknown>>('edges'), fresh.getMap<Y.Map<unknown>>('edges'));
  copyFlatMap(bloated.getMap<unknown>('meta'), fresh.getMap<unknown>('meta'));
});

const compacted = Y.encodeStateAsUpdate(fresh);
const view = compacted.slice().buffer;

bloated.destroy();
fresh.destroy();

parentPort!.postMessage({ bytes: view });

import type * as Y from 'yjs';

export interface DocEpochGuard {
  markSynced: () => void;
  destroy: () => void;
}

export function createDocEpochGuard(
  doc: Y.Doc,
  onEpochChanged: (nextEpoch: unknown, prevEpoch: unknown) => void,
): DocEpochGuard {
  const metaMap = doc.getMap<unknown>('meta');
  let baselineReady = false;
  let baselineEpoch: unknown = undefined;
  let triggered = false;

  const maybeNotify = (isRemote: boolean) => {
    if (!baselineReady || triggered || !isRemote) return;
    const currentEpoch = metaMap.get('docEpoch');
    if (currentEpoch !== baselineEpoch) {
      triggered = true;
      onEpochChanged(currentEpoch, baselineEpoch);
    }
  };

  const handleMetaChange = (event: Y.YMapEvent<unknown>, transaction: Y.Transaction) => {
    if (!event.keysChanged.has('docEpoch')) return;
    maybeNotify(!transaction.local);
  };

  metaMap.observe(handleMetaChange);

  return {
    markSynced() {
      const currentEpoch = metaMap.get('docEpoch');
      if (!baselineReady) {
        baselineReady = true;
        baselineEpoch = currentEpoch;
        return;
      }
      maybeNotify(true);
    },
    destroy() {
      metaMap.unobserve(handleMetaChange);
    },
  };
}

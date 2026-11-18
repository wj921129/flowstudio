import type * as Y from 'yjs';
import { YDOC_TOP_LEVEL_MAPS } from '@flowstudio/shared';

export { YDOC_TOP_LEVEL_MAPS };

export function getTopLevelMaps(doc: Y.Doc): Y.Map<unknown>[] {
  return YDOC_TOP_LEVEL_MAPS.map((name) => doc.getMap(name));
}

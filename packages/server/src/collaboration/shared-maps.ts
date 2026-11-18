import * as Y from 'yjs';
import { YDOC_TOP_LEVEL_MAPS } from '@flowstudio/shared';

export { YDOC_TOP_LEVEL_MAPS };

export const CURRENT_SCHEMA_VERSION = 2;

export function getTopLevelMaps(doc: Y.Doc): Y.Map<unknown>[] {
  return YDOC_TOP_LEVEL_MAPS.map((name) => doc.getMap(name));
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val) && !(val instanceof Y.Map);
}

function yMapToPlain(map: Y.Map<unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  map.forEach((val, key) => {
    if (val instanceof Y.Map) {
      output[key] = yMapToPlain(val);
    } else if (Array.isArray(val)) {
      output[key] = val.map((item) => (item instanceof Y.Map ? yMapToPlain(item) : item));
    } else {
      output[key] = val;
    }
  });
  return output;
}

export function getNestedNodeData(nodeMap: Y.Map<unknown>): Record<string, unknown> {
  const data = nodeMap.get('data');
  if (!data) return {};
  if (data instanceof Y.Map) {
    return yMapToPlain(data);
  }
  if (isPlainObject(data)) {
    return JSON.parse(JSON.stringify(data));
  }
  return {};
}

export function setNestedNodeData(
  nodeMap: Y.Map<unknown>,
  patch: Record<string, unknown>,
): void {
  let dataMap = nodeMap.get('data');
  if (!(dataMap instanceof Y.Map)) {
    const existing = isPlainObject(dataMap) ? dataMap : {};
    const createdMap = new Y.Map<unknown>();
    nodeMap.set('data', createdMap);
    for (const [k, v] of Object.entries(existing)) {
      if (k === 'style' && isPlainObject(v)) {
        const styleMap = new Y.Map<unknown>();
        createdMap.set('style', styleMap);
        for (const [sk, sv] of Object.entries(v)) {
          styleMap.set(sk, sv);
        }
      } else {
        createdMap.set(k, v);
      }
    }
    dataMap = createdMap;
  }

  const targetDataMap = dataMap as Y.Map<unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'style' && isPlainObject(value)) {
      let styleMap = targetDataMap.get('style');
      if (!(styleMap instanceof Y.Map)) {
        const existingStyle = isPlainObject(styleMap) ? styleMap : {};
        const createdStyle = new Y.Map<unknown>();
        targetDataMap.set('style', createdStyle);
        for (const [sk, sv] of Object.entries(existingStyle)) {
          createdStyle.set(sk, sv);
        }
        styleMap = createdStyle;
      }
      const targetStyleMap = styleMap as Y.Map<unknown>;
      for (const [sk, sv] of Object.entries(value)) {
        targetStyleMap.set(sk, sv);
      }
    } else {
      targetDataMap.set(key, value);
    }
  }
}

export function migrateYDocSchema(doc: Y.Doc): boolean {
  const meta = doc.getMap('meta');
  const version = meta.get('schemaVersion');
  if (typeof version === 'number' && version >= CURRENT_SCHEMA_VERSION) {
    return false;
  }

  doc.transact(() => {
    meta.set('schemaVersion', CURRENT_SCHEMA_VERSION);
  }, 'system:schema-migration');

  return true;
}

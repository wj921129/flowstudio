/**
 * @fileoverview Y.Map 实体状态快照与字段级比对工具
 * @description 为 AI 批次账本提供实体状态快照、深比较与字段级乐观并发还原能力
 */

import * as Y from 'yjs';

export type EntityState = Record<string, unknown>;

export type NodeLockMode = 'none' | 'position' | 'full';

/**
 * 深拷贝普通 JSON 数据，切断 Yjs 共享引用，避免快照被后续修改污染
 */
export function cloneValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as unknown as T;

  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    output[key] = cloneValue(source[key]);
  }
  return output as T;
}

/**
 * 深度值相等比较（对象键序无关）
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;

  if (typeof a === 'object') {
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      return a.every((item, index) => deepEqual(item, b[index]));
    }
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
  }

  return false;
}

/**
 * 对 Y.Map 实体做完整状态快照（键值深拷贝）
 */
export function snapshotMap(map: Y.Map<unknown>): EntityState {
  const state: EntityState = {};
  map.forEach((value, key) => {
    state[key] = cloneValue(value);
  });
  return state;
}

/**
 * 用完整状态重建 Y.Map（用于恢复被删除的实体）
 */
export function applyMapState(map: Y.Map<unknown>, state: EntityState): void {
  for (const key of Array.from(map.keys())) {
    if (!(key in state)) map.delete(key);
  }
  for (const [key, value] of Object.entries(state)) {
    map.set(key, cloneValue(value));
  }
}

/**
 * 当前实体是否与给定完整状态一致
 */
export function mapMatchesState(map: Y.Map<unknown>, state: EntityState): boolean {
  for (const key of Object.keys(state)) {
    if (!deepEqual(map.get(key), state[key])) return false;
  }
  for (const key of Array.from(map.keys())) {
    if (!(key in state)) return false;
  }
  return true;
}

/**
 * 解析节点锚定锁模式（优先读取 data.lockMode，兼容平铺字段）
 */
export function getNodeLockMode(map: Y.Map<unknown> | undefined | null): NodeLockMode {
  if (!map) return 'none';
  const data = map.get('data') as Record<string, unknown> | undefined;
  const raw = data?.lockMode ?? map.get('lockMode');
  return raw === 'position' || raw === 'full' ? raw : 'none';
}

export interface FieldRevertOutcome {
  /** 是否有字段被实际还原 */
  changed: boolean;
  /** 因人类已修改而安全跳过的字段 */
  skippedFields: string[];
}

/**
 * 字段级乐观并发还原
 *
 * 逐字段比对「当前值」与「AI 写入后的 afterState」：
 * - 相等 → 说明人类未二次修改，安全还原为 beforeState；
 * - 不相等 → 人类已修改，跳过该字段并记录，绝不覆盖人类成果。
 */
export function revertMapFields(
  map: Y.Map<unknown>,
  before: EntityState | null,
  after: EntityState | null,
): FieldRevertOutcome {
  const beforeState = before ?? {};
  const afterState = after ?? {};
  const skippedFields: string[] = [];
  let changed = false;

  const topKeys = new Set([...Object.keys(beforeState), ...Object.keys(afterState)]);

  for (const key of topKeys) {
    if (key === 'data') continue;

    const beforeValue = beforeState[key];
    const afterValue = afterState[key];
    const currentValue = map.get(key);

    if (deepEqual(currentValue, afterValue)) {
      if (beforeValue === undefined) {
        if (map.has(key)) {
          map.delete(key);
          changed = true;
        }
      } else if (!deepEqual(currentValue, beforeValue)) {
        map.set(key, cloneValue(beforeValue));
        changed = true;
      }
    } else if (!deepEqual(currentValue, beforeValue)) {
      skippedFields.push(key);
    }
  }

  if ('data' in beforeState || 'data' in afterState) {
    const currentData = (map.get('data') as Record<string, unknown> | undefined) ?? {};
    const beforeData = (beforeState.data as Record<string, unknown> | undefined) ?? {};
    const afterData = (afterState.data as Record<string, unknown> | undefined) ?? {};
    const nextData: Record<string, unknown> = cloneValue(currentData);
    let dataChanged = false;

    const dataKeys = new Set([...Object.keys(beforeData), ...Object.keys(afterData)]);
    for (const dataKey of dataKeys) {
      const beforeValue = beforeData[dataKey];
      const afterValue = afterData[dataKey];
      const currentValue = currentData[dataKey];

      if (deepEqual(currentValue, afterValue)) {
        if (beforeValue === undefined) {
          if (dataKey in nextData) {
            delete nextData[dataKey];
            dataChanged = true;
          }
        } else if (!deepEqual(currentValue, beforeValue)) {
          nextData[dataKey] = cloneValue(beforeValue);
          dataChanged = true;
        }
      } else if (!deepEqual(currentValue, beforeValue)) {
        skippedFields.push(`data.${dataKey}`);
      }
    }

    if (dataChanged) {
      map.set('data', nextData);
      changed = true;
    }
  }

  return { changed, skippedFields };
}

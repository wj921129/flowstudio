import { describe, it, expect } from 'vitest';
import { filterElements, categorizeElements } from '../src/features/sidebar/tabs/elements-panel';
import { NODE_REGISTRY_RECORD, NODE_CATEGORIES } from '@flowstudio/shared';

describe('Sidebar Components Logic', () => {
  it('filters elements by search keyword correctly', () => {
    const all = [
      { id: 'start-end', label: '开始/结束' },
      { id: 'process', label: '处理过程' },
      { id: 'decision', label: '判断分支' },
    ];
    const results = filterElements(all as any, '判断');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('decision');
  });

  it('categorizes registry entries into five disjoint category tabs without duplicates', () => {
    const entries = Object.values(NODE_REGISTRY_RECORD);
    const groups = categorizeElements(entries);
    const typesOf = (list: typeof entries) => list.map((e) => e.type);
    const grouped = NODE_CATEGORIES.map((c) => typesOf(groups[c]));

    grouped.forEach((a, i) => {
      grouped.forEach((b, j) => {
        if (i !== j) expect(a.filter((t) => b.includes(t))).toEqual([]);
      });
    });

    const union = grouped.flat();
    expect(new Set(union).size).toBe(union.length);
    expect(union.sort()).toEqual(entries.map((e) => e.type).sort());

    expect(typesOf(groups['泳道'])).toEqual(expect.arrayContaining(['pool', 'lane']));
    expect(typesOf(groups['流程'])).toEqual(expect.arrayContaining(['start-end', 'process', 'decision', 'io', 'document', 'subprocess', 'database']));
    expect(typesOf(groups['UML']).sort()).toEqual(['uml-lifeline', 'uml-activation', 'uml-message'].sort());
    expect(typesOf(groups['架构']).sort()).toEqual(
      ['arch-microservice', 'arch-gateway', 'arch-db-shard', 'arch-cache', 'arch-k8s-pod', 'arch-docker'].sort()
    );
    expect(typesOf(groups['形状'])).toEqual(expect.arrayContaining(['comment', 'group', 'rich-card']));
  });
});

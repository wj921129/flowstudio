import { describe, it, expect } from 'vitest';
import { filterElements, categorizeElements } from '../src/features/sidebar/tabs/elements-panel';
import { NODE_REGISTRY_RECORD } from '@flowstudio/shared';

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

  it('categorizes registry entries into three functionally disjoint groups without duplicates', () => {
    const entries = Object.values(NODE_REGISTRY_RECORD);
    const groups = categorizeElements(entries);
    const typesOf = (list: typeof entries) => list.map((e) => e.type);
    const basic = typesOf(groups.basic);
    const flowchart = typesOf(groups.flowchart);
    const containers = typesOf(groups.containers);

    // 任意图元不得出现在两个分组
    expect(basic.filter((t) => flowchart.includes(t))).toEqual([]);
    expect(basic.filter((t) => containers.includes(t))).toEqual([]);
    expect(flowchart.filter((t) => containers.includes(t))).toEqual([]);

    // 三组并集必须覆盖注册表全集，且总数不重复计数
    const union = [...basic, ...flowchart, ...containers];
    expect(new Set(union).size).toBe(union.length);
    expect(union.sort()).toEqual(entries.map((e) => e.type).sort());

    expect(containers).toEqual(expect.arrayContaining(['pool', 'lane', 'group']));
    expect(flowchart).toEqual(expect.arrayContaining(['io', 'document', 'subprocess', 'database']));
    expect(basic).toEqual(expect.arrayContaining(['start-end', 'process', 'decision', 'comment']));
  });
});

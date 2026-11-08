import { describe, it, expect } from 'vitest';
import {
  TEMPLATES_REGISTRY,
  getTemplatesByCategory,
  instantiateTemplate,
} from '../src/features/sidebar/templates';
import { THEME_PRESETS } from '../src/features/sidebar/styles/theme-presets';

describe('Templates Library', () => {
  it('contains templates for all 4 required categories', () => {
    const categories = ['flowchart', 'swimlane', 'topology', 'org-chart'] as const;
    categories.forEach((cat) => {
      const list = getTemplatesByCategory(cat);
      expect(list.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('instantiates template with new unique IDs and active theme style', () => {
    const template = TEMPLATES_REGISTRY[0];
    const theme = THEME_PRESETS[3]; // 科技炫紫
    const instance = instantiateTemplate(template, theme, { x: 100, y: 100 });

    expect(instance.nodes.length).toBe(template.nodes.length);
    expect(instance.edges.length).toBe(template.edges.length);
    // 验证新 ID
    expect(instance.nodes[0].id).not.toBe(template.nodes[0].id);
    // 验证坐标偏移
    expect(instance.nodes[0].position.x).toBe(template.nodes[0].position.x + 100);
    // 验证主题注入
    expect((instance.nodes[0].data.style as any)?.borderColor).toBe(theme.tokens.nodeBorder);
  });

  it('correctly maps edges source and target to the newly generated node IDs', () => {
    const template = TEMPLATES_REGISTRY.find((t) => t.edges.length > 0)!;
    const theme = THEME_PRESETS[0];
    const instance = instantiateTemplate(template, theme);

    const nodeIds = new Set(instance.nodes.map((n) => n.id));
    instance.edges.forEach((edge) => {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
      expect(edge.style?.stroke).toBe(theme.tokens.edgeStroke);
    });
  });
});

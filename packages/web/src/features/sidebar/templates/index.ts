import { DIAGRAM_PRESETS, renderSpec, type FlowEdge, type FlowNode } from '@flowstudio/shared';
import type { ThemePreset } from '../styles/types';
import { resolveNodeStyle } from '../styles/style-resolver';
import type { DiagramTemplate, TemplateCategory } from './types';
import { FLOWCHART_TEMPLATES } from './flowchart-templates';
import { SWIMLANE_TEMPLATES } from './swimlane-templates';
import { TOPOLOGY_TEMPLATES } from './topology-templates';
import { ORG_CHART_TEMPLATES } from './org-chart-templates';

export * from './types';
export * from './flowchart-templates';
export * from './swimlane-templates';
export * from './topology-templates';
export * from './org-chart-templates';

export const TEMPLATES_REGISTRY: DiagramTemplate[] = DIAGRAM_PRESETS;

export function getTemplatesByCategory(category: TemplateCategory): DiagramTemplate[] {
  return TEMPLATES_REGISTRY.filter((t) => t.category === category);
}

export function instantiateTemplate(
  template: DiagramTemplate,
  theme: ThemePreset,
  offset: { x: number; y: number } = { x: 0, y: 0 }
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const prefix = `tmpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const rendered = renderSpec(template.spec, { idPrefix: `${prefix}_`, origin: offset });

  const nodes: FlowNode[] = rendered.nodes.map((node) => {
    const computedStyle = resolveNodeStyle(node.type, theme);
    const nodeStyle: Record<string, unknown> = { ...computedStyle, isManualCustom: false };
    return {
      ...node,
      data: {
        ...node.data,
        ...(node.parentId ? { parentId: node.parentId } : {}),
        headerColor: computedStyle.headerColor ?? node.data.headerColor,
        style: nodeStyle,
      },
    };
  });

  const edges: FlowEdge[] = rendered.edges.map((edge) => ({
    ...edge,
    style: { stroke: theme.tokens.edgeStroke, strokeWidth: 2 },
  }));

  return { nodes, edges };
}
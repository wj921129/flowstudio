import type { FlowNode, FlowEdge } from '@flowstudio/shared';
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

export const TEMPLATES_REGISTRY: DiagramTemplate[] = [
  ...FLOWCHART_TEMPLATES,
  ...SWIMLANE_TEMPLATES,
  ...TOPOLOGY_TEMPLATES,
  ...ORG_CHART_TEMPLATES,
];

export function getTemplatesByCategory(category: TemplateCategory): DiagramTemplate[] {
  return TEMPLATES_REGISTRY.filter((t) => t.category === category);
}

export function instantiateTemplate(
  template: DiagramTemplate,
  theme: ThemePreset,
  offset: { x: number; y: number } = { x: 0, y: 0 }
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const idMap = new Map<string, string>();
  const prefix = `tmpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  // 1. 生成唯一 ID 映射
  template.nodes.forEach((node) => {
    idMap.set(node.id, `${prefix}_${node.id}`);
  });

  // 2. 实例化并着色节点
  const nodes: FlowNode[] = template.nodes.map((node) => {
    const newId = idMap.get(node.id)!;
    const parentId = node.parentId ? idMap.get(node.parentId) : undefined;
    const computedStyle = resolveNodeStyle(node.type, theme);

    // 对于普通节点施加主题边框和背景，对于泳道池施加表头色
    const nodeStyle: Record<string, unknown> = {
      ...computedStyle,
      isManualCustom: false,
    };

    return {
      id: newId,
      type: node.type,
      position: {
        x: node.position.x + offset.x,
        y: node.position.y + offset.y,
      },
      width: node.width,
      height: node.height,
      parentId,
      data: {
        ...node.data,
        parentId,
        headerColor: computedStyle.headerColor ?? node.data.headerColor,
        style: nodeStyle,
      },
    };
  });

  // 3. 实例化并绑定连线
  const edges: FlowEdge[] = template.edges.map((edge, idx) => {
    const newSource = idMap.get(edge.source) ?? edge.source;
    const newTarget = idMap.get(edge.target) ?? edge.target;
    return {
      id: `${prefix}_e_${idx}_${newSource}_${newTarget}`,
      source: newSource,
      target: newTarget,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      type: edge.type ?? 'orthogonal',
      style: {
        stroke: theme.tokens.edgeStroke,
        strokeWidth: 2,
      },
      data: {
        ...edge.data,
      },
    };
  });

  return { nodes, edges };
}

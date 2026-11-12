import type { DiagramSpec } from '@flowstudio/shared';

export type TemplateCategory = 'flowchart' | 'swimlane' | 'topology' | 'org-chart';

export interface DiagramTemplate {
  id: string;
  title: string;
  category: TemplateCategory;
  description: string;
  spec: DiagramSpec;
}
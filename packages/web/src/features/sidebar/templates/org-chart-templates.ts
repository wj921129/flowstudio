import { DIAGRAM_PRESETS } from '@flowstudio/shared';
import type { DiagramTemplate } from './types';

export const ORG_CHART_TEMPLATES: DiagramTemplate[] = DIAGRAM_PRESETS.filter((p) => p.category === 'org-chart');

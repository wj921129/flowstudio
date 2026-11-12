import { DIAGRAM_PRESETS } from '@flowstudio/shared';
import type { DiagramTemplate } from './types';

export const TOPOLOGY_TEMPLATES: DiagramTemplate[] = DIAGRAM_PRESETS.filter((p) => p.category === 'topology');

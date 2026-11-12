import { DIAGRAM_PRESETS } from '@flowstudio/shared';
import type { DiagramTemplate } from './types';

export const SWIMLANE_TEMPLATES: DiagramTemplate[] = DIAGRAM_PRESETS.filter((p) => p.category === 'swimlane');
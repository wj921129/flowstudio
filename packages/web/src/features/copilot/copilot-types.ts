import type { DiagramSpec } from '@flowstudio/shared';

export interface CopilotDryRunPlan {
  id: string;
  tool: 'apply_ops' | 'scaffold_diagram' | 'auto_layout';
  summary: string;
  details: string[];
  ops?: any[];
  spec?: DiagramSpec;
  direction?: 'RIGHT' | 'DOWN';
}

export interface CopilotMessage {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: number;
  contextNodes?: Array<{ id: string; label: string }>;
  plan?: CopilotDryRunPlan;
  reviewBatchId?: string;
  status?: 'thinking' | 'ready' | 'applied' | 'reverted' | 'failed';
  error?: string;
}

export interface SlashCommandItem {
  cmd: string;
  title: string;
  desc: string;
  example: string;
}

import type { CopilotDryRunPlan } from './copilot-types';

export interface ExecutePlanResult {
  success: boolean;
  batchId?: string;
  appliedCount?: number;
  message?: string;
  warnings?: string[];
  error?: string;
}

export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<any> {
  const res = await fetch('/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });

  if (!res.ok) throw new Error(`MCP 请求失败: ${res.statusText}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'MCP 执行错误');

  const contentText = data.result?.content?.[0]?.text;
  if (data.result?.isError) {
    throw new Error(contentText || 'MCP 执行失败');
  }

  try {
    return JSON.parse(contentText);
  } catch {
    return contentText;
  }
}

export async function executePlan(diagramId: string, plan: CopilotDryRunPlan): Promise<ExecutePlanResult> {
  try {
    if (plan.tool === 'apply_ops') {
      const res = await callMcpTool('apply_ops', {
        diagramId,
        agentName: 'Web AI Copilot',
        ops: plan.ops || [],
      });
      return {
        success: Boolean(res?.success),
        batchId: res?.batchId,
        appliedCount: res?.appliedCount,
        warnings: res?.warnings,
      };
    }

    if (plan.tool === 'scaffold_diagram') {
      const payload = {
        diagramId,
        title: plan.spec?.title,
        spec: plan.spec,
      };
      const res = await callMcpTool('scaffold_diagram', payload);
      return {
        success: Boolean(res?.success),
        batchId: res?.batchId,
        message: res?.message,
        warnings: res?.warnings,
      };
    }

    if (plan.tool === 'auto_layout') {
      const res = await callMcpTool('auto_layout', {
        diagramId,
        direction: plan.direction || 'RIGHT',
      });
      return {
        success: Boolean(res?.success),
        warnings: res?.warnings,
      };
    }

    return { success: false, error: `不支持的工具类型: ${plan.tool}` };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

export async function revertAiBatch(diagramId: string, batchId: string): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const res = await fetch(`/api/diagrams/${encodeURIComponent(diagramId)}/ai-batches/${encodeURIComponent(batchId)}/revert`, {
      method: 'POST',
    });
    const data = await res.json();
    if (res.ok && data.success) {
      return { success: true, message: data.message };
    }
    return { success: false, error: data.error || '撤回失败' };
  } catch (err: any) {
    return { success: false, error: err.message || '撤回网络异常' };
  }
}

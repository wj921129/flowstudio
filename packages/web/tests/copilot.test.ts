import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFlowStore } from '../src/stores/flow-store';
import { planFromNaturalLanguage, generateTestCases, planBranch, planRefine } from '../src/features/copilot/copilot-planner';
import { SLASH_COMMANDS } from '../src/features/copilot/copilot-slash-commands';
import { executePlan, revertAiBatch, callMcpTool } from '../src/features/copilot/copilot-api';
import type { FlowNode, FlowEdge } from '@flowstudio/shared';

describe('Web AI Copilot Panel & Human-AI Co-Governance Engine', () => {
  beforeEach(() => {
    useFlowStore.getState().unbindCollaboration();
    useFlowStore.getState().resetDiagramState();
    vi.restoreAllMocks();
  });

  const mockNodes: FlowNode[] = [
    {
      id: 'node-pay',
      type: 'process',
      position: { x: 100, y: 100 },
      data: { label: '订单支付' },
    },
    {
      id: 'lane-risk',
      type: 'lane',
      position: { x: 0, y: 0 },
      data: { label: '风控泳道' },
    },
    {
      id: 'node-success',
      type: 'start-end',
      position: { x: 300, y: 100 },
      data: { label: '支付成功' },
    },
  ];

  const mockEdges: FlowEdge[] = [
    {
      id: 'edge-1',
      source: 'node-pay',
      target: 'node-success',
      type: 'orthogonal',
      data: { label: '扣款完成' },
    },
  ];

  it('manages copilotOpen store state and toggle transitions', () => {
    expect(useFlowStore.getState().copilotOpen).toBe(false);

    useFlowStore.getState().setCopilotOpen(true);
    expect(useFlowStore.getState().copilotOpen).toBe(true);

    useFlowStore.getState().setCopilotOpen((prev) => !prev);
    expect(useFlowStore.getState().copilotOpen).toBe(false);
  });

  it('verifies registered slash commands schema', () => {
    expect(SLASH_COMMANDS.length).toBeGreaterThanOrEqual(3);
    const cmds = SLASH_COMMANDS.map((c) => c.cmd);
    expect(cmds).toContain('/refine');
    expect(cmds).toContain('/branch');
    expect(cmds).toContain('/testcase');
  });

  it('parses PRD 3.1 core natural language requirement into incremental apply_ops dry-run plan', () => {
    const prompt = '在订单支付节点后增加风控校验，若未通过则驳回至用户，放到风控泳道';
    const result = planFromNaturalLanguage(
      {
        diagramId: 'test-diagram',
        nodes: mockNodes,
        edges: mockEdges,
        selectedNodes: [mockNodes[0]],
      },
      prompt
    );

    expect(result.plan).toBeDefined();
    expect(result.plan?.tool).toBe('apply_ops');
    expect(result.plan?.ops).toBeDefined();

    const ops = result.plan!.ops!;
    const addOps = ops.filter((o) => o.op === 'add_node');
    const connectOps = ops.filter((o) => o.op === 'connect');

    expect(addOps.length).toBeGreaterThanOrEqual(2);
    expect(addOps.some((o) => o.label === '风控校验' && o.laneId === 'lane-risk')).toBe(true);
    expect(addOps.some((o) => o.label.includes('驳回至用户') || o.label.includes('驳回'))).toBe(true);

    expect(connectOps.some((o) => o.source === 'node-pay')).toBe(true);
    expect(connectOps.some((o) => o.label === '未通过')).toBe(true);
    expect(result.plan?.summary).toContain('增量新增');
  });

  it('handles /branch slash command and generates decision validation and rollback branch', () => {
    const result = planBranch(
      {
        diagramId: 'diag-1',
        nodes: mockNodes,
        edges: mockEdges,
        selectedNodes: [mockNodes[0]],
      },
      '/branch 异常校验'
    );

    expect(result.plan).toBeDefined();
    expect(result.plan?.tool).toBe('apply_ops');
    const ops = result.plan!.ops!;
    expect(ops.some((o) => o.op === 'add_node' && o.type === 'decision')).toBe(true);
    expect(ops.some((o) => o.op === 'add_node' && o.label.includes('驳回'))).toBe(true);
    expect(ops.some((o) => o.op === 'connect' && o.label === '校验未通过')).toBe(true);
  });

  it('handles /refine slash command and plans label standardization or auto layout', () => {
    const result = planRefine({
      diagramId: 'diag-1',
      nodes: mockNodes,
      edges: mockEdges,
      selectedNodes: [mockNodes[0]],
    });

    expect(result.plan).toBeDefined();
    if (result.plan?.tool === 'apply_ops') {
      expect(result.plan.ops!.every((o) => o.op === 'update_node')).toBe(true);
    } else {
      expect(result.plan?.tool).toBe('auto_layout');
    }
  });

  it('handles /testcase and traverses causal topology into structured test cases', () => {
    const testcases = generateTestCases(mockNodes, mockEdges);
    expect(testcases).toContain('AI 因果链路测试用例清单');
    expect(testcases).toContain('TC-01');
    expect(testcases).toContain('订单支付');
    expect(testcases).toContain('支付成功');
  });

  it('generates scaffold_diagram plan when user asks to create diagram from scratch', () => {
    const result = planFromNaturalLanguage(
      {
        diagramId: 'diag-empty',
        nodes: [],
        edges: [],
        selectedNodes: [],
      },
      '创建包含用户与支付泳道的在线交易流程图'
    );

    expect(result.plan).toBeDefined();
    expect(result.plan?.tool).toBe('scaffold_diagram');
    expect(result.plan?.scaffold).toBeDefined();
    expect(result.plan?.scaffold.lanes.length).toBeGreaterThanOrEqual(2);
    expect(result.plan?.scaffold.nodes.length).toBeGreaterThan(0);
    expect(result.plan?.scaffold.edges.length).toBeGreaterThan(0);
  });

  it('executes apply_ops and scaffold_diagram via MCP JSON-RPC call and handles revert', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url === '/mcp') {
        return {
          ok: true,
          json: async () => ({
            jsonrpc: '2.0',
            id: 1,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    batchId: 'batch-test-123',
                    appliedCount: 3,
                  }),
                },
              ],
            },
          }),
        };
      }
      if (url.includes('/revert')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            message: '已成功撤回 AI 本批次修改',
          }),
        };
      }
      return { ok: false, statusText: 'Not Found' };
    });

    global.fetch = fetchMock as any;

    const executeResult = await executePlan('test-diagram-id', {
      id: 'plan-1',
      tool: 'apply_ops',
      summary: '测试增量计划',
      details: ['+ 测试节点'],
      ops: [{ op: 'add_node', label: '测试节点' }],
    });

    expect(executeResult.success).toBe(true);
    expect(executeResult.batchId).toBe('batch-test-123');
    expect(executeResult.appliedCount).toBe(3);

    const revertResult = await revertAiBatch('test-diagram-id', 'batch-test-123');
    expect(revertResult.success).toBe(true);
    expect(revertResult.message).toContain('已成功撤回');
  });
});

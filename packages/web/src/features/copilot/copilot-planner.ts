import type { DiagramSpec, FlowNode, FlowEdge } from '@flowstudio/shared';
import type { CopilotDryRunPlan } from './copilot-types';

export interface PlanContext {
  diagramId: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  selectedNodes: FlowNode[];
}

export interface PlanResult {
  text: string;
  plan?: CopilotDryRunPlan;
}

function getNodeLabel(n: FlowNode): string {
  const d = (n.data || {}) as Record<string, unknown>;
  return String(d.label || d.laneTitle || n.id);
}

function findNodeByKeyword(nodes: FlowNode[], kw: string): FlowNode | undefined {
  const clean = kw.trim().replace(/^\[|\]$/g, '').toLowerCase();
  return nodes.find((n) => {
    if (n.type === 'pool' || n.type === 'lane') return false;
    const label = getNodeLabel(n).toLowerCase();
    return label.includes(clean) || clean.includes(label) || n.id === clean;
  });
}

function findLaneByKeyword(nodes: FlowNode[], kw: string): FlowNode | undefined {
  const clean = kw.trim().replace(/^\[|\]$/g, '').toLowerCase();
  return nodes.find((n) => {
    if (n.type !== 'lane') return false;
    const label = getNodeLabel(n).toLowerCase();
    return label.includes(clean) || clean.includes(label);
  });
}

export function generateTestCases(nodes: FlowNode[], edges: FlowEdge[]): string {
  const nonContainers = nodes.filter((n) => n.type !== 'pool' && n.type !== 'lane');
  if (nonContainers.length === 0) {
    return '当前画布为空，未检测到业务节点。请先绘制或由 AI 创建流程图后再生成测试用例。';
  }

  const inDegree = new Map<string, number>();
  const outEdges = new Map<string, FlowEdge[]>();
  nonContainers.forEach((n) => {
    inDegree.set(n.id, 0);
    outEdges.set(n.id, []);
  });

  edges.forEach((e) => {
    if (inDegree.has(e.target)) inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
    if (outEdges.has(e.source)) outEdges.get(e.source)!.push(e);
  });

  let startNodes = nonContainers.filter((n) => n.type === 'start-end' || (inDegree.get(n.id) || 0) === 0);
  if (startNodes.length === 0) startNodes = [nonContainers[0]];

  const paths: Array<{ steps: string[]; conditions: string[] }> = [];

  function dfs(currId: string, visited: Set<string>, curSteps: string[], curConds: string[]) {
    const node = nonContainers.find((n) => n.id === currId);
    const label = node ? getNodeLabel(node) : currId;
    const nextSteps = [...curSteps, label];

    const outgoing = outEdges.get(currId) || [];
    if (outgoing.length === 0 || visited.has(currId) || nextSteps.length > 8) {
      paths.push({ steps: nextSteps, conditions: curConds });
      return;
    }

    visited.add(currId);
    outgoing.forEach((edge) => {
      const cond = edge.data?.label ? String(edge.data.label) : '';
      dfs(
        edge.target,
        new Set(visited),
        nextSteps,
        cond ? [...curConds, `[${cond}]`] : curConds
      );
    });
  }

  startNodes.forEach((start) => {
    dfs(start.id, new Set(), [], []);
  });

  const uniquePaths = paths.slice(0, 6);
  const rows = uniquePaths.map((p, idx) => {
    const caseId = `TC-${String(idx + 1).padStart(2, '0')}`;
    const name = idx === 0 ? '标准主流程执行' : `分支场景-${idx}: ${p.conditions.join(' & ') || '流程流转'}`;
    const pathStr = p.steps.join(' → ');
    const condStr = p.conditions.length > 0 ? p.conditions.join('，') : '前置数据就绪';
    const lastStep = p.steps[p.steps.length - 1];
    const expected = lastStep.includes('驳回') || lastStep.includes('失败') || lastStep.includes('异常')
      ? '中断主链路并进入异常补偿/告警'
      : '成功流转至预期终态节点';
    return `| ${caseId} | ${name} | ${pathStr} | ${condStr} | ${expected} |`;
  });

  return [
    '### 📋 AI 因果链路测试用例清单',
    `基于当前画布 ${nonContainers.length} 个业务节点与 ${edges.length} 条因果连线推演分析：`,
    '',
    '| 用例编号 | 用例名称 | 核心流转路径 | 触发条件 | 预期流转结果 |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    '💡 提示：可通过画布内置 AI Copilot 继续下达指令调整异常分支，或一键采纳/驳回结构变更。',
  ].join('\n');
}

export function planBranch(ctx: PlanContext, promptText: string): PlanResult {
  const targetNodes = ctx.selectedNodes.length > 0
    ? ctx.selectedNodes
    : [ctx.nodes.find((n) => n.type !== 'pool' && n.type !== 'lane')].filter(Boolean) as FlowNode[];

  if (targetNodes.length === 0) {
    return { text: '画布中尚无节点，请先创建节点后再为其补充异常分支。' };
  }

  const isCompensation = promptText.includes('补偿');
  const ops: any[] = [];
  const details: string[] = [];

  targetNodes.forEach((node, idx) => {
    const label = getNodeLabel(node);
    const decLabel = `${label}校验`;
    const failLabel = isCompensation ? `${label}异常补偿` : `${label}异常驳回`;
    const decId = `node-ai-${Date.now()}-${idx}-dec`;
    const failId = `node-ai-${Date.now()}-${idx}-fail`;

    ops.push(
      {
        op: 'add_node',
        id: decId,
        type: 'decision',
        label: decLabel,
        laneId: node.parentId,
      },
      {
        op: 'add_node',
        id: failId,
        type: 'process',
        label: failLabel,
        laneId: node.parentId,
      },
      {
        op: 'connect',
        source: node.id,
        target: decId,
      },
      {
        op: 'connect',
        source: decId,
        target: failId,
        label: '校验未通过',
      }
    );

    details.push(
      `+ 为「${label}」新增决策校验 [${decLabel}] 与${isCompensation ? '异常补偿' : '异常驳回'} [${failLabel}]`
    );
  });

  const nodeNames = targetNodes.map(getNodeLabel).join('、');
  return {
    text: `已为节点 **「${nodeNames}」** 细化规划异常校验与处理分支。以下为增量操作意图预览：`,
    plan: {
      id: `plan-${Date.now()}`,
      tool: 'apply_ops',
      summary: `为 ${targetNodes.length} 个节点细化异常逻辑（新增 ${ops.filter((o) => o.op === 'add_node').length} 节点，新增 ${ops.filter((o) => o.op === 'connect').length} 连线）`,
      details,
      ops,
    },
  };
}

export function planRefine(ctx: PlanContext): PlanResult {
  const targetNodes = ctx.selectedNodes.length > 0
    ? ctx.selectedNodes
    : ctx.nodes.filter((n) => n.type !== 'pool' && n.type !== 'lane');

  if (targetNodes.length === 0) {
    return { text: '画布中没有需要润色的节点。' };
  }

  const ops: any[] = [];
  const details: string[] = [];

  targetNodes.forEach((n) => {
    const raw = getNodeLabel(n);
    let polished = raw.trim();
    if (!polished.endsWith('处理') && !polished.endsWith('节点') && !polished.endsWith('校验') && polished.length <= 4) {
      polished = `${polished}处理`;
    }
    if (polished !== raw) {
      ops.push({
        op: 'update_node',
        id: n.id,
        label: polished,
      });
      details.push(`✎ 润色文案：${raw} → ${polished}`);
    }
  });

  if (ops.length === 0) {
    return {
      text: '当前节点文案已较为标准规范。正在为你规划分层正交自动排版以优化整体走线。',
      plan: {
        id: `plan-${Date.now()}`,
        tool: 'auto_layout',
        summary: '对全画布图元执行分层正交自适应自动排版',
        details: ['⚡ 执行 ELK 智能因果正交拓扑排版', '⚡ 自动重置节点间距与连线拐角'],
        direction: 'RIGHT',
      },
    };
  }

  return {
    text: `已对 ${ops.length} 个节点的命名规范进行了提炼润色：`,
    plan: {
      id: `plan-${Date.now()}`,
      tool: 'apply_ops',
      summary: `润色 ${ops.length} 个节点文案并保持既有拓扑`,
      details,
      ops,
    },
  };
}

export function planFromNaturalLanguage(ctx: PlanContext, prompt: string): PlanResult {
  const p = prompt.trim();

  if (p.startsWith('/testcase') || p.includes('测试用例')) {
    return { text: generateTestCases(ctx.nodes, ctx.edges) };
  }

  if (
    p.startsWith('/branch') ||
    p.includes('异常分支') ||
    p.includes('补充异常') ||
    p.includes('异常补偿') ||
    p.includes('补偿逻辑') ||
    p.includes('细化')
  ) {
    return planBranch(ctx, p);
  }

  if (p.startsWith('/refine') || p.includes('排版润色') || p.includes('润色')) {
    return planRefine(ctx);
  }

  if (p.includes('排版') || p.includes('自动对齐') || p.includes('整理画布')) {
    return {
      text: '已生成全局自动排版规划。点击执行后将通过服务排版引擎重算整洁拓扑。',
      plan: {
        id: `plan-${Date.now()}`,
        tool: 'auto_layout',
        summary: '全画布正交智能自动排版 (ELK 引擎)',
        details: ['⚡ 保持人类锚定锁不动，自适应调整自由图元间距与泳道尺寸'],
        direction: 'RIGHT',
      },
    };
  }

  const isIncrementalAdd = p.includes('增加') || p.includes('添加') || p.includes('插入') || p.includes('后面') || p.includes('之后');

  if (!isIncrementalAdd && (p.includes('创建') || p.includes('生成') || p.includes('构建') || p.includes('画一个') || p.includes('骨架') || (p.includes('泳道') && !p.includes('放到')))) {
    const hasLanes = p.includes('泳道') || p.includes('跨部门') || p.includes('角色');
    const lanes = hasLanes
      ? [
          { id: 'lane-user', label: '用户端' },
          { id: 'lane-risk', label: '风控系统' },
          { id: 'lane-pay', label: '支付核心' },
        ]
      : undefined;

    const nodes: DiagramSpec['nodes'] = [
      { id: 'node-start', type: 'start-end', label: '发起订单', laneId: hasLanes ? 'lane-user' : undefined },
      { id: 'node-risk', type: 'decision', label: '风控反欺诈校验', laneId: hasLanes ? 'lane-risk' : undefined },
      { id: 'node-pay', type: 'process', label: '核心扣款结算', laneId: hasLanes ? 'lane-pay' : undefined },
      { id: 'node-reject', type: 'process', label: '风控驳回订单', laneId: hasLanes ? 'lane-risk' : undefined },
      { id: 'node-end', type: 'start-end', label: '完成支付通知', laneId: hasLanes ? 'lane-user' : undefined },
    ];

    const edges = [
      { source: 'node-start', target: 'node-risk' },
      { source: 'node-risk', target: 'node-pay', label: '通过' },
      { source: 'node-risk', target: 'node-reject', label: '拦截' },
      { source: 'node-pay', target: 'node-end' },
    ];

    return {
      text: `已为你分析需求并生成骨架搭建规划（${hasLanes ? '含 3 个横向泳道' : '常规流程'}，5 个核心业务节点）：`,
      plan: {
        id: `plan-${Date.now()}`,
        tool: 'scaffold_diagram',
        summary: `生成骨架：${nodes.length} 个节点、${edges.length} 条连线${hasLanes ? '、3 个泳道' : ''}`,
        details: [
          ...(hasLanes ? ['+ 创建泳道：用户端、风控系统、支付核心'] : []),
          '+ 创建节点：发起订单 (start-end)',
          '+ 创建节点：风控反欺诈校验 (decision)',
          '+ 创建节点：核心扣款结算 (process)',
          '+ 创建节点：风控驳回订单 (process)',
          '+ 创建节点：完成支付通知 (start-end)',
          '+ 连接连线并标注条件分支 [通过] 与 [拦截]',
        ],
        spec: {
          paradigm: hasLanes ? 'swimlane' : 'vertical-flow',
          title: '在线订单与风控结算流程',
          lanes,
          nodes: nodes.map((n) => ({ id: n.id, type: n.type, label: n.label, laneId: n.laneId })),
          edges: edges.map((e) => ({ from: e.source, to: e.target, label: e.label })),
        },
      },
    };
  }

  const riskMatch = p.match(/(?:在|增加|添加)?\s*([^\s,，]+?)(?:节点)?(?:后|之后|后面)\s*(?:增加|添加|插入)\s*([^\s,，]+)/);
  if (riskMatch || p.includes('增加') || p.includes('添加') || p.includes('插入')) {
    const srcNodeName = riskMatch ? riskMatch[1] : '';
    const newNodeName = riskMatch ? riskMatch[2] : '新增业务步骤';

    let srcNode = srcNodeName ? findNodeByKeyword(ctx.nodes, srcNodeName) : undefined;
    if (!srcNode && ctx.selectedNodes.length > 0) srcNode = ctx.selectedNodes[0];
    if (!srcNode) srcNode = ctx.nodes.find((n) => n.type !== 'pool' && n.type !== 'lane');

    const ops: any[] = [];
    const details: string[] = [];

    let targetLaneId: string | undefined = undefined;
    const laneKeyword =
      p.match(/(?:放到|在|归入|进入)?\s*([^\s,，]+?)泳道/) ||
      p.match(/(?:放到|在|归入)\s*([^\s,，]+?)(?:泳道)?(?=[,，\s]|$)/);
    if (laneKeyword) {
      const kw = laneKeyword[1] || laneKeyword[2];
      const matchedLane = findLaneByKeyword(ctx.nodes, kw);
      if (matchedLane) targetLaneId = matchedLane.id;
    }

    const newNodeId = `node-ai-${Date.now()}-1`;
    ops.push({
      op: 'add_node',
      id: newNodeId,
      type: p.includes('校验') || p.includes('判断') ? 'decision' : 'process',
      label: newNodeName,
      laneId: targetLaneId ?? srcNode?.parentId,
    });
    details.push(`+ 新增节点：${newNodeName}${targetLaneId ? ' (归属指定泳道)' : ''}`);

    if (srcNode) {
      ops.push({
        op: 'connect',
        source: srcNode.id,
        target: newNodeId,
      });
      details.push(`+ 新增连线：${getNodeLabel(srcNode)} → ${newNodeName}`);
    }

    if (p.includes('驳回') || p.includes('未通过') || p.includes('失败')) {
      const rejectNodeId = `node-ai-${Date.now()}-reject`;
      const rejectName = p.includes('驳回至用户') ? '驳回至用户' : '异常驳回处理';
      ops.push({
        op: 'add_node',
        id: rejectNodeId,
        type: 'process',
        label: rejectName,
        laneId: targetLaneId ?? srcNode?.parentId,
      });
      ops.push({
        op: 'connect',
        source: newNodeId,
        target: rejectNodeId,
        label: '未通过',
      });
      details.push(`+ 新增节点：${rejectName}`);
      details.push(`+ 新增分支连线：${newNodeName} → ${rejectName} [未通过]`);
    }

    return {
      text: `已根据你的意图生成增量编辑操作方案（严格执行增量操作，绝不整量覆盖画布）：`,
      plan: {
        id: `plan-${Date.now()}`,
        tool: 'apply_ops',
        summary: `增量新增 ${ops.filter((o) => o.op === 'add_node').length} 个节点、${ops.filter((o) => o.op === 'connect').length} 条连线`,
        details,
        ops,
      },
    };
  }

  const targetNode = ctx.selectedNodes[0] || ctx.nodes.find((n) => n.type !== 'pool' && n.type !== 'lane');
  const targetLabel = targetNode ? getNodeLabel(targetNode) : '流程节点';
  const newId = `node-ai-${Date.now()}`;

  const fallbackOps: any[] = [
    {
      op: 'add_node',
      id: newId,
      type: 'process',
      label: p.slice(0, 16) || '增量补充处理',
      laneId: targetNode?.parentId,
    },
  ];
  if (targetNode) {
    fallbackOps.push({
      op: 'connect',
      source: targetNode.id,
      target: newId,
    });
  }

  return {
    text: `已解析指令，为你规划了相应的增量图元操作方案：`,
    plan: {
      id: `plan-${Date.now()}`,
      tool: 'apply_ops',
      summary: `增量扩充业务节点并串联至「${targetLabel}」`,
      details: [
        `+ 新增节点：${p.slice(0, 16) || '增量补充处理'}`,
        ...(targetNode ? [`+ 连线连接：${targetLabel} → 新增节点`] : []),
      ],
      ops: fallbackOps,
    },
  };
}

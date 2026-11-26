import type { FastifyPluginAsync } from 'fastify';
import { z, type ZodType } from 'zod';
import { DIAGRAM_PRESETS, diagramSpecSchema } from '@flowstudio/shared';
import type { DiagramRepository } from '../db/diagram-repository.js';
import type { AiBatchManager } from '../collaboration/ai-batch-manager.js';
import type { DocumentWriter } from '../collaboration/document-writer.js';
import { AiCollaborator } from './ai-collaborator.js';
import type { McpOp, McpToolDefinition } from './types.js';
import {
  applyOpsInputSchema,
  autoLayoutInputSchema,
  getSelectionInputSchema,
  scaffoldDiagramInputSchema,
  searchNodesInputSchema,
  undoAiBatchInputSchema,
} from './op-schemas.js';

const AI_DRAWING_GUIDE_MD = `# FlowStudio AI 绘图标准指南 (5 范式)

## 1. 范式选型口诀
- **circuit-flow（电路控制流 · 业务/代码全流程首选）**：唯一入口与出口严格共主轴（默认 \`orientation:"vertical"\` 自上而下，可选 \`"horizontal"\` 自左向右）；单边守卫/throw/return 用 \`earlyExit:true\` 保主轴直下、早退挂侧翼；平级多路 \`if/else/switch\` 水平齐平对称横展，汇合点位于最深分支底部回归中轴；\`while/for\` 回环标注 \`kind:"loop"\`。支持 \`edgeRouting:"orthogonal" | "straight"\`。
- **tree（树状纯直线调用图）**：适用于接口调用链/架构树/组织架构，推荐 \`edgeRouting:"straight"\`，支持多父汇聚节点与单边 \`routingType:"orthogonal"\` 回环。
- **swimlane（跨角色泳道图）**：按角色/系统分道（\`lanes\` 必填，\`orientation:"horizontal" | "vertical"\`）。
- **tiered-dag（分层部署拓扑）**：纯 DAG 居中分层展示组件架构。
- **timeline-annotated（纵向时间线）**：严格线性阶段串联 + 密集多列附注。

## 2. 初始化与协同铁律
1. **整图初始化必须调 \`scaffold_diagram\`**，禁止用 \`apply_ops\` 逐点堆砌复杂整图。
2. 局部微调后再用 \`apply_ops\`；节点坐标或结构变动较大后调用 \`auto_layout\`（电路图用 \`mode:"circuit"\`，树状图用 \`mode:"tree"\`）。
3. 可先通过 \`resources/read\` 读取 \`flowstudio://templates/<presetId>\` 查看完整标准样例。
`;

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'list_diagrams',
    description: '列出局域网画图平台中的所有流程图与泳道图，返回标题、更新时间与浏览器访问 URL',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'create_diagram',
    description: '在画图平台中创建一张新图，返回唯一 ID 与浏览器访问 URL',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '流程图标题' },
      },
      required: ['title'],
    },
  },
  {
    name: 'get_diagram',
    description: '以紧凑结构读取指定图表的当前全量数据（包含标题、范式、方向、连线路由、泳道划分、节点与连线集合）',
    inputSchema: {
      type: 'object',
      properties: {
        diagramId: { type: 'string', description: '图表 ID' },
      },
      required: ['diagramId'],
    },
  },
  {
    name: 'get_selection',
    description: '查询某位在线同事当前在画布上选中的节点（经 Awareness 实时感知），支持针对其选中内容做增量补充',
    inputSchema: {
      type: 'object',
      properties: {
        diagramId: { type: 'string', description: '图表 ID' },
        nickname: { type: 'string', description: '可选，同事昵称过滤' },
      },
      required: ['diagramId'],
    },
  },
  {
    name: 'scaffold_diagram',
    description:
      '以 DiagramSpec 语义规范生成或重渲染图表（5 范式：circuit-flow 电路控制流[复杂业务/代码全流程首选] / tree 纯直线树状图 / swimlane 跨角色泳道 / tiered-dag 分层拓扑 / timeline-annotated 时间线）。' +
      '选型口诀：有分支汇合/守卫早退(earlyExit:true)/循环(kind:"loop")/跨段旁路(kind:"jump")用 circuit-flow；纯直线树展开用 tree + edgeRouting:"straight"；跨部门/端分道用 swimlane。' +
      '黄金迷你骨架(circuit-flow)：{"paradigm":"circuit-flow","nodes":[{"id":"s","label":"入口","type":"start-end"},{"id":"g","label":"校验？","type":"decision"},{"id":"err","label":"throw异常","type":"start-end","earlyExit":true},{"id":"d","label":"分流","type":"decision"},{"id":"a","label":"路A"},{"id":"b","label":"路B"},{"id":"e","label":"出口","type":"start-end"}],"edges":[{"from":"s","to":"g"},{"from":"g","to":"err","kind":"branch","label":"否"},{"from":"g","to":"d","label":"是"},{"from":"d","to":"a","kind":"branch"},{"from":"d","to":"b","kind":"branch"},{"from":"a","to":"e"},{"from":"b","to":"e"}]}；' +
      '黄金迷你骨架(tree直线)：{"paradigm":"tree","edgeRouting":"straight","nodes":[{"id":"api","label":"入口"},{"id":"s1","label":"服务1"},{"id":"s2","label":"服务2"},{"id":"db","label":"共享DB","type":"database"}],"edges":[{"from":"api","to":"s1"},{"from":"api","to":"s2"},{"from":"s1","to":"db"},{"from":"s2","to":"db"}]}。' +
      '支持通过 MCP resources/list 与 resources/read 读取 flowstudio://guide/ai-drawing 与 flowstudio://templates/<id> 完整预设；同侧多连线自动均匀分摊防重叠。',
    inputSchema: {
      type: 'object',
      properties: {
        diagramId: { type: 'string', description: '图表 ID' },
        title: { type: 'string', description: '可选更新标题' },
        agentName: { type: 'string', description: '可选 AI 协作者名称（写入批次账本）' },
        spec: z.toJSONSchema(diagramSpecSchema),
      },
      required: ['diagramId', 'spec'],
    },
  },
  {
    name: 'apply_ops',
    description:
      '【仅用于局部增量编辑，初始化复杂整图禁用 apply_ops（请用 scaffold_diagram）】以原子事务批量执行增量操作（add_node / update_node / delete_node / connect / disconnect / ' +
      'move_node / move_to_lane / update_edge / add_lane / insert_between），结构变动大后建议调用 auto_layout 收拢布局；' +
      'add_node/update_node 支持 earlyExit；connect 支持 kind（next/branch/loop/jump/annotate/tree）、strokeStyle 与 routingType。',
    inputSchema: z.toJSONSchema(applyOpsInputSchema) as any,
  },
  {
    name: 'auto_layout',
    description:
      '对指定图表执行服务端自动排版（circuit 电路控制流 / layered 分层正交 / tree 树状纯直线；省略 edgeRouting 时保留原图折线或直线状态不误洗），并刷新未锁定、未人工手调的连线端口分布以消除同点重叠',
    inputSchema: {
      type: 'object',
      properties: {
        diagramId: { type: 'string', description: '图表 ID' },
        direction: { type: 'string', enum: ['RIGHT', 'DOWN'], description: '排版方向：DOWN (纵向) 或 RIGHT (横向)' },
        mode: { type: 'string', enum: ['circuit', 'layered', 'tree'], description: '排版模式：circuit (电路控制流) / layered (ELK分层) / tree (树状纯直线)' },
        edgeRouting: { type: 'string', enum: ['orthogonal', 'straight'], description: '可选覆盖连线路由：orthogonal / straight' },
        agentName: { type: 'string', description: '可选 AI 协作者名称' },
      },
      required: ['diagramId'],
    },
  },
  {
    name: 'undo_ai_batch',
    description: '撤回指定 AI 批次（不传 batchId 时默认撤回最近一条活跃 AI 批次），字段级防冲突保留人类同事二次修改',
    inputSchema: {
      type: 'object',
      properties: {
        diagramId: { type: 'string', description: '图表 ID' },
        batchId: { type: 'string', description: '可选，指定要撤回的 AI 批次 ID' },
      },
      required: ['diagramId'],
    },
  },
  {
    name: 'search_nodes',
    description: '按关键词、泳道或节点类型局部检索图表中的节点及其直接关联连线，避免大图全量读取浪费上下文',
    inputSchema: {
      type: 'object',
      properties: {
        diagramId: { type: 'string', description: '图表 ID' },
        query: { type: 'string', description: '可选，节点名称或 ID 关键词' },
        laneId: { type: 'string', description: '可选，按所属泳道 ID 过滤' },
        type: { type: 'string', description: '可选，按节点类型过滤' },
        limit: { type: 'number', description: '可选，最大返回节点数（默认 50，上限 200）' },
      },
      required: ['diagramId'],
    },
  },
];

export interface McpPluginOptions {
  repo: DiagramRepository;
  batchManager?: AiBatchManager;
  writer?: DocumentWriter;
}

function parseOrThrow<T>(schema: ZodType<T>, payload: unknown, toolName: string): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; ');
    throw new Error(`工具 ${toolName} 入参校验失败: ${details}`);
  }
  return parsed.data;
}

export const mcpPlugin: FastifyPluginAsync<McpPluginOptions> = async (fastify, options) => {
  const collaborator = new AiCollaborator(
    options.repo,
    'http://127.0.0.1:3000',
    options.batchManager,
    options.writer,
  );

  fastify.post('/', async (request, reply) => {
    const body = (request.body || {}) as {
      jsonrpc?: string;
      id?: string | number;
      method?: string;
      params?: any;
    };

    if (body.id === undefined) {
      return reply.code(202).send();
    }

    const requestId = body.id;

    if (body.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: requestId,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {}, resources: {} },
          serverInfo: {
            name: 'flowstudio-mcp-server',
            version: '0.1.0',
          },
        },
      };
    }

    if (body.method === 'ping') {
      return { jsonrpc: '2.0', id: requestId, result: {} };
    }

    if (body.method === 'resources/list') {
      return {
        jsonrpc: '2.0',
        id: requestId,
        result: {
          resources: [
            {
              uri: 'flowstudio://guide/ai-drawing',
              name: 'FlowStudio AI 绘图指南与选型铁律',
              description: '涵盖 5 范式选型决策卡、circuit-flow 早退/汇合写法、tree 直线调用图规范',
              mimeType: 'text/markdown',
            },
            ...DIAGRAM_PRESETS.map((p) => ({
              uri: `flowstudio://templates/${p.id}`,
              name: p.title,
              description: `[${p.category}] ${p.description}`,
              mimeType: 'application/json',
            })),
          ],
        },
      };
    }

    if (body.method === 'resources/read') {
      const uri = typeof body.params?.uri === 'string' ? body.params.uri : '';
      if (uri === 'flowstudio://guide/ai-drawing') {
        return {
          jsonrpc: '2.0',
          id: requestId,
          result: {
            contents: [
              {
                uri,
                mimeType: 'text/markdown',
                text: AI_DRAWING_GUIDE_MD,
              },
            ],
          },
        };
      }
      if (uri.startsWith('flowstudio://templates/')) {
        const presetId = uri.slice('flowstudio://templates/'.length);
        const preset = DIAGRAM_PRESETS.find((p) => p.id === presetId);
        if (preset) {
          return {
            jsonrpc: '2.0',
            id: requestId,
            result: {
              contents: [
                {
                  uri,
                  mimeType: 'application/json',
                  text: JSON.stringify(preset, null, 2),
                },
              ],
            },
          };
        }
      }
      return reply.status(404).send({
        jsonrpc: '2.0',
        id: requestId,
        error: { code: -32002, message: `未知资源 URI: ${uri}` },
      });
    }

    if (body.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id: requestId,
        result: {
          tools: MCP_TOOLS,
        },
      };
    }

    if (body.method === 'tools/call') {
      const toolName = body.params?.name;
      const args = body.params?.arguments || {};

      try {
        let toolResult: unknown;

        switch (toolName) {
          case 'list_diagrams':
            toolResult = await collaborator.listDiagrams();
            break;
          case 'create_diagram':
            toolResult = await collaborator.createDiagram(args.title);
            break;
          case 'get_diagram':
            toolResult = await collaborator.getDiagram(args.diagramId);
            break;
          case 'get_selection':
            toolResult = await collaborator.getSelection(
              args.diagramId,
              parseOrThrow(getSelectionInputSchema, args, 'get_selection').nickname,
            );
            break;
          case 'scaffold_diagram':
            toolResult = await collaborator.scaffoldDiagram(
              parseOrThrow(scaffoldDiagramInputSchema, args, 'scaffold_diagram'),
            );
            break;
          case 'apply_ops': {
            const validated = parseOrThrow(applyOpsInputSchema, args, 'apply_ops');
            toolResult = await collaborator.applyOps({
              diagramId: validated.diagramId,
              agentName: validated.agentName,
              atomic: validated.atomic,
              ops: validated.ops as unknown as McpOp[],
            });
            break;
          }
          case 'auto_layout':
            toolResult = await collaborator.autoLayout(
              parseOrThrow(autoLayoutInputSchema, args, 'auto_layout'),
            );
            break;
          case 'undo_ai_batch':
            toolResult = await collaborator.undoAiBatch(
              parseOrThrow(undoAiBatchInputSchema, args, 'undo_ai_batch'),
            );
            break;
          case 'search_nodes':
            toolResult = await collaborator.searchNodes(
              parseOrThrow(searchNodesInputSchema, args, 'search_nodes'),
            );
            break;
          default:
            return reply.status(404).send({
              jsonrpc: '2.0',
              id: requestId,
              error: { code: -32601, message: `未知工具: ${toolName}` },
            });
        }

        return {
          jsonrpc: '2.0',
          id: requestId,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(toolResult, null, 2),
              },
            ],
          },
        };
      } catch (err: any) {
        return {
          jsonrpc: '2.0',
          id: requestId,
          result: {
            isError: true,
            content: [
              {
                type: 'text',
                text: `执行失败: ${err.message || String(err)}`,
              },
            ],
          },
        };
      }
    }

    return reply.status(400).send({
      jsonrpc: '2.0',
      id: requestId,
      error: { code: -32600, message: `不支持的方法: ${body.method}` },
    });
  });
};

/**
 * @fileoverview MCP (Model Context Protocol) JSON-RPC 2.0 服务端路由
 * @description 为外部 Agent 提供 Streamable HTTP / JSON-RPC 2.0 端点，承载 9 大协同图元工具
 */

import type { FastifyPluginAsync } from 'fastify';
import { z, type ZodType } from 'zod';
import { diagramSpecSchema } from '@flowstudio/shared';
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
    description: '以紧凑结构读取指定图表的当前全量数据（包含标题、泳道划分、节点集合与连线集合）',
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
      '以 DiagramSpec 语义规范生成或重渲染图表（vertical-flow / timeline-annotated / swimlane / tiered-dag / tree 五范式确定性排版：' +
      'swimlane 支持 orientation（horizontal 横向泳道 / vertical 竖向分列泳道）严格按因果推进；tree 支持树优先分层展开与多父共享汇聚节点（适合代码全链路展开）；' +
      '支持图级 edgeRouting（orthogonal 折线 / straight 纯直线）与边级 routingType 覆盖；' +
      '同节点同侧多条连线与双向边会自动均匀分摊端口防重叠（常规无需手算 sourceHandle/targetHandle，必要时可传 top/right/bottom/left 或 side@0.04~0.96 精调）；' +
      'edges 支持 strokeStyle（solid 实线 / dashed 虚线用于异步、可选旁路或回调 / dotted 点线用于弱依赖参考；annotate 附注边默认 dashed）',
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
      '以原子事务批量执行增量编辑操作（add_node / update_node / delete_node / connect / disconnect / ' +
      'move_node / move_to_lane / update_edge / add_lane / insert_between），自动触发前置快照、' +
      '记录实体级 Diff 账本并遵守节点锚定锁；支持 atomic 模式在失败时整体回滚并给出自纠建议；' +
      'connect 支持 kind（next/branch/loop/jump/annotate/tree），留空 sourceHandle/targetHandle 时自动推断最优侧向并避开同侧已有连线防重叠（传纯方向如 right 仍自动选空位，传 side@0.04~0.96 精确保留）；' +
      'jump 表示主干跨段旁路（跳过中段直达下游主干，不改变节点角色），' +
      'loop 支持分支通过结果回归源主干节点（双重判断回归，横向侧路），' +
      'add_node 支持 role/attachTo 语义字段；' +
      'connect / update_edge / insert_between 支持 strokeStyle（solid 实线 / dashed 虚线 / dotted 点线，annotate 默认 dashed）、routingType（orthogonal 折线 / straight 纯直线）及 style.strokeColor / strokeWidth',
    inputSchema: z.toJSONSchema(applyOpsInputSchema) as any,
  },
  {
    name: 'auto_layout',
    description: '对指定图表执行服务端自动排版（layered 分层正交 / tree 自上而下树状展开；纵向泳道默认 DOWN），并刷新未锁定、未人工手调的连线端口分布以消除同点重叠',
    inputSchema: {
      type: 'object',
      properties: {
        diagramId: { type: 'string', description: '图表 ID' },
        direction: { type: 'string', enum: ['RIGHT', 'DOWN'], description: '排版方向：RIGHT (横向) 或 DOWN (纵向)' },
        mode: { type: 'string', enum: ['layered', 'tree'], description: '排版模式：layered (分层) 或 tree (树优先展开)' },
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

/**
 * 使用 Zod 校验 MCP 工具入参，失败时抛出带可读明细的错误
 */
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

    // 1. 初始化握手
    if (body.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: requestId,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
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

    // 2. 工具列表查询
    if (body.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id: requestId,
        result: {
          tools: MCP_TOOLS,
        },
      };
    }

    // 3. 工具执行调用
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

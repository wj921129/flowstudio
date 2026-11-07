/**
 * @fileoverview MCP (Model Context Protocol) JSON-RPC 2.0 服务端路由
 * @description 为外部 Agent 提供 Streamable HTTP / JSON-RPC 2.0 端点，承载 7 大协同图元工具
 */

import type { FastifyPluginAsync } from 'fastify';
import type { DiagramRepository } from '../db/diagram-repository.js';
import type { AiBatchManager } from '../collaboration/ai-batch-manager.js';
import { AiCollaborator } from './ai-collaborator.js';
import type { McpToolDefinition } from './types.js';

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
    description: '一次性生成结构化骨架（支持横向泳道 Pool + 多个 Lane，或常规流程图），服务端自动排版并生成前置备份快照',
    inputSchema: {
      type: 'object',
      properties: {
        diagramId: { type: 'string', description: '图表 ID' },
        title: { type: 'string', description: '可选更新标题' },
        lanes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
            },
            required: ['id', 'label'],
          },
          description: '泳道定义列表（若有则自动创建 Pool 与 Lane 容器）',
        },
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: { type: 'string', description: '节点类型，如 process, decision, io, database, start-end 等' },
              label: { type: 'string' },
              laneId: { type: 'string', description: '归属的泳道 ID' },
            },
            required: ['id', 'type', 'label'],
          },
          description: '业务节点定义列表',
        },
        edges: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              source: { type: 'string' },
              target: { type: 'string' },
              label: { type: 'string' },
            },
            required: ['source', 'target'],
          },
          description: '连线定义列表',
        },
      },
      required: ['diagramId', 'nodes', 'edges'],
    },
  },
  {
    name: 'apply_ops',
    description: '以原子事务批量执行增量编辑操作（添加节点、更新标签、删除、跨泳道连线等），自动触发前置快照并进行局部保护排版',
    inputSchema: {
      type: 'object',
      properties: {
        diagramId: { type: 'string', description: '图表 ID' },
        ops: {
          type: 'array',
          description: '增量原子操作列表',
          items: { type: 'object' },
        },
      },
      required: ['diagramId', 'ops'],
    },
  },
  {
    name: 'auto_layout',
    description: '对指定图表执行服务端分层正交自动排版',
    inputSchema: {
      type: 'object',
      properties: {
        diagramId: { type: 'string', description: '图表 ID' },
        direction: { type: 'string', enum: ['RIGHT', 'DOWN'], description: '排版方向：RIGHT (横向) 或 DOWN (纵向)' },
      },
      required: ['diagramId'],
    },
  },
];

export interface McpPluginOptions {
  repo: DiagramRepository;
  batchManager?: AiBatchManager;
}

export const mcpPlugin: FastifyPluginAsync<McpPluginOptions> = async (fastify, options) => {
  const collaborator = new AiCollaborator(options.repo, 'http://127.0.0.1:3000', options.batchManager);

  fastify.post('/', async (request, reply) => {
    const body = (request.body || {}) as {
      jsonrpc?: string;
      id?: string | number;
      method?: string;
      params?: any;
    };

    const requestId = body.id ?? 1;

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

    if (body.method === 'notifications/initialized' || body.method === 'ping') {
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
            toolResult = await collaborator.getSelection(args.diagramId, args.nickname);
            break;
          case 'scaffold_diagram':
            toolResult = await collaborator.scaffoldDiagram(args);
            break;
          case 'apply_ops':
            toolResult = await collaborator.applyOps(args);
            break;
          case 'auto_layout':
            toolResult = await collaborator.autoLayout(args);
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

#!/usr/bin/env node
/**
 * @fileoverview FlowStudio MCP stdio 桥接器
 * @description 允许仅支持 stdio 传输协议的 Agent 客户端（如 Claude Desktop、Cursor）无缝连接到 FlowStudio 局域网服务
 * @example
 * node mcp/flowstudio-mcp.cjs --url http://192.168.1.100:3000/mcp
 */

const readline = require('node:readline');
const http = require('node:http');

// 解析启动参数 --url
const args = process.argv.slice(2);
let targetUrl = 'http://127.0.0.1:3000/mcp';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--url' && args[i + 1]) {
    targetUrl = args[i + 1];
    i++;
  }
}

const parsedUrl = new URL(targetUrl);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let jsonRpcReq;
  try {
    jsonRpcReq = JSON.parse(trimmed);
  } catch (err) {
    const errorResponse = {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error: invalid JSON' },
    };
    process.stdout.write(JSON.stringify(errorResponse) + '\n');
    return;
  }

  const payload = Buffer.from(JSON.stringify(jsonRpcReq), 'utf8');

  const req = http.request(
    {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 80,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
      },
      timeout: 15000,
    },
    (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const bodyStr = Buffer.concat(chunks).toString('utf8');
        try {
          const jsonRes = JSON.parse(bodyStr);
          process.stdout.write(JSON.stringify(jsonRes) + '\n');
        } catch {
          process.stdout.write(bodyStr + '\n');
        }
      });
    }
  );

  req.on('error', (err) => {
    const errorResponse = {
      jsonrpc: '2.0',
      id: jsonRpcReq.id ?? null,
      error: {
        code: -32000,
        message: `FlowStudio MCP 服务端连接失败 (${targetUrl}): ${err.message}`,
      },
    };
    process.stdout.write(JSON.stringify(errorResponse) + '\n');
  });

  req.on('timeout', () => {
    req.destroy();
    const errorResponse = {
      jsonrpc: '2.0',
      id: jsonRpcReq.id ?? null,
      error: {
        code: -32000,
        message: `FlowStudio MCP 服务端响应超时 (${targetUrl})`,
      },
    };
    process.stdout.write(JSON.stringify(errorResponse) + '\n');
  });

  req.write(payload);
  req.end();
});

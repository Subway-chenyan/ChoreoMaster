import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import type { McpRuntimeContext } from './context.js';
import type { McpChangeHistory } from './history.js';
import { registerChoreoTools } from './tools.js';

// 参考 create-mcp-app 技能的 stateless Streamable HTTP 模式：
// 每个 POST /mcp 请求新建 McpServer + transport（无会话状态），工具层依赖注入共享的 runtime/history。
// 所有 handler 在 server.connect() 之前注册完成。

const MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024;
const SERVER_NAME = 'cosstage-mcp';
const SERVER_VERSION = '1.0.0';

export interface McpHttpServer {
  port: number;
  close(): Promise<void>;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_REQUEST_BODY_BYTES) {
      throw new Error('request body too large');
    }
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return undefined;
  return JSON.parse(text);
}

export interface StartMcpServerOptions {
  port: number;
  token?: string;
  runtime: McpRuntimeContext;
  history: McpChangeHistory;
}

export async function startMcpServer(options: StartMcpServerOptions): Promise<McpHttpServer> {
  const { port, token, runtime, history } = options;

  const httpServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/mcp') {
        sendJson(res, 404, { error: 'not found', hint: 'MCP endpoint is /mcp' });
        return;
      }

      // 可选 Bearer Token 鉴权
      if (token && req.headers.authorization !== `Bearer ${token}`) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }

      if (req.method !== 'POST') {
        // stateless 模式：仅支持 POST；GET（旧 SSE 流）/ DELETE 返回 405
        res.writeHead(405, { Allow: 'POST' }).end();
        return;
      }

      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        sendJson(res, 400, {
          jsonrpc: '2.0',
          error: { code: -32700, message: `Parse error: ${(error as Error).message}` },
          id: null,
        });
        return;
      }

      const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
      registerChoreoTools(server, runtime, history);
      const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });

      res.on('close', () => {
        transport.close().catch(() => undefined);
        server.close().catch(() => undefined);
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      console.error('[mcp] request handling failed:', error);
      if (!res.headersSent) {
        sendJson(res, 500, {
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    httpServer.once('error', onError);
    httpServer.listen(port, '127.0.0.1', () => {
      httpServer.off('error', onError);
      resolve();
    });
  });

  // port=0 时返回实际分配的端口（测试用随机端口）
  const address = httpServer.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  console.log(`[mcp] CosStage MCP 服务已启动: http://127.0.0.1:${boundPort}/mcp`);

  return {
    port: boundPort,
    close: () => new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    }),
  };
}

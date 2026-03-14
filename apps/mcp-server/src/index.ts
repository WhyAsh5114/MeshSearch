#!/usr/bin/env node
/**
 * MeshSearch MCP Server — Private Web Search for AI Agents
 *
 * Exposes three tools:
 * - private_search: Execute a private search with ZK proof + x402 payment
 * - get_history: Retrieve and decrypt search history from Fileverse
 * - compile_report: Aggregate searches into an encrypted research report
 *
 * Transport modes (MCP_TRANSPORT env var):
 *   http  (default) — Streamable HTTP on PORT (default 3000), endpoint POST/GET/DELETE /mcp
 *   stdio           — stdin/stdout for Claude Desktop / Cursor
 */

import 'dotenv/config';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadConfig } from './config.js';
import { registerPrivateSearchTool } from './tools/private-search.js';
import { registerGetHistoryTool } from './tools/get-history.js';
import { registerCompileReportTool } from './tools/compile-report.js';
import { processX402, writeX402Response } from './middleware/x402-payment.js';

const config = loadConfig();
const TRANSPORT_MODE = process.env.MCP_TRANSPORT ?? 'http';
const PORT = parseInt(process.env.PORT ?? '3000', 10);
// Bind to 0.0.0.0 so Tailscale / LAN clients can reach the server.
// Override with MCP_HOST env var if needed.
const HOST = process.env.MCP_HOST ?? '0.0.0.0';

// ─── Logging helpers ────────────────────────────────────────────────────────
const dim   = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow= (s: string) => `\x1b[33m${s}\x1b[0m`;
const red   = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan  = (s: string) => `\x1b[36m${s}\x1b[0m`;

function logReq(method: string, path: string, extra: string = '') {
  const ts = new Date().toLocaleTimeString();
  console.error(`${dim(ts)} ${cyan('→')} ${method} ${path}${extra ? '  ' + dim(extra) : ''}`);
}
function logRes(method: string, path: string, status: number, ms: number, extra: string = '') {
  const ts = new Date().toLocaleTimeString();
  const color = status < 300 ? green : status < 400 ? yellow : red;
  console.error(`${dim(ts)} ${color('←')} ${method} ${path} ${color(String(status))} ${dim(ms + 'ms')}${extra ? '  ' + extra : ''}`);
}

function buildMcpServer(): McpServer {
  const server = new McpServer({ name: 'meshsearch', version: '0.1.0' });
  registerPrivateSearchTool(server, config);
  registerGetHistoryTool(server, config);
  registerCompileReportTool(server, config);
  return server;
}

// ─── Stdio mode ──────────────────────────────────────────────────────────────
if (TRANSPORT_MODE === 'stdio') {
  const transport = new StdioServerTransport();
  await buildMcpServer().connect(transport);
  console.error('MeshSearch MCP server running on stdio');
}

// ─── HTTP / SSE mode ──────────────────────────────────────────────────────────
else {
  // One transport instance per session — keeps tool state isolated per client.
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  function cors(req: IncomingMessage, res: ServerResponse): void {
    // Echo back the request Origin (required when fetch uses credentials: include,
    // which browser-based MCP clients like llama.cpp web UI do by default).
    // Fall back to * for non-browser callers like curl.
    const origin = (req.headers['origin'] as string | undefined) ?? '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id, mcp-protocol-version, authorization, x-payment, payment-signature');
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id, mcp-protocol-version, x-payment-response, payment-required, payment-response');
  }

  async function readBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return JSON.parse(Buffer.concat(chunks).toString());
  }

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const start = Date.now();
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';
    const pathname = url.split('?')[0];
    const sid = req.headers['mcp-session-id'] as string | undefined;

    cors(req, res);

    // Log incoming request
    logReq(method, pathname, sid ? `sid=${sid.slice(0, 8)}…` : '');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      logRes(method, pathname, 204, Date.now() - start, 'CORS preflight');
      return;
    }

    // ── Health check ────────────────────────────────────────────────────────
    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', transport: 'http', sessions: sessions.size }));
      logRes(method, pathname, 200, Date.now() - start, `sessions=${sessions.size}`);
      return;
    }

    if (pathname !== '/mcp') {
      // Catch common mistake: accessing root instead of /mcp
      if (pathname === '/' || pathname === '') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          name: 'meshsearch',
          version: '0.1.0',
          mcp_endpoint: '/mcp',
          health_endpoint: '/health',
          protocol: 'MCP Streamable HTTP',
          hint: 'POST to /mcp with Accept: application/json, text/event-stream',
        }));
        logRes(method, pathname, 200, Date.now() - start, 'server info');
        return;
      }
      res.writeHead(404);
      res.end('Not found');
      logRes(method, pathname, 404, Date.now() - start);
      return;
    }

    // ── DELETE — close session ───────────────────────────────────────────────
    if (method === 'DELETE') {
      if (sid) {
        await sessions.get(sid)?.close();
        sessions.delete(sid);
      }
      res.writeHead(204);
      res.end();
      logRes(method, pathname, 204, Date.now() - start, 'session closed');
      return;
    }

    // ── Buffer POST body early so we can peek at JSON-RPC method ────────────
    let body: unknown | undefined;
    if (method === 'POST') {
      try {
        body = await readBody(req);
      } catch {
        res.writeHead(400);
        res.end('Invalid JSON');
        logRes(method, pathname, 400, Date.now() - start, red('invalid JSON'));
        return;
      }
    }

    // Peek at JSON-RPC method for logging + x402 gating
    const rpcMethod = body && typeof body === 'object' && 'method' in (body as Record<string, unknown>)
      ? String((body as Record<string, unknown>).method)
      : method === 'GET' ? 'SSE listen' : undefined;

    // ── x402 payment gate (tools/call only) ────────────────────────────────
    // Standard x402 enforcement: no payment-signature header → 402 with
    // PaymentRequired so x402-aware clients can create + retry with payment.
    if (method === 'POST' && rpcMethod === 'tools/call') {
      const x402 = await processX402(req);
      if (x402.type === 'blocked') {
        writeX402Response(res, x402);
        logRes(method, pathname, x402.status ?? 402, Date.now() - start, red('x402 — payment required'));
        return;
      }
      if (x402.settlementHeaders) {
        for (const [k, v] of Object.entries(x402.settlementHeaders)) {
          res.setHeader(k, v);
        }
        logReq(method, pathname, green('x402 payment verified + settled'));
      }
    }

    // ── Route to existing session ────────────────────────────────────────────
    if (sid && sessions.has(sid)) {
      const transport = sessions.get(sid)!;
      await transport.handleRequest(req, res, body);
      logRes(method, pathname, res.statusCode, Date.now() - start, `${cyan(rpcMethod ?? '?')} sid=${sid.slice(0, 8)}…`);
      return;
    }

    // ── Unknown session ID → tell client to re-initialize ────────────────────
    if (sid) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Unknown session. Please re-initialize.' },
        id: null,
      }));
      logRes(method, pathname, 400, Date.now() - start, red(`unknown sid=${sid.slice(0, 8)}… — stale session`));
      return;
    }

    // ── New session — must be a POST initialization message ──────────────────
    if (method !== 'POST') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing or unknown mcp-session-id' }));
      logRes(method, pathname, 400, Date.now() - start, red('no session ID'));
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };

    await buildMcpServer().connect(transport);

    // Register session (sessionId set at construction; re-register after handleRequest
    // in case the transport updates it during initialization).
    if (transport.sessionId) sessions.set(transport.sessionId, transport);

    try {
      await transport.handleRequest(req, res, body);
    } catch (err) {
      console.error('MCP handleRequest error:', err);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Internal server error');
      }
    }

    // Re-register in case sessionId was assigned during request handling.
    if (transport.sessionId) {
      sessions.set(transport.sessionId, transport);
      logRes(method, pathname, res.statusCode, Date.now() - start, green(`new session ${transport.sessionId.slice(0, 8)}…`) + ` (total: ${sessions.size})`);
    } else {
      logRes(method, pathname, res.statusCode, Date.now() - start, red('session init failed'));
    }
  });

  httpServer.listen(PORT, HOST, () => {
    console.error(`MeshSearch MCP server (HTTP) listening on http://${HOST}:${PORT}/mcp`);
    console.error(`  Health:          http://${HOST}:${PORT}/health`);
    console.error(`  For llama.cpp / Tailscale: http://<your-tailscale-ip>:${PORT}/mcp`);
  });
}

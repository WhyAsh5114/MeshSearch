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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id, mcp-protocol-version, authorization, x-payment');
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id, mcp-protocol-version, x-payment-response');
  }

  async function readBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return JSON.parse(Buffer.concat(chunks).toString());
  }

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    cors(req, res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const pathname = (req.url ?? '/').split('?')[0];

    // ── Health check ────────────────────────────────────────────────────────
    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', transport: 'http', sessions: sessions.size }));
      return;
    }

    if (pathname !== '/mcp') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    // ── x402 payment gate (POST /mcp only) ──────────────────────────────────
    if (req.method === 'POST') {
      const x402 = await processX402(req);
      if (x402.type === 'blocked') {
        writeX402Response(res, x402);
        return;
      }
      // If payment was verified, merge settlement headers into response later
      if (x402.settlementHeaders) {
        for (const [k, v] of Object.entries(x402.settlementHeaders)) {
          res.setHeader(k, v);
        }
      }
    }

    // ── DELETE — close session ───────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const sid = req.headers['mcp-session-id'] as string | undefined;
      if (sid) {
        await sessions.get(sid)?.close();
        sessions.delete(sid);
      }
      res.writeHead(204);
      res.end();
      return;
    }

    const sid = req.headers['mcp-session-id'] as string | undefined;

    // ── Route to existing session ────────────────────────────────────────────
    if (sid && sessions.has(sid)) {
      const transport = sessions.get(sid)!;
      const body = req.method === 'POST' ? await readBody(req).catch(() => undefined) : undefined;
      await transport.handleRequest(req, res, body);
      return;
    }

    // ── New session — must be a POST initialization message ──────────────────
    if (req.method !== 'POST') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing or unknown mcp-session-id' }));
      return;
    }

    let body: unknown;
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(400);
      res.end('Invalid JSON');
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
    if (transport.sessionId) sessions.set(transport.sessionId, transport);
  });

  httpServer.listen(PORT, HOST, () => {
    console.error(`MeshSearch MCP server (HTTP) listening on http://${HOST}:${PORT}/mcp`);
    console.error(`  Health:          http://${HOST}:${PORT}/health`);
    console.error(`  For llama.cpp / Tailscale: http://<your-tailscale-ip>:${PORT}/mcp`);
  });
}

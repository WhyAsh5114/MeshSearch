/**
 * x402 payment middleware — standard Coinbase x402 protocol at the HTTP layer.
 *
 * Uses @x402/core + @x402/evm to gate the POST /mcp endpoint.
 * Clients that don't include an X-PAYMENT header receive HTTP 402 with
 * PaymentRequirements. Once paid, the facilitator verifies + settles.
 *
 * MCP tools never see payment parameters — it's all HTTP-level.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { x402ResourceServer, HTTPFacilitatorClient, x402HTTPResourceServer } from '@x402/core/server';
import type { HTTPAdapter, HTTPRequestContext, RoutesConfig, HTTPProcessResult } from '@x402/core/server';
import { registerExactEvmScheme } from '@x402/evm/exact/server';

// ─── Configuration ──────────────────────────────────────────────────────────

const BASE_SEPOLIA_NETWORK = 'eip155:84532';
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL ?? 'https://x402.org/facilitator';
const PAY_TO = process.env.X402_PAY_TO ?? process.env.PAYMENT_SPLITTER_ADDRESS ?? '0x0000000000000000000000000000000000000000';
const SEARCH_PRICE = process.env.X402_SEARCH_PRICE ?? '$0.001';

// ─── Node.js IncomingMessage → x402 HTTPAdapter ─────────────────────────────

export function createNodeAdapter(req: IncomingMessage): HTTPAdapter {
  return {
    getHeader(name: string) {
      const val = req.headers[name.toLowerCase()];
      return Array.isArray(val) ? val[0] : val;
    },
    getMethod() {
      return req.method ?? 'GET';
    },
    getPath() {
      return (req.url ?? '/').split('?')[0];
    },
    getUrl() {
      return req.url ?? '/';
    },
    getAcceptHeader() {
      return req.headers['accept'] ?? '*/*';
    },
    getUserAgent() {
      return req.headers['user-agent'] ?? '';
    },
  };
}

// ─── x402 HTTP resource server (lazy singleton) ─────────────────────────────

let _httpServer: x402HTTPResourceServer | null = null;

function buildRoutesConfig(): RoutesConfig {
  return {
    'POST /mcp': {
      accepts: {
        scheme: 'exact',
        network: BASE_SEPOLIA_NETWORK,
        payTo: PAY_TO,
        price: SEARCH_PRICE,
      },
      description: 'Private web search via MCP',
      mimeType: 'application/json',
    },
  };
}

export async function getX402Server(): Promise<x402HTTPResourceServer> {
  if (_httpServer) return _httpServer;

  const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
  const resourceServer = new x402ResourceServer(facilitator);
  registerExactEvmScheme(resourceServer);

  _httpServer = new x402HTTPResourceServer(resourceServer, buildRoutesConfig());

  try {
    await _httpServer.initialize();
    console.error('[x402] Initialized — facilitator:', FACILITATOR_URL);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[x402] Facilitator init warning (non-fatal):', msg);
  }

  return _httpServer;
}

// ─── Public middleware API ───────────────────────────────────────────────────

export interface X402Result {
  /** 'pass' → continue to MCP handler; 'blocked' → return the 402 response */
  type: 'pass' | 'blocked';
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  isHtml?: boolean;
  /** Settlement headers to merge into the final response */
  settlementHeaders?: Record<string, string>;
}

/**
 * Run a request through the x402 payment layer.
 * Call before the MCP transport; if blocked, write the 402 and short-circuit.
 */
export async function processX402(req: IncomingMessage): Promise<X402Result> {
  if (process.env.X402_ENABLED === 'false') {
    return { type: 'pass' };
  }

  let server: x402HTTPResourceServer;
  try {
    server = await getX402Server();
  } catch {
    // fail-open in dev so the server still works without a facilitator
    return { type: 'pass' };
  }

  const adapter = createNodeAdapter(req);
  const context: HTTPRequestContext = {
    adapter,
    path: adapter.getPath(),
    method: adapter.getMethod(),
    paymentHeader: adapter.getHeader('x-payment'),
  };

  if (!server.requiresPayment(context)) {
    return { type: 'pass' };
  }

  const result: HTTPProcessResult = await server.processHTTPRequest(context);

  switch (result.type) {
    case 'no-payment-required':
      return { type: 'pass' };

    case 'payment-verified': {
      const settle = await server.processSettlement(
        result.paymentPayload,
        result.paymentRequirements,
        result.declaredExtensions,
      );
      if (settle.success) {
        return { type: 'pass', settlementHeaders: settle.headers };
      }
      console.error('[x402] Settlement failed:', settle.errorReason);
      return { type: 'pass' };
    }

    case 'payment-error':
      return {
        type: 'blocked',
        status: result.response.status,
        headers: result.response.headers,
        body: result.response.body,
        isHtml: result.response.isHtml,
      };
  }
}

/**
 * Write a blocked x402 result to the response and end it.
 */
export function writeX402Response(res: ServerResponse, result: X402Result): void {
  if (result.type !== 'blocked') return;

  const status = result.status ?? 402;
  const headers: Record<string, string> = { ...result.headers };

  if (result.isHtml) {
    headers['Content-Type'] = 'text/html; charset=utf-8';
  } else if (!headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  res.writeHead(status, headers);
  if (result.body != null) {
    res.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body));
  } else {
    res.end();
  }
}

// ─── ENS subscription check (kept for potential hook usage) ─────────────────

const subscribedNames = new Set<string>();

export async function checkENSSubscription(
  ensName: string,
  _rpcUrl: string,
  _contractAddress: string,
): Promise<boolean> {
  if (!ensName || !ensName.endsWith('.eth')) return false;
  return subscribedNames.has(ensName);
}

// Test helpers
export const _testHelpers = {
  addSubscription(ensName: string) {
    subscribedNames.add(ensName);
  },
  resetState() {
    subscribedNames.clear();
    _httpServer = null;
  },
};

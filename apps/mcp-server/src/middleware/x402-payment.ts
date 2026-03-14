/**
 * x402 payment middleware — standard Coinbase x402 protocol at the HTTP layer.
 *
 * Uses @x402/core + @x402/evm to gate the POST /mcp endpoint.
 * Clients that don't include an X-PAYMENT header receive HTTP 402 with
 * PaymentRequirements. Once paid, the facilitator verifies + settles.
 *
 * MCP tools never see payment parameters — it's all HTTP-level.
 *
 * Env vars:
 *   X402_ENABLED          — 'true' to enable, 'false' to bypass (default: false)
 *   X402_PAY_TO           — wallet address that receives payments
 *   X402_SEARCH_PRICE     — price per search in USD, e.g. '$0.001' (default: $0.001)
 *   X402_FACILITATOR_URL  — facilitator endpoint (default: https://x402.org/facilitator)
 *   X402_NETWORK          — CAIP-2 chain ID (default: eip155:84532 = Base Sepolia)
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { x402ResourceServer, HTTPFacilitatorClient, x402HTTPResourceServer } from '@x402/core/server';
import type { HTTPAdapter, HTTPRequestContext, RoutesConfig, HTTPProcessResult } from '@x402/core/server';
import { registerExactEvmScheme } from '@x402/evm/exact/server';

// ─── Configuration ──────────────────────────────────────────────────────────

const NETWORK = process.env.X402_NETWORK ?? 'eip155:84532'; // Base Sepolia
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
        network: NETWORK as `${string}:${string}`,
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
  if (process.env.X402_ENABLED !== 'true') {
    return { type: 'pass' };
  }

  let server: x402HTTPResourceServer;
  try {
    server = await getX402Server();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[x402] Server init failed (fail-open):', msg);
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

  const hasPayment = !!adapter.getHeader('x-payment');
  console.error(`[x402] Payment gate: hasPayment=${hasPayment} payTo=${PAY_TO} price=${SEARCH_PRICE} network=${NETWORK}`);

  const result: HTTPProcessResult = await server.processHTTPRequest(context);

  switch (result.type) {
    case 'no-payment-required':
      console.error('[x402] No payment required for this request');
      return { type: 'pass' };

    case 'payment-verified': {
      console.error('[x402] Payment verified — settling...');
      const settle = await server.processSettlement(
        result.paymentPayload,
        result.paymentRequirements,
        result.declaredExtensions,
      );
      if (settle.success) {
        console.error(`[x402] Settlement success: tx=${settle.transaction} network=${settle.network}`);
        return { type: 'pass', settlementHeaders: settle.headers };
      }
      console.error('[x402] Settlement failed:', settle.errorReason);
      return { type: 'pass' };
    }

    case 'payment-error':
      console.error(`[x402] Payment error — returning ${result.response.status}`);
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

// ─── ENS subscription check — real on-chain resolution + AccessControl ──────

import { resolveEnsName } from '../ens/client.js';

const ACCESS_CONTROL_ABI = [
  'function hasSubscription(string calldata ensName) external view returns (bool)',
  'function getTier(string calldata ensName) external view returns (uint8)',
];

/**
 * Check if an ENS name has an active subscription.
 *
 * 1. Forward-resolve the ENS name → Ethereum address via @ensdomains/ensjs (L1)
 * 2. Query the AccessControl contract on Base Sepolia for subscription status
 *
 * Returns true only if the name resolves AND has an active subscription.
 */
export async function checkENSSubscription(
  ensName: string,
  rpcUrl: string,
  contractAddress: string,
): Promise<boolean> {
  if (!ensName || !ensName.endsWith('.eth')) return false;

  // 1. Resolve ENS name on Ethereum mainnet
  const resolvedAddress = await resolveEnsName(ensName);
  if (!resolvedAddress) {
    console.error(`[ens-sub] ENS name '${ensName}' does not resolve to any address`);
    return false;
  }

  console.error(`[ens-sub] ${ensName} → ${resolvedAddress}`);

  // 2. Check AccessControl contract for subscription tier
  if (contractAddress === '0x0000000000000000000000000000000000000000') {
    // No contract deployed — fall back to in-memory set for development
    return subscribedNames.has(ensName);
  }

  try {
    const { ethers } = await import('ethers');
    const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
      staticNetwork: true,
      batchMaxCount: 1,
    });
    const contract = new ethers.Contract(contractAddress, ACCESS_CONTROL_ABI, provider);
    const hasSub: boolean = await Promise.race([
      contract.hasSubscription(ensName),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('AccessControl query timed out')), 5000)
      ),
    ]);
    return hasSub;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ens-sub] AccessControl query failed for ${ensName}: ${msg}`);
    // If contract is unreachable, fall back to in-memory for development
    return subscribedNames.has(ensName);
  }
}

// In-memory fallback for development (when AccessControl contract not deployed)
const subscribedNames = new Set<string>();

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

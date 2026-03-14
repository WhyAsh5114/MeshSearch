/**
 * Relay Node — Onion-decrypting HTTP relay for encrypted query forwarding.
 *
 * Each relay node:
 * - Holds a secp256k1 private key
 * - Has an ENS name that is verified on-chain at startup
 * - Receives an onion layer encrypted for its public key
 * - Decrypts ONLY its layer to learn:
 *     a) The next hop URL (next relay or search backend)
 *     b) The inner payload (still encrypted for the next hop)
 * - Forwards the inner payload to the next hop
 * - Cannot see the plaintext query or the full route
 */

import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { RelayRequest, RelayResponse, OnionLayer } from '@meshsearch/types';
import { decryptOnionLayer, getPublicKey } from '@meshsearch/crypto';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { addEnsContracts } from '@ensdomains/ensjs';
import { getAddressRecord } from '@ensdomains/ensjs/public';

const app = new Hono();

const ENS_NAME = process.env.RELAY_ENS_NAME || 'relay1.meshsearch.eth';
const PORT = parseInt(process.env.PORT || '4002', 10);
const RELAY_PRIVATE_KEY = process.env.RELAY_PRIVATE_KEY || '';

if (!RELAY_PRIVATE_KEY) {
  console.error('FATAL: RELAY_PRIVATE_KEY is required. Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
}

// ─── ENS name verification at startup ───────────────────────────────────────

let ensVerified = false;
let ensResolvedAddress: string | null = null;

async function verifyEnsName(): Promise<void> {
  if (!ENS_NAME.endsWith('.eth')) {
    console.warn(`[ens] Relay ENS name '${ENS_NAME}' does not end with .eth — skipping verification`);
    return;
  }

  try {
    const ensClient = createPublicClient({
      chain: addEnsContracts(mainnet),
      transport: http(process.env.ENS_RPC_URL || undefined),
    });

    const result = await getAddressRecord(ensClient, { name: ENS_NAME });
    if (result?.value) {
      ensResolvedAddress = result.value;
      ensVerified = true;
      console.log(`[ens] Verified: ${ENS_NAME} → ${ensResolvedAddress}`);
    } else {
      console.warn(`[ens] ${ENS_NAME} does not resolve to any address (name may not be registered)`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ens] ENS verification failed (non-fatal): ${msg}`);
  }
}

// Health check — includes public key and ENS verification status
app.get('/health', (c) => {
  const publicKey = RELAY_PRIVATE_KEY ? getPublicKey(RELAY_PRIVATE_KEY) : 'missing';
  return c.json({
    status: 'active',
    ensName: ENS_NAME,
    ensVerified,
    ensResolvedAddress,
    publicKey,
    timestamp: Date.now(),
  });
});

// Relay status
app.get('/status', (c) => {
  return c.json({
    ensName: ENS_NAME,
    relayedCount: stats.relayedCount,
    errorCount: stats.errorCount,
    uptime: Date.now() - stats.startedAt,
  });
});

/**
 * POST /relay — Peel one onion layer and forward.
 *
 * Incoming: { routingId, onionLayer: OnionLayer, hopIndex }
 *   - Decrypt onionLayer with this relay's private key
 *   - Parse decrypted JSON: { nextHop, isLastHop, payload }
 *   - If isLastHop: POST payload directly to nextHop (the search backend)
 *   - Otherwise: POST { routingId, onionLayer: payload, hopIndex+1 } to nextHop
 */
app.post('/relay', async (c) => {
  const request = await c.req.json<RelayRequest>();

  if (!request.routingId || !request.onionLayer) {
    stats.errorCount++;
    return c.json({ error: 'Invalid relay request' }, 400);
  }

  try {
    // 1. Decrypt our onion layer
    const decrypted = await decryptOnionLayer(request.onionLayer, RELAY_PRIVATE_KEY);
    const { nextHop, isLastHop, payload } = JSON.parse(decrypted) as {
      nextHop: string;
      isLastHop: boolean;
      payload: OnionLayer | { encryptedQuery: unknown };
    };

    let downstreamResult: unknown;

    if (isLastHop) {
      // 2a. This is the last relay — forward directly to the search backend
      const backendResponse = await fetch(nextHop, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!backendResponse.ok) {
        stats.errorCount++;
        return c.json({
          routingId: request.routingId,
          encryptedResult: '',
          success: false,
        } satisfies RelayResponse, 502);
      }
      downstreamResult = await backendResponse.json();
    } else {
      // 2b. Not the last relay — forward to the next relay with inner onion layer
      const nextReq: RelayRequest = {
        routingId: request.routingId,
        onionLayer: payload as OnionLayer,
        hopIndex: request.hopIndex + 1,
      };
      const relayResponse = await fetch(nextHop, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextReq),
      });
      if (!relayResponse.ok) {
        stats.errorCount++;
        return c.json({
          routingId: request.routingId,
          encryptedResult: '',
          success: false,
        } satisfies RelayResponse, 502);
      }
      const inner = await relayResponse.json() as RelayResponse;
      if (!inner.success) {
        stats.errorCount++;
        return c.json({
          routingId: request.routingId,
          encryptedResult: '',
          success: false,
        } satisfies RelayResponse, 502);
      }
      downstreamResult = JSON.parse(inner.encryptedResult);
    }

    stats.relayedCount++;

    return c.json({
      routingId: request.routingId,
      encryptedResult: JSON.stringify(downstreamResult),
      success: true,
    } satisfies RelayResponse);
  } catch (error) {
    stats.errorCount++;
    return c.json({
      routingId: request.routingId,
      encryptedResult: '',
      success: false,
    } satisfies RelayResponse, 502);
  }
});

// Stats tracking
const stats = {
  relayedCount: 0,
  errorCount: 0,
  startedAt: Date.now(),
};

// Export for testing
export { app };

// Start server + verify ENS name
serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Relay node ${ENS_NAME} running on port ${PORT}`);
  // Fire-and-forget ENS verification on startup
  verifyEnsName().catch((err) => {
    console.warn(`[ens] Startup verification error: ${err}`);
  });
});

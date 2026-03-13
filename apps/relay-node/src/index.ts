/**
 * Relay Node — Lightweight HTTP server for encrypted query forwarding.
 *
 * Each relay node:
 * - Receives an encrypted blob from the previous hop
 * - Cannot read the query (encryption is layered)
 * - Forwards to the next hop or search backend
 * - Reports success/failure for reputation tracking
 * - Earns a share of the x402 payment
 */

import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { RelayRequest, RelayResponse } from '@meshsearch/types';

const app = new Hono();

const ENS_NAME = process.env.RELAY_ENS_NAME || 'relay1.meshsearch.eth';
const PORT = parseInt(process.env.PORT || '4002', 10);

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'active',
    ensName: ENS_NAME,
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

// Forward encrypted query to next hop
app.post('/relay', async (c) => {
  const request = await c.req.json<RelayRequest>();

  // Validate request structure
  if (!request.routingId || !request.encryptedBlob || !request.nextHop) {
    stats.errorCount++;
    return c.json({ error: 'Invalid relay request' }, 400);
  }

  try {
    // Forward to next hop (next relay or search backend)
    const response = await fetch(`${request.nextHop}/relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        routingId: request.routingId,
        encryptedBlob: request.encryptedBlob,
        hopIndex: request.hopIndex + 1,
        nextHop: '', // Next relay determines this from routing table
        paymentProof: request.paymentProof,
      } satisfies RelayRequest),
    });

    if (!response.ok) {
      stats.errorCount++;
      return c.json({
        routingId: request.routingId,
        encryptedResult: '',
        success: false,
      } satisfies RelayResponse, 502);
    }

    const result = await response.json() as RelayResponse;
    stats.relayedCount++;

    return c.json({
      routingId: request.routingId,
      encryptedResult: result.encryptedResult,
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

// Start server
serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Relay node ${ENS_NAME} running on port ${PORT}`);
});

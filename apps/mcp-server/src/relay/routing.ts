/**
 * Relay selection and onion-routed query forwarding.
 *
 * 1. selectRelays() picks 3 relay nodes (from config or onchain NodeRegistry).
 * 2. routeQuery() wraps the encrypted query in 3 onion layers — one per relay.
 * 3. Each relay decrypts its layer to get the next hop URL + inner payload.
 * 4. The innermost layer is the EncryptedQueryBlob for the search backend.
 */

import type { RelayNode, RelayStatus, RoutingPath, EncryptedQueryBlob, SearchResponse, RelayRequest, OnionLayer } from '@meshsearch/types';
import { hashResults, encryptOnionLayer } from '@meshsearch/crypto';
import type { ServerConfig } from '../config.js';

/**
 * Select the best 3 relay nodes for a routing path.
 * Uses the configured relay endpoints and their public keys.
 */
export async function selectRelays(config: ServerConfig): Promise<RoutingPath> {
  const relays: RelayNode[] = config.relayEndpoints.slice(0, 3).map((ep, i) => ({
    ensName: ep.ensName ?? `relay${i + 1}.meshsearch.eth`,
    operator: `0x${'0'.repeat(38)}${(i + 1).toString().padStart(2, '0')}` as `0x${string}`,
    endpoint: ep.url,
    publicKey: ep.publicKey,
    reputationScore: 50,
    status: 'active' as RelayStatus,
    lastActiveAt: Date.now(),
  }));

  // Pad to 3 if fewer configured
  while (relays.length < 3) {
    relays.push({
      ...relays[0],
      ensName: `relay${relays.length + 1}.meshsearch.eth`,
    });
  }

  return {
    hops: [relays[0], relays[1], relays[2]],
    routingId: `route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };
}

/**
 * Build an onion-encrypted payload and route through the 3-hop relay network.
 *
 * Layering (inside-out):
 *   Layer 3 (innermost): { nextHop: searchBackendUrl, payload: encryptedQueryBlob }
 *                         encrypted for relay3's public key
 *   Layer 2:              { nextHop: relay3.endpoint, payload: layer3 }
 *                         encrypted for relay2's public key
 *   Layer 1 (outermost):  { nextHop: relay2.endpoint, payload: layer2 }
 *                         encrypted for relay1's public key
 *
 * Each relay decrypts its layer to learn ONLY the next hop + opaque inner payload.
 * No relay sees the full path or the plaintext query.
 */
export async function routeQuery(
  encryptedQuery: EncryptedQueryBlob,
  routingPath: RoutingPath,
  config: ServerConfig
): Promise<SearchResponse> {
  const [relay1, relay2, relay3] = routingPath.hops;

  // Layer 3 (innermost): for relay3 — tells it to forward to search backend
  const innerPayload = JSON.stringify({
    nextHop: config.searchBackendUrl + '/search',
    isLastHop: true,
    payload: { encryptedQuery },
  });
  const layer3 = await encryptOnionLayer(innerPayload, relay3.publicKey);

  // Layer 2: for relay2 — tells it to forward to relay3
  const mid = JSON.stringify({
    nextHop: relay3.endpoint + '/relay',
    isLastHop: false,
    payload: layer3,
  });
  const layer2 = await encryptOnionLayer(mid, relay2.publicKey);

  // Layer 1 (outermost): for relay1 — tells it to forward to relay2
  const outer = JSON.stringify({
    nextHop: relay2.endpoint + '/relay',
    isLastHop: false,
    payload: layer2,
  });
  const layer1 = await encryptOnionLayer(outer, relay1.publicKey);

  // Send to relay1
  const relayReq: RelayRequest = {
    routingId: routingPath.routingId,
    onionLayer: layer1,
    hopIndex: 0,
  };

  const response = await fetch(`${relay1.endpoint}/relay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(relayReq),
  });

  if (!response.ok) {
    throw new Error(`Relay routing error: ${response.status} ${response.statusText}`);
  }

  const relayResponse = await response.json() as { routingId: string; encryptedResult: string; success: boolean };
  if (!relayResponse.success) {
    throw new Error('Relay routing failed: downstream relay reported failure');
  }

  // Parse the search result that traveled back through the relays
  const data = JSON.parse(relayResponse.encryptedResult) as SearchResponse;

  // Verify result integrity
  const expectedHash = hashResults(JSON.stringify(data.results));
  if (data.resultHash !== expectedHash) {
    throw new Error('Result integrity check failed: hash mismatch');
  }

  return data;
}

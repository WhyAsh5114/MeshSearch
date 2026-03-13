/**
 * Relay selection and routing client.
 * Selects top 3 relay nodes by reputation and routes encrypted queries.
 */

import type { RelayNode, RelayStatus, RoutingPath, EncryptedQueryBlob, SearchResponse, SearchResultItem } from '@meshsearch/types';
import { hashResults } from '@meshsearch/crypto';
import type { ServerConfig } from '../config.js';

/**
 * Select the best 3 relay nodes for a routing path.
 * In production: reads from NodeRegistry contract onchain.
 */
export async function selectRelays(config: ServerConfig): Promise<RoutingPath> {
  // In production: call NodeRegistry.getTopNodes(3) and resolve endpoints
  const relays: RelayNode[] = config.relayEndpoints.slice(0, 3).map((endpoint, i) => ({
    ensName: `relay${i + 1}.meshsearch.eth`,
    operator: `0x${'0'.repeat(38)}${(i + 1).toString().padStart(2, '0')}` as `0x${string}`,
    endpoint,
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
 * Route an encrypted query through the relay network to the search backend.
 * Each relay sees only the encrypted blob and forwards it.
 * The search backend decrypts and executes the query.
 */
export async function routeQuery(
  encryptedQuery: EncryptedQueryBlob,
  _routingPath: RoutingPath,
  config: ServerConfig
): Promise<SearchResponse> {
  // In production: encrypted multi-hop routing through relay nodes
  // For now: direct call to search backend
  const response = await fetch(`${config.searchBackendUrl}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encryptedQuery }),
  });

  if (!response.ok) {
    throw new Error(`Search backend error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as SearchResponse;

  // Verify result integrity
  const expectedHash = hashResults(JSON.stringify(data.results));
  if (data.resultHash !== expectedHash) {
    throw new Error('Result integrity check failed: hash mismatch');
  }

  return data;
}

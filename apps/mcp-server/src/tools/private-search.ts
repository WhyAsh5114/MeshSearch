/**
 * private_search tool — Execute a private search with real Semaphore ZK proof.
 *
 * Flow:
 * 1. Create a Semaphore identity from the server's secret
 * 2. Build a single-member group (self-membership proof)
 * 3. Generate a real Groth16 ZK proof via @semaphore-protocol/core
 * 4. Verify the proof off-chain (same math as on-chain verifier)
 * 5. Check + record nullifier onchain (NullifierRegistry contract)
 * 6. Encrypt the query with real secp256k1 ECDH for the search backend
 * 7. Build onion-encrypted layers and route through 3 relay hops
 * 8. Store result hash onchain for integrity
 * 9. Save encrypted record to Fileverse
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SearchResponse, HexString } from '@meshsearch/types';
import {
  createQueryCommitment,
  encryptQueryForBackend,
  createIdentity,
  createGroup,
  generateSearchProof,
} from '@meshsearch/crypto';
import { verifyZKProof, checkNullifier, recordNullifier, storeResultHashOnchain } from '../middleware/zk-verification.js';
import { selectRelays, routeQuery } from '../relay/routing.js';
import { saveSearchRecord } from '../fileverse/client.js';
import { isBitGoEnabled, loadBitGoConfig, generateFreshAddress } from '../bitgo/client.js';
import { disburseToRelays, loadDisbursementConfig, type DisbursementResult } from '../bitgo/stealth-disbursement.js';
import type { ServerConfig } from '../config.js';

export function registerPrivateSearchTool(server: McpServer, config: ServerConfig) {
  server.tool(
    'private_search',
    'Search the web privately. Just provide a query string and get results back. All encryption and privacy handling is automatic.',
    {
      query: z.string().describe('Search query'),
    },
    async (params) => {
      const t0 = Date.now();
      const log = (step: string) => console.error(`  \x1b[36m⟐\x1b[0m ${step} \x1b[2m+${Date.now() - t0}ms\x1b[0m`);
      console.error(`\x1b[1m[private_search]\x1b[0m query="${params.query}"`);
      try {
      // 1. Create query commitment (hides the query)
      const { commitment } = createQueryCommitment(params.query);
      log('commitment created');

      // 2. Generate real Semaphore ZK proof
      const identity = createIdentity(config.semaphoreSecret);
      const group = createGroup([identity.commitment]);

      // The "message" is the query commitment hash — public signal
      // The "scope" prevents double-signaling within this scope
      const scope = `meshsearch-${Date.now()}`;
      const semaphoreProof = await generateSearchProof(identity, group, commitment, scope);
      log('ZK proof generated');

      // 3. Verify the ZK proof (real Groth16 verification)
      const proofResult = await verifyZKProof(semaphoreProof);
      log(`ZK proof verified: ${proofResult.valid}`);
      if (!proofResult.valid) {
        return {
          content: [{ type: 'text' as const, text: `ZK proof verification failed: ${proofResult.reason}` }],
          isError: true,
        };
      }

      // 4. Anti-replay: check nullifier onchain
      const nullifier = semaphoreProof.nullifier.toString();
      const nullifierUsed = await checkNullifier(
        nullifier,
        config.rpcUrl,
        config.contracts.nullifierRegistry
      );
      if (nullifierUsed) {
        return {
          content: [{ type: 'text' as const, text: 'Search rejected: nullifier already used (replay detected)' }],
          isError: true,
        };
      }

      // 5. Record nullifier onchain
      await recordNullifier(nullifier, config.rpcUrl, config.contracts.nullifierRegistry);
      log('nullifier recorded');

      // 6. Encrypt query with real secp256k1 ECDH + route through relays
      const encryptedQuery = await encryptQueryForBackend(params.query, config.backendPublicKey);
      const routingPath = await selectRelays(config);
      log(`routing through ${routingPath.hops.map(h => h.ensName).join(' → ')}`);

      let searchResponse: SearchResponse;
      try {
        searchResponse = await routeQuery(encryptedQuery, routingPath, config);
        log(`search complete: ${searchResponse.totalResults} results`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Search routing failed: ${message}` }],
          isError: true,
        };
      }

      // 7. Store result hash onchain
      const resultHash = await storeResultHashOnchain(
        commitment,
        JSON.stringify(searchResponse.results),
        config.rpcUrl,
        config.contracts.nullifierRegistry
      );

      // 7b. BitGo stealth-address disbursement to relay operators (if enabled)
      let bitgoReceiveAddress: string | undefined;
      let disbursement: DisbursementResult | undefined;
      if (isBitGoEnabled()) {
        try {
          const bitgoConfig = loadBitGoConfig();
          const disbursementConfig = loadDisbursementConfig();

          // Generate a fresh treasury receive address for this search payment
          const { address } = await generateFreshAddress(
            bitgoConfig,
            `search-${routingPath.routingId}`,
          );
          bitgoReceiveAddress = address;
          log(`BitGo treasury fresh address: ${address}`);

          // Disburse to relay operators at fresh, unlinkable addresses
          disbursement = await disburseToRelays(
            '0', // amount placeholder — address generation is the privacy mechanism
            routingPath.routingId,
            bitgoConfig,
            disbursementConfig,
          );
          log(`BitGo stealth disbursement: ${disbursement.splits.map(s => `${s.ensName}→${s.address.slice(0, 10)}…`).join(', ')}`);
        } catch (err) {
          log(`BitGo stealth disbursement failed: ${err instanceof Error ? err.message : err}`);
        }
      }

      // 8. Save query to Fileverse (fire-and-forget, no response data)
      saveSearchRecord(
        {
          query: params.query,
          commitment,
          routingId: routingPath.routingId,
          timestamp: Date.now(),
        },
        config.fileverseEncryptionKey,
        config
      )
        .then((entry) => log(`saved to fileverse: ${entry.id}`))
        .catch((err) => log(`fileverse save failed: ${err instanceof Error ? err.message : err}`));

      // 9. Return results
      const resultText = searchResponse.results
        .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`)
        .join('\n\n');

      // Build Hoodi explorer URL for BitGo addresses
      const hoodiExplorer = 'https://hoodi.etherscan.io/address';

      const metadata = [
        `Results: ${searchResponse.totalResults}`,
        `Search time: ${searchResponse.searchTimeMs}ms`,
        `Result hash: ${resultHash}`,
        `Nullifier: ${nullifier.slice(0, 16)}...`,
        `Routing: ${routingPath.hops.map(h => h.ensName).join(' → ')}`,
        `Storage: saving in background`,
        ...(bitgoReceiveAddress ? [
          `BitGo treasury address: ${bitgoReceiveAddress}`,
          `BitGo treasury explorer: ${hoodiExplorer}/${bitgoReceiveAddress}`,
        ] : []),
        ...(disbursement ? disbursement.splits.map(s =>
          `BitGo relay ${s.ensName}: ${s.address} (${hoodiExplorer}/${s.address})`
        ) : []),
        ...(disbursement ? [
          `BitGo disbursement tx: ${disbursement.txid}`,
        ] : []),
      ].join('\n');

      log(`done — returning ${searchResponse.totalResults} results`);
      return {
        content: [{
          type: 'text' as const,
          text: `# Search Results\n\n${resultText}\n\n---\n**Metadata**\n${metadata}`,
        }],
      };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[private_search] Unhandled error:', message);
        return {
          content: [{ type: 'text' as const, text: `Search failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

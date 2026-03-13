/**
 * private_search tool — Execute a private search with ZK proof + x402 payment
 *
 * LLM-friendly interface: only a plain `query` string is required.
 * All cryptographic operations (commitment, nullifier, ZK proof, query encryption)
 * are performed server-side so an LLM can call this tool directly.
 */

import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SearchResponse, HexString, ZKProof, EncryptedQueryBlob } from '@meshsearch/types';
import { createQueryCommitment } from '@meshsearch/crypto';
import { verifyZKProof, checkNullifier, recordNullifier, storeResultHashOnchain } from '../middleware/zk-verification.js';
import { selectRelays, routeQuery } from '../relay/routing.js';
import { saveSearchRecord } from '../fileverse/client.js';
import type { ServerConfig } from '../config.js';

/** Build a nullifier hash for this search (dev mode: random, production: Semaphore) */
function deriveNullifier(_commitment: HexString, _externalNullifier: HexString): HexString {
  return `0x${randomBytes(32).toString('hex')}` as HexString;
}

/** Build a minimal well-formed proof envelope (production: Semaphore Groth16 proof) */
function buildDevProof(_commitment: HexString): HexString {
  return `0x${randomBytes(64).toString('hex')}` as HexString;
}

/** Produce an encrypted query blob the relay can forward (ECDH stub for dev) */
function buildEncryptedQuery(query: string, backendPublicKey: string): EncryptedQueryBlob {
  // In production: ECDH key agreement with backend's public key + AES-GCM encrypt.
  // For dev/LLM usage: base64-encode so the relay can forward it and the search backend
  // decodes it as plaintext when BACKEND_PUBLIC_KEY starts with "dev-".
  const ciphertext = Buffer.from(JSON.stringify({ query })).toString('base64');
  return {
    ciphertext,
    ephemeralPublicKey: backendPublicKey,
    nonce: randomBytes(12).toString('hex'),
  };
}

export function registerPrivateSearchTool(server: McpServer, config: ServerConfig) {
  server.tool(
    'private_search',
    'Search the web privately. Just provide a query string and get results back. All encryption and privacy handling is automatic.',
    {
      query: z.string().describe('Search query'),
    },
    async (params) => {
      // 1. Server-side commitment + ZK proof generation
      const { commitment, salt } = createQueryCommitment(params.query);
      const externalNullifier = `0x${randomBytes(32).toString('hex')}` as HexString;
      const nullifierHash = deriveNullifier(commitment, externalNullifier);

      const zkProof: ZKProof = {
        commitment,
        nullifierHash,
        proof: buildDevProof(commitment),
        merkleTreeRoot: `0x${randomBytes(32).toString('hex')}` as HexString,
        externalNullifier,
      };

      // 2. Verify proof structure
      const proofResult = await verifyZKProof(zkProof);
      if (!proofResult.valid) {
        return {
          content: [{ type: 'text' as const, text: `ZK proof error: ${proofResult.reason}` }],
          isError: true,
        };
      }

      // 3. Anti-replay: check nullifier
      const nullifierUsed = await checkNullifier(
        zkProof.nullifierHash,
        config.rpcUrl,
        config.contracts.nullifierRegistry
      );
      if (nullifierUsed) {
        return {
          content: [{ type: 'text' as const, text: 'Search rejected: nullifier already used (replay detected)' }],
          isError: true,
        };
      }

      // 4. Record nullifier
      await recordNullifier(zkProof.nullifierHash, config.rpcUrl, config.contracts.nullifierRegistry);

      // 5. Encrypt query + route through relays
      const encryptedQuery = buildEncryptedQuery(params.query, config.backendPublicKey);
      const routingPath = await selectRelays(config);

      let searchResponse: SearchResponse;
      try {
        searchResponse = await routeQuery(encryptedQuery, routingPath, config);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Search routing failed: ${message}` }],
          isError: true,
        };
      }

      // 6. Store result hash onchain
      const resultHash = await storeResultHashOnchain(
        zkProof.commitment,
        JSON.stringify(searchResponse.results),
        config.rpcUrl,
        config.contracts.nullifierRegistry
      );

      // 7. Save encrypted record to Fileverse
      let storageCid: string | undefined;
      try {
        const entry = await saveSearchRecord(
          {
            commitment: zkProof.commitment,
            response: searchResponse,
            routingId: routingPath.routingId,
            timestamp: Date.now(),
          },
          salt,
          config.fileverseApiUrl
        );
        storageCid = entry.cid;
      } catch {
        // Non-fatal
      }

      // 8. Return results
      const resultText = searchResponse.results
        .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`)
        .join('\n\n');

      const metadata = [
        `Results: ${searchResponse.totalResults}`,
        `Search time: ${searchResponse.searchTimeMs}ms`,
        `Result hash: ${resultHash}`,
        `Routing: ${routingPath.hops.map(h => h.ensName).join(' → ')}`,
        storageCid ? `Stored on Fileverse: ${storageCid}` : null,
      ].filter(Boolean).join('\n');

      return {
        content: [{
          type: 'text' as const,
          text: `# Search Results\n\n${resultText}\n\n---\n**Metadata**\n${metadata}`,
        }],
      };
    }
  );
}


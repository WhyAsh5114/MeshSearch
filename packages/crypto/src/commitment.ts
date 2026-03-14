/**
 * Query commitment and result integrity hashing.
 *
 * Commitments: SHA-256(len(query) || query || salt) — a hiding, binding commitment
 * with domain separation to prevent collision attacks.
 *
 * Semaphore proof generation is in ./semaphore.ts (real Groth16 circuit).
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';
import type { HexString, QueryCommitment } from '@meshsearch/types';

/**
 * Generate a cryptographically secure random 32-byte salt.
 */
export function generateSalt(): HexString {
  return `0x${bytesToHex(randomBytes(32))}`;
}

/**
 * Create a hiding commitment to a query: SHA-256(len(query) || query || salt).
 * The commitment can be published without revealing the query.
 * Length-prefixed to prevent delimiter-collision attacks.
 */
export function createQueryCommitment(query: string, salt?: HexString): QueryCommitment {
  const actualSalt = salt ?? generateSalt();
  const saltBytes = hexToBytes(actualSalt);
  const queryBytes = new TextEncoder().encode(query);

  const lenBuf = new Uint8Array(4);
  new DataView(lenBuf.buffer).setUint32(0, queryBytes.length, false);

  const combined = new Uint8Array(lenBuf.length + queryBytes.length + saltBytes.length);
  combined.set(lenBuf, 0);
  combined.set(queryBytes, lenBuf.length);
  combined.set(saltBytes, lenBuf.length + queryBytes.length);

  const hash = sha256(combined);
  const commitment: HexString = `0x${bytesToHex(hash)}`;

  return { commitment, salt: actualSalt, query };
}

/**
 * Verify that a commitment matches a known query + salt.
 */
export function verifyQueryCommitment(
  commitment: HexString,
  query: string,
  salt: HexString
): boolean {
  const recomputed = createQueryCommitment(query, salt);
  return recomputed.commitment === commitment;
}

/**
 * Hash a result set for onchain integrity proof.
 */
export function hashResults(resultsJson: string): HexString {
  const hash = sha256(new TextEncoder().encode(resultsJson));
  return `0x${bytesToHex(hash)}`;
}

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }
  return bytes;
}

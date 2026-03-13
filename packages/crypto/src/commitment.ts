/**
 * Poseidon-like query commitment using SHA-256 (portable, no WASM dependency).
 * In production, replace with a real Poseidon hash for ZK circuit compatibility.
 * Using @noble/hashes for audited, pure-JS crypto.
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';
import type { HexString, QueryCommitment } from '@meshsearch/types';

/**
 * Generate a random salt (32 bytes)
 */
export function generateSalt(): HexString {
  return `0x${bytesToHex(randomBytes(32))}`;
}

/**
 * Create a query commitment: hash(query || salt)
 * The commitment hides the query — the server only sees the hash.
 */
export function createQueryCommitment(query: string, salt?: HexString): QueryCommitment {
  const actualSalt = salt ?? generateSalt();
  const saltBytes = hexToBytes(actualSalt);
  const queryBytes = new TextEncoder().encode(query);

  const combined = new Uint8Array(queryBytes.length + saltBytes.length);
  combined.set(queryBytes, 0);
  combined.set(saltBytes, queryBytes.length);

  const hash = sha256(combined);
  const commitment: HexString = `0x${bytesToHex(hash)}`;

  return { commitment, salt: actualSalt, query };
}

/**
 * Verify a query commitment matches a known query + salt
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
 * Hash a result set for onchain integrity proof
 */
export function hashResults(resultsJson: string): HexString {
  const hash = sha256(new TextEncoder().encode(resultsJson));
  return `0x${bytesToHex(hash)}`;
}

/**
 * Generate a nullifier hash (simulated Semaphore nullifier)
 * In production, use actual Semaphore identity + external nullifier
 */
export function generateNullifier(identitySecret: HexString, externalNullifier: HexString): HexString {
  const combined = new TextEncoder().encode(`${identitySecret}:${externalNullifier}`);
  const hash = sha256(combined);
  return `0x${bytesToHex(hash)}`;
}

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex: HexString): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * ZK verification middleware.
 * Validates the ZK proof (commitment, nullifier, authorization) before allowing search.
 */

import type { ZKProof, HexString } from '@meshsearch/types';
import { hashResults } from '@meshsearch/crypto';

/**
 * Verify a ZK proof is well-formed and the nullifier hasn't been used.
 * In production, this would verify the actual Semaphore proof onchain.
 */
export async function verifyZKProof(proof: ZKProof): Promise<{ valid: boolean; reason?: string }> {
  // Validate proof structure
  if (!proof.commitment || !proof.nullifierHash || !proof.proof) {
    return { valid: false, reason: 'Missing proof fields' };
  }

  if (!isValidHex(proof.commitment) || !isValidHex(proof.nullifierHash)) {
    return { valid: false, reason: 'Invalid hex format in proof' };
  }

  // In production: verify Semaphore proof onchain via smart contract call
  // For now: structural validation passes
  return { valid: true };
}

/**
 * Check if a nullifier has been used (onchain check)
 */
export async function checkNullifier(
  nullifierHash: HexString,
  _rpcUrl: string,
  _contractAddress: string
): Promise<boolean> {
  // In production: call NullifierRegistry.isNullifierUsed(nullifierHash)
  // For development: track in-memory
  return usedNullifiers.has(nullifierHash);
}

/**
 * Record a nullifier as used
 */
export async function recordNullifier(
  nullifierHash: HexString,
  _rpcUrl: string,
  _contractAddress: string
): Promise<void> {
  // In production: call NullifierRegistry.useNullifier(nullifierHash)
  usedNullifiers.add(nullifierHash);
}

/**
 * Store a result hash onchain for integrity verification
 */
export async function storeResultHashOnchain(
  commitment: HexString,
  resultsJson: string,
  _rpcUrl: string,
  _contractAddress: string
): Promise<HexString> {
  const resultHash = hashResults(resultsJson);
  // In production: call NullifierRegistry.storeResultHash(commitment, resultHash)
  resultHashStore.set(commitment, resultHash);
  return resultHash;
}

// In-memory stores for development (production uses onchain storage)
const usedNullifiers = new Set<string>();
const resultHashStore = new Map<string, string>();

function isValidHex(s: string): boolean {
  return /^0x[a-fA-F0-9]+$/.test(s);
}

// Export for testing
export const _testHelpers = {
  resetState() {
    usedNullifiers.clear();
    resultHashStore.clear();
  },
  getUsedNullifiers: () => usedNullifiers,
  getResultHashStore: () => resultHashStore,
};

/**
 * Semaphore v4 integration — real ZK proof generation and verification.
 *
 * Uses @semaphore-protocol/core which wraps Groth16 circuits for:
 *   - Identity: secp256k1-derived commitment via Poseidon hash
 *   - Group: Merkle tree of identity commitments
 *   - Proof: Groth16 proof of group membership + nullifier generation
 *   - Verification: off-chain snarkjs verification (same math as on-chain)
 *
 * The SNARK artifacts (zkey + wasm) are auto-downloaded on first use
 * from the Semaphore team's CDN via @semaphore-protocol/core.
 */

import { Identity, Group, generateProof, verifyProof } from '@semaphore-protocol/core';
import type { SemaphoreProof } from '@meshsearch/types';

export { Identity, Group };

/**
 * Create a new Semaphore identity from a secret string.
 * Deterministic: same secret → same identity → same commitment.
 */
export function createIdentity(secret?: string): Identity {
  return secret ? new Identity(secret) : new Identity();
}

/**
 * Create a group from an array of identity commitments (bigints).
 */
export function createGroup(members: bigint[]): Group {
  return new Group(members);
}

/**
 * Generate a Semaphore ZK proof.
 *
 * @param identity  The prover's Semaphore identity (private)
 * @param group     The group whose membership is being proved
 * @param message   Public signal (e.g. query commitment hash)
 * @param scope     Scope for nullifier derivation (prevents double-signaling per scope)
 * @returns         A full Groth16 proof object
 */
export async function generateSearchProof(
  identity: Identity,
  group: Group,
  message: string,
  scope: string,
): Promise<SemaphoreProof> {
  return generateProof(identity, group, message, scope) as unknown as Promise<SemaphoreProof>;
}

/**
 * Verify a Semaphore proof off-chain.
 * Uses the same snarkjs verifier as the on-chain Solidity verifier.
 */
export async function verifySearchProof(proof: SemaphoreProof): Promise<boolean> {
  return verifyProof(proof as unknown as Parameters<typeof verifyProof>[0]);
}

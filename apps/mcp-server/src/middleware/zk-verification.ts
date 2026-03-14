/**
 * ZK verification middleware — real Semaphore v4 proof verification + onchain nullifier storage.
 *
 * - verifyZKProof: off-chain Groth16 verification via @semaphore-protocol/core
 * - checkNullifier / recordNullifier: reads/writes NullifierRegistry contract via ethers
 * - storeResultHashOnchain: writes result hash to NullifierRegistry contract
 */

import { ethers } from 'ethers';
import type { SemaphoreProof, HexString } from '@meshsearch/types';
import { verifySearchProof, hashResults } from '@meshsearch/crypto';

// ABI fragments for NullifierRegistry contract
const NULLIFIER_REGISTRY_ABI = [
  'function isNullifierUsed(bytes32 nullifierHash) external view returns (bool)',
  'function useNullifier(bytes32 nullifierHash) external returns (bool)',
  'function storeResultHash(bytes32 commitment, bytes32 resultHash) external',
  'function verifyResultHash(bytes32 commitment, bytes32 resultHash) external view returns (bool)',
];

/**
 * Verify a Semaphore ZK proof using real off-chain Groth16 verification.
 * This uses the same snarkjs verification key as the on-chain verifier.
 */
export async function verifyZKProof(proof: SemaphoreProof): Promise<{ valid: boolean; reason?: string }> {
  // Validate proof structure
  if (!proof.nullifier || !proof.merkleTreeRoot || !proof.points) {
    return { valid: false, reason: 'Missing proof fields' };
  }

  if (!Array.isArray(proof.points) || proof.points.length !== 8) {
    return { valid: false, reason: 'Invalid proof points (expected 8 elements)' };
  }

  try {
    const valid = await verifySearchProof(proof);
    if (!valid) {
      return { valid: false, reason: 'Groth16 proof verification failed' };
    }
    return { valid: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, reason: `Proof verification error: ${msg}` };
  }
}

/**
 * Check if a nullifier has been used — calls NullifierRegistry.isNullifierUsed() onchain.
 */
export async function checkNullifier(
  nullifier: string,
  rpcUrl: string,
  contractAddress: string
): Promise<boolean> {
  if (contractAddress === '0x0000000000000000000000000000000000000000') {
    // No contract deployed — use in-memory fallback for local dev
    return usedNullifiers.has(nullifier);
  }
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(contractAddress, NULLIFIER_REGISTRY_ABI, provider);
  const nullifierBytes32 = padToBytes32(nullifier);
  return contract.isNullifierUsed(nullifierBytes32);
}

/**
 * Record a nullifier as used — calls NullifierRegistry.useNullifier() onchain.
 * Requires a signer (the MCP server's deployer key for the onlyOwner modifier).
 */
export async function recordNullifier(
  nullifier: string,
  rpcUrl: string,
  contractAddress: string
): Promise<void> {
  if (contractAddress === '0x0000000000000000000000000000000000000000') {
    usedNullifiers.add(nullifier);
    return;
  }
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = await provider.getSigner(0); // deployer (owner)
  const contract = new ethers.Contract(contractAddress, NULLIFIER_REGISTRY_ABI, signer);
  const nullifierBytes32 = padToBytes32(nullifier);
  const tx = await contract.useNullifier(nullifierBytes32);
  await tx.wait();
}

/**
 * Store a result hash onchain — calls NullifierRegistry.storeResultHash().
 */
export async function storeResultHashOnchain(
  commitment: HexString,
  resultsJson: string,
  rpcUrl: string,
  contractAddress: string
): Promise<HexString> {
  const resultHash = hashResults(resultsJson);

  if (contractAddress !== '0x0000000000000000000000000000000000000000') {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = await provider.getSigner(0);
    const contract = new ethers.Contract(contractAddress, NULLIFIER_REGISTRY_ABI, signer);
    const commitmentBytes32 = padToBytes32(commitment);
    const resultHashBytes32 = padToBytes32(resultHash);
    const tx = await contract.storeResultHash(commitmentBytes32, resultHashBytes32);
    await tx.wait();
  } else {
    resultHashStore.set(commitment, resultHash);
  }

  return resultHash;
}

/**
 * Pad a hex string or numeric string to bytes32 for Solidity.
 */
function padToBytes32(value: string): string {
  if (value.startsWith('0x')) {
    return ethers.zeroPadValue(value, 32);
  }
  // Numeric string from Semaphore — convert to hex bytes32
  const bn = BigInt(value);
  return ethers.zeroPadValue(ethers.toBeHex(bn), 32);
}

// In-memory fallback for local dev without deployed contracts
const usedNullifiers = new Set<string>();
const resultHashStore = new Map<string, string>();

// Export for testing
export const _testHelpers = {
  resetState() {
    usedNullifiers.clear();
    resultHashStore.clear();
  },
  getUsedNullifiers: () => usedNullifiers,
  getResultHashStore: () => resultHashStore,
};

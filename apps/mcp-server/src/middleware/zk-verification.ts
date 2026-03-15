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

/** Create a provider that fails fast instead of retrying forever */
function fastProvider(rpcUrl: string): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(rpcUrl, undefined, {
    staticNetwork: true,
    batchMaxCount: 1,
  });
}

/** Build a Wallet signer from DEPLOYER_PRIVATE_KEY env var */
function getDeployerSigner(provider: ethers.JsonRpcProvider): ethers.Wallet | null {
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) return null;
  return new ethers.Wallet(key, provider);
}

/** Race a promise against a timeout */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms (is the RPC node running?)`)), ms)
    ),
  ]);
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
    return usedNullifiers.has(nullifier);
  }
  try {
    const provider = fastProvider(rpcUrl);
    const contract = new ethers.Contract(contractAddress, NULLIFIER_REGISTRY_ABI, provider);
    const nullifierBytes32 = padToBytes32(nullifier);
    return await withTimeout(contract.isNullifierUsed(nullifierBytes32), 5000, 'checkNullifier');
  } catch {
    // RPC unavailable — fall back to in-memory
    console.error('[zk] checkNullifier: RPC unavailable, using in-memory fallback');
    return usedNullifiers.has(nullifier);
  }
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
  usedNullifiers.add(nullifier); // always record in-memory
  if (contractAddress === '0x0000000000000000000000000000000000000000') {
    return;
  }
  try {
    const provider = fastProvider(rpcUrl);
    const signer = getDeployerSigner(provider);
    if (!signer) {
      console.error('[zk] recordNullifier: DEPLOYER_PRIVATE_KEY not set, recorded in-memory only');
      return;
    }
    const contract = new ethers.Contract(contractAddress, NULLIFIER_REGISTRY_ABI, signer);
    const nullifierBytes32 = padToBytes32(nullifier);
    const tx = await withTimeout(contract.useNullifier(nullifierBytes32), 10000, 'useNullifier');
    await withTimeout(tx.wait(), 15000, 'tx.wait');
    console.error(`[zk] recordNullifier: recorded onchain (tx: ${tx.hash})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[zk] recordNullifier: onchain write failed (${msg}), recorded in-memory only`);
  }
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
    try {
      const provider = fastProvider(rpcUrl);
      const signer = getDeployerSigner(provider);
      if (!signer) {
        console.error('[zk] storeResultHash: DEPLOYER_PRIVATE_KEY not set, stored in-memory only');
        resultHashStore.set(commitment, resultHash);
        return resultHash;
      }
      const contract = new ethers.Contract(contractAddress, NULLIFIER_REGISTRY_ABI, signer);
      const commitmentBytes32 = padToBytes32(commitment);
      const resultHashBytes32 = padToBytes32(resultHash);
      const tx = await withTimeout(contract.storeResultHash(commitmentBytes32, resultHashBytes32), 10000, 'storeResultHash');
      await withTimeout(tx.wait(), 15000, 'tx.wait');
      console.error(`[zk] storeResultHash: stored onchain (tx: ${tx.hash})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[zk] storeResultHash: onchain write failed (${msg}), stored in-memory only`);
      resultHashStore.set(commitment, resultHash);
    }
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

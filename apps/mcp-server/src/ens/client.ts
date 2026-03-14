/**
 * ENS resolution client — real on-chain ENS name resolution via @ensdomains/ensjs + viem.
 *
 * Provides:
 * - Forward resolution: ENS name → Ethereum address
 * - Reverse resolution: Ethereum address → ENS name
 * - Name validation: Verify an ENS name resolves to a valid address
 *
 * Uses Ethereum mainnet for ENS resolution (ENS contracts live on L1).
 * Falls back gracefully when the RPC is unreachable.
 */

import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { addEnsContracts, ensPublicActions } from '@ensdomains/ensjs';

// ─── ENS Client singleton ───────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _ensClient: any = null;

/**
 * Get or create a viem public client with ENS public actions on Ethereum mainnet.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getEnsClient(): any {
  if (_ensClient) return _ensClient;

  const rpcUrl = process.env.ENS_RPC_URL || undefined;
  _ensClient = createPublicClient({
    chain: addEnsContracts(mainnet),
    transport: http(rpcUrl),
  }).extend(ensPublicActions);

  return _ensClient;
}

// ─── Forward resolution: ENS name → address ─────────────────────────────────

/**
 * Resolve an ENS name to its Ethereum address.
 * Returns null if the name doesn't resolve or the RPC is unreachable.
 */
export async function resolveEnsName(ensName: string): Promise<string | null> {
  if (!ensName || !ensName.endsWith('.eth')) return null;

  try {
    const client = getEnsClient();
    const result = await client.getAddressRecord({ name: ensName });
    return result?.value ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ens] Failed to resolve ${ensName}: ${msg}`);
    return null;
  }
}

// ─── Reverse resolution: address → ENS name ─────────────────────────────────

/**
 * Reverse-resolve an Ethereum address to its primary ENS name.
 * Returns null if no primary name is set or the RPC is unreachable.
 */
export async function reverseResolveAddress(address: `0x${string}`): Promise<string | null> {
  try {
    const client = getEnsClient();
    const result = await client.getName({ address });
    if (result?.name && result.match) {
      return result.name;
    }
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ens] Failed to reverse-resolve ${address}: ${msg}`);
    return null;
  }
}

// ─── Validation helpers ─────────────────────────────────────────────────────

/**
 * Verify that an ENS name resolves to a valid Ethereum address.
 * Returns the resolved address if valid, null otherwise.
 */
export async function validateEnsName(ensName: string): Promise<{ valid: boolean; address: string | null }> {
  const address = await resolveEnsName(ensName);
  return {
    valid: address !== null,
    address,
  };
}

// ─── Test helpers ───────────────────────────────────────────────────────────

export const _testHelpers = {
  resetClient() {
    _ensClient = null;
  },
};

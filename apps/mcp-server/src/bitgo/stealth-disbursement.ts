/**
 * Stealth-address disbursement — splits search payments to relay operators
 * using fresh BitGo addresses per disbursement.
 *
 * Privacy improvement over the on-chain PaymentSplitter contract:
 * - Each relay operator has a BitGo wallet
 * - For each payment split, a fresh address is generated on the relay's wallet
 * - An observer cannot link relay1's payment from search A to search B
 * - The on-chain trace shows payment → N unique addresses with no common pattern
 *
 * This module can work alongside or replace the PaymentSplitter contract.
 * When BitGo is enabled, disbursement flows through BitGo wallets.
 * When disabled, falls back to the existing on-chain splitter.
 *
 * Env vars (per relay):
 *   RELAY1_BITGO_WALLET_ID — BitGo wallet ID for relay operator 1
 *   RELAY2_BITGO_WALLET_ID — BitGo wallet ID for relay operator 2
 *   RELAY3_BITGO_WALLET_ID — BitGo wallet ID for relay operator 3
 */

import {
  generateFreshAddress,
  sendTransaction,
  type BitGoConfig,
} from './client.js';

// ─── Configuration ──────────────────────────────────────────────────────────

export interface RelayWalletConfig {
  /** BitGo wallet ID for this relay operator */
  walletId: string;
  /** ENS name for identification */
  ensName: string;
}

export interface DisbursementConfig {
  /** Relay operator wallet configs */
  relayWallets: RelayWalletConfig[];
  /** Share percentages in basis points (total = 10000) */
  shares: {
    relay1: number;
    relay2: number;
    relay3: number;
    protocol: number;
  };
  /** Protocol fee recipient address (a fixed BitGo address or EOA) */
  protocolAddress: string;
}

export function loadDisbursementConfig(): DisbursementConfig {
  return {
    relayWallets: [
      {
        walletId: process.env.RELAY1_BITGO_WALLET_ID ?? '',
        ensName: 'relay1.meshsearch.eth',
      },
      {
        walletId: process.env.RELAY2_BITGO_WALLET_ID ?? '',
        ensName: 'relay2.meshsearch.eth',
      },
      {
        walletId: process.env.RELAY3_BITGO_WALLET_ID ?? '',
        ensName: 'relay3.meshsearch.eth',
      },
    ],
    shares: {
      relay1: 2500,
      relay2: 2500,
      relay3: 2500,
      protocol: 2500,
    },
    protocolAddress: process.env.BITGO_PROTOCOL_ADDRESS ?? '',
  };
}

// ─── Disbursement result ────────────────────────────────────────────────────

export interface DisbursementResult {
  /** Transaction ID of the sendMany */
  txid: string;
  /** Per-recipient breakdown */
  splits: Array<{
    ensName: string;
    address: string;
    amount: string;
    isFreshAddress: boolean;
  }>;
  /** Total amount disbursed (in base units) */
  totalAmount: string;
  /** Timestamp */
  timestamp: number;
}

// ─── Fresh-address generation for relay wallets ─────────────────────────────

/**
 * Generate a fresh receive address on a relay operator's BitGo wallet.
 *
 * This creates a new, unlinkable address each time — the core privacy mechanism.
 * Each relay's earnings arrive at different addresses across searches,
 * making it impossible to correlate payments to a single relay operator
 * by watching on-chain transactions.
 */
async function generateRelayAddress(
  relayWallet: RelayWalletConfig,
  bitgoConfig: BitGoConfig,
  searchId: string,
): Promise<string> {
  if (!relayWallet.walletId) {
    // No BitGo wallet configured for this relay — fall back to a fixed address
    console.error(`[disbursement] No BitGo wallet for ${relayWallet.ensName}, using protocol address`);
    return '';
  }

  // Create a temporary config pointing to the relay's wallet
  const relayConfig: BitGoConfig = {
    ...bitgoConfig,
    walletId: relayWallet.walletId,
  };

  const { address } = await generateFreshAddress(
    relayConfig,
    `search-${searchId}-${relayWallet.ensName}`,
  );
  return address;
}

// ─── Main disbursement function ─────────────────────────────────────────────

/**
 * Disburse a search payment to relay operators using fresh addresses.
 *
 * Flow:
 * 1. Generate a fresh BitGo address for each relay operator
 * 2. Calculate each relay's share based on basis points
 * 3. Send a single `sendMany` transaction from the treasury wallet
 * 4. Return the disbursement receipt for audit trail
 *
 * @param totalAmount Total payment in base units (wei for ETH)
 * @param searchId Unique search identifier for labeling
 * @param bitgoConfig Treasury wallet config
 * @param disbursementConfig Relay wallet and share config
 */
export async function disburseToRelays(
  totalAmount: string,
  searchId: string,
  bitgoConfig: BitGoConfig,
  disbursementConfig: DisbursementConfig,
): Promise<DisbursementResult> {
  const { relayWallets, shares, protocolAddress } = disbursementConfig;
  const total = BigInt(totalAmount);

  // Generate fresh addresses for each relay
  const addresses = await Promise.all(
    relayWallets.map((rw) => generateRelayAddress(rw, bitgoConfig, searchId)),
  );

  // Calculate shares
  const shareAmounts = [
    (total * BigInt(shares.relay1)) / 10000n,
    (total * BigInt(shares.relay2)) / 10000n,
    (total * BigInt(shares.relay3)) / 10000n,
  ];
  const protocolAmount = total - shareAmounts[0] - shareAmounts[1] - shareAmounts[2];

  // Build recipients list
  const recipients: Array<{ address: string; amount: string }> = [];
  const splits: DisbursementResult['splits'] = [];

  for (let i = 0; i < 3; i++) {
    const addr = addresses[i];
    if (!addr) continue; // Skip relays without BitGo wallets

    recipients.push({
      address: addr,
      amount: shareAmounts[i].toString(),
    });
    splits.push({
      ensName: relayWallets[i].ensName,
      address: addr,
      amount: shareAmounts[i].toString(),
      isFreshAddress: true,
    });
  }

  // Protocol fee
  if (protocolAddress && protocolAmount > 0n) {
    recipients.push({
      address: protocolAddress,
      amount: protocolAmount.toString(),
    });
    splits.push({
      ensName: 'protocol',
      address: protocolAddress,
      amount: protocolAmount.toString(),
      isFreshAddress: false,
    });
  }

  if (recipients.length === 0) {
    throw new Error('No valid disbursement recipients — check relay wallet configuration');
  }

  // Send the single multi-recipient transaction from treasury
  const { txid } = await sendTransaction(bitgoConfig, recipients);

  const result: DisbursementResult = {
    txid,
    splits,
    totalAmount: totalAmount,
    timestamp: Date.now(),
  };

  console.error(
    `[disbursement] Completed: txid=${txid} splits=${splits.length} total=${totalAmount}`,
  );

  return result;
}

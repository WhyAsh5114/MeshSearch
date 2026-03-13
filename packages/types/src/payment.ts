/**
 * Payment types for x402 protocol
 */

import type { HexString } from './zk.js';

/** x402 payment details */
export interface PaymentDetails {
  /** Payment address on Base */
  payTo: HexString;
  /** Amount in USDC (6 decimals) */
  amount: string;
  /** Chain ID (Base = 8453, Base Sepolia = 84532) */
  chainId: number;
  /** Token address (USDC on Base) */
  tokenAddress: HexString;
  /** Payment memo/reference */
  memo: string;
}

/** x402 payment proof */
export interface PaymentProof {
  /** Transaction hash on Base */
  txHash: HexString;
  /** Block number */
  blockNumber: number;
  /** Amount paid */
  amount: string;
  /** Payer address */
  payer: HexString;
}

/** Payment split configuration */
export interface PaymentSplit {
  /** Relay 1 share (basis points, e.g., 3000 = 30%) */
  relay1Share: number;
  /** Relay 2 share */
  relay2Share: number;
  /** Relay 3 share */
  relay3Share: number;
  /** Protocol fee share */
  protocolShare: number;
}

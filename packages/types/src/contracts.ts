/**
 * Contract ABI types and addresses
 */

import type { HexString } from './zk.js';

/** Contract addresses on Base Sepolia */
export interface ContractAddresses {
  nodeRegistry: HexString;
  nullifierRegistry: HexString;
  paymentSplitter: HexString;
  accessControl: HexString;
}

/** Node registry event */
export interface NodeRegisteredEvent {
  ensName: string;
  operator: HexString;
  endpoint: string;
  blockNumber: number;
}

/** Reputation update event */
export interface ReputationUpdatedEvent {
  ensName: string;
  newScore: number;
  blockNumber: number;
}

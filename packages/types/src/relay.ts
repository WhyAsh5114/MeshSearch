/**
 * Relay network types
 */

import type { HexString } from './zk.js';

/** Relay node status */
export enum RelayStatus {
  Active = 'active',
  Inactive = 'inactive',
  Degraded = 'degraded',
}

/** Relay node info from the NodeRegistry contract */
export interface RelayNode {
  /** ENS name (e.g., relay1.meshsearch.eth) */
  ensName: string;
  /** Ethereum address of the relay operator */
  operator: HexString;
  /** HTTP endpoint for the relay */
  endpoint: string;
  /** Onchain reputation score (0-100) */
  reputationScore: number;
  /** Current status */
  status: RelayStatus;
  /** Timestamp of last successful routing event */
  lastActiveAt: number;
}

/** A routing path through 3 relay hops */
export interface RoutingPath {
  /** The three relay nodes in order */
  hops: [RelayNode, RelayNode, RelayNode];
  /** Unique routing ID */
  routingId: string;
  /** Timestamp of route creation */
  createdAt: number;
}

/** Relay routing request (relay-to-relay) */
export interface RelayRequest {
  /** Routing ID */
  routingId: string;
  /** Encrypted query blob (layered encryption, each relay peels one layer) */
  encryptedBlob: string;
  /** Index of this hop in the route (0, 1, 2) */
  hopIndex: number;
  /** Address of the next hop (or search backend if last) */
  nextHop: string;
  /** x402 payment proof for this relay */
  paymentProof: string;
}

/** Relay routing response */
export interface RelayResponse {
  /** Routing ID */
  routingId: string;
  /** Encrypted result from the next hop (or search backend) */
  encryptedResult: string;
  /** Whether routing was successful */
  success: boolean;
}

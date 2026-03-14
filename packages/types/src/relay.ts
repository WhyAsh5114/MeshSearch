/**
 * Relay network types
 */

import type { HexString, OnionLayer } from './zk.js';

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
  /** secp256k1 compressed public key for onion encryption (hex) */
  publicKey: string;
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

/**
 * Relay routing request (relay-to-relay).
 * The relay receives an onion layer it can decrypt with its private key.
 * Decrypting reveals the next hop URL + the inner onion payload.
 */
export interface RelayRequest {
  /** Routing ID (for correlation) */
  routingId: string;
  /** The onion-encrypted layer for this relay to peel */
  onionLayer: OnionLayer;
  /** Current hop index (0, 1, 2) */
  hopIndex: number;
}

/** Relay routing response */
export interface RelayResponse {
  /** Routing ID */
  routingId: string;
  /** Result returned from downstream (opaque to relay) */
  encryptedResult: string;
  /** Whether routing was successful */
  success: boolean;
}

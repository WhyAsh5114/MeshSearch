/**
 * Search types
 */

import type { HexString, EncryptedQueryBlob, SemaphoreProof } from './zk.js';

/** Search request from client to MCP server */
export interface SearchRequest {
  /** Semaphore ZK proof of authorization */
  semaphoreProof: SemaphoreProof;
  /** Encrypted query blob (for relay routing to search backend) */
  encryptedQuery: EncryptedQueryBlob;
  /** Optional ENS name for subscription-tier access */
  ensName?: string;
}

/** A single search result item */
export interface SearchResultItem {
  /** Result title */
  title: string;
  /** Result URL */
  url: string;
  /** Result snippet/description */
  snippet: string;
  /** Source engine that provided this result */
  source: string;
  /** Relevance score (0-1) */
  score: number;
}

/** Search response from backend */
export interface SearchResponse {
  /** The search results */
  results: SearchResultItem[];
  /** Hash of the result set (stored onchain for integrity) */
  resultHash: HexString;
  /** Number of results */
  totalResults: number;
  /** Time taken to execute search (ms) */
  searchTimeMs: number;
  /** Timestamp */
  timestamp: number;
}

/** Full search record (commitment + result) for storage */
export interface SearchRecord {
  /** Original user query, stored inside the encrypted history payload */
  query?: string;
  /** Query commitment hash */
  commitment: HexString;
  /** Search response */
  response: SearchResponse;
  /** Routing path used */
  routingId: string;
  /** Timestamp */
  timestamp: number;
}

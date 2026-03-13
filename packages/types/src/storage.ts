/**
 * Fileverse storage types
 */

import type { HexString } from './zk.js';
import type { SearchRecord } from './search.js';

/** An encrypted storage entry on Fileverse/IPFS */
export interface EncryptedEntry {
  /** IPFS CID of the encrypted document */
  cid: string;
  /** Encryption metadata */
  encryption: {
    /** Algorithm used */
    algorithm: 'aes-256-gcm';
    /** Initialization vector */
    iv: string;
    /** The wallet public key used for encryption */
    publicKey: string;
  };
  /** Timestamp of storage */
  storedAt: number;
}

/** Decrypted search history entry */
export interface HistoryEntry {
  /** The search record */
  record: SearchRecord;
  /** IPFS CID where this was stored */
  cid: string;
  /** Decrypted at timestamp */
  decryptedAt: number;
}

/** Research report compiled from multiple searches */
export interface ResearchReport {
  /** Report title */
  title: string;
  /** List of search record CIDs included */
  searchCids: string[];
  /** Compiled summary text */
  summary: string;
  /** Individual search records */
  searches: SearchRecord[];
  /** Report creation timestamp */
  createdAt: number;
  /** Wallet address of the author */
  author: HexString;
}

/**
 * Fileverse storage types
 */

import type { HexString } from './zk.js';
import type { SearchRecord } from './search.js';

export type FileverseStorageProvider = 'fileverse-mcp' | 'legacy-local';
export type FileverseSyncStatus = 'pending' | 'synced' | 'failed';

/** An encrypted storage entry on Fileverse or the legacy local wrapper. */
export interface EncryptedEntry {
  /** Storage identifier (ddocId for Fileverse, CID for the legacy wrapper). */
  id: string;
  /** Storage provider used for this entry. */
  provider: FileverseStorageProvider;
  /** Shareable Fileverse link, when available. */
  link?: string;
  /** Current sync state, when the provider exposes one. */
  syncStatus?: FileverseSyncStatus;
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
  /** Storage identifier (ddocId for Fileverse, CID for the legacy wrapper). */
  id: string;
  /** Shareable Fileverse link, when available. */
  link?: string;
  /** Current sync state, when the provider exposes one. */
  syncStatus?: FileverseSyncStatus;
  /** Decrypted at timestamp */
  decryptedAt: number;
}

/** Research report compiled from multiple searches */
export interface ResearchReport {
  /** Report title */
  title: string;
  /** List of stored search document IDs included in the report. */
  searchIds: string[];
  /** Compiled summary text */
  summary: string;
  /** Individual search records */
  searches: SearchRecord[];
  /** Report creation timestamp */
  createdAt: number;
  /** Wallet address of the author */
  author: HexString;
  /** Shareable Fileverse link, when available. */
  link?: string;
  /** Current sync state, when the provider exposes one. */
  syncStatus?: FileverseSyncStatus;
}

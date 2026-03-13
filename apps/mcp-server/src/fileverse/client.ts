/**
 * Fileverse client for encrypted search history storage.
 */

import type { SearchRecord, EncryptedEntry, HistoryEntry, ResearchReport, HexString } from '@meshsearch/types';
import { deriveEncryptionKey, encryptData, decryptData } from '@meshsearch/crypto';

/**
 * Save a search record to Fileverse (encrypted with user's wallet key).
 */
export async function saveSearchRecord(
  record: SearchRecord,
  walletKey: string,
  fileverseApiUrl: string
): Promise<EncryptedEntry> {
  const key = await deriveEncryptionKey(walletKey);
  const plaintext = JSON.stringify(record);
  const { ciphertext, iv } = await encryptData(plaintext, key);

  // In production: POST to Fileverse API → IPFS
  // For development: use local storage endpoint
  const response = await fetch(`${fileverseApiUrl}/store`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ciphertext, iv }),
  });

  if (!response.ok) {
    throw new Error(`Fileverse storage error: ${response.status}`);
  }

  const { cid } = await response.json() as { cid: string };

  return {
    cid,
    encryption: {
      algorithm: 'aes-256-gcm',
      iv,
      publicKey: walletKey.slice(0, 10) + '...', // Don't store full key
    },
    storedAt: Date.now(),
  };
}

/**
 * Retrieve and decrypt search history from Fileverse.
 */
export async function getSearchHistory(
  walletKey: string,
  fileverseApiUrl: string,
  limit: number = 10
): Promise<HistoryEntry[]> {
  const key = await deriveEncryptionKey(walletKey);

  const response = await fetch(`${fileverseApiUrl}/history?limit=${limit}`);
  if (!response.ok) {
    throw new Error(`Fileverse retrieval error: ${response.status}`);
  }

  const entries = await response.json() as Array<{ cid: string; ciphertext: string; iv: string }>;

  const history: HistoryEntry[] = [];
  for (const entry of entries) {
    const plaintext = await decryptData(entry.ciphertext, entry.iv, key);
    const record = JSON.parse(plaintext) as SearchRecord;
    history.push({
      record,
      cid: entry.cid,
      decryptedAt: Date.now(),
    });
  }

  return history;
}

/**
 * Compile multiple search records into a research report.
 */
export async function compileReport(
  title: string,
  searchCids: string[],
  walletKey: string,
  author: HexString,
  fileverseApiUrl: string
): Promise<{ report: ResearchReport; entry: EncryptedEntry }> {
  const key = await deriveEncryptionKey(walletKey);

  // Fetch and decrypt each referenced search
  const searches: SearchRecord[] = [];
  for (const cid of searchCids) {
    const response = await fetch(`${fileverseApiUrl}/entry/${cid}`);
    if (!response.ok) continue;
    const { ciphertext, iv } = await response.json() as { ciphertext: string; iv: string };
    const plaintext = await decryptData(ciphertext, iv, key);
    searches.push(JSON.parse(plaintext) as SearchRecord);
  }

  // Build summary from all search results
  const allResults = searches.flatMap(s => s.response.results);
  const summary = allResults
    .map(r => `- [${r.title}](${r.url}): ${r.snippet}`)
    .join('\n');

  const report: ResearchReport = {
    title,
    searchCids,
    summary,
    searches,
    createdAt: Date.now(),
    author,
  };

  // Encrypt and store the report
  const { ciphertext, iv } = await encryptData(JSON.stringify(report), key);

  const storeResponse = await fetch(`${fileverseApiUrl}/store`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ciphertext, iv, type: 'report' }),
  });

  if (!storeResponse.ok) {
    throw new Error(`Fileverse report storage error: ${storeResponse.status}`);
  }

  const { cid } = await storeResponse.json() as { cid: string };

  return {
    report,
    entry: {
      cid,
      encryption: { algorithm: 'aes-256-gcm', iv, publicKey: walletKey.slice(0, 10) + '...' },
      storedAt: Date.now(),
    },
  };
}

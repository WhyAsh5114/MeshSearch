/**
 * Fileverse client for encrypted search history storage.
 */

import type {
  SearchRecord,
  EncryptedEntry,
  HistoryEntry,
  ResearchReport,
  HexString,
  FileverseSyncStatus,
} from '@meshsearch/types';
import { deriveEncryptionKey, encryptData, decryptData } from '@meshsearch/crypto';
import type { ServerConfig } from '../config.js';

type FileverseClientConfig = Pick<
  ServerConfig,
  | 'fileverseApiUrl'
  | 'fileverseServerUrl'
  | 'fileverseTransport'
  | 'fileverseSyncTimeoutMs'
  | 'fileverseSyncPollIntervalMs'
>;

type DerivedEncryptionKey = Awaited<ReturnType<typeof deriveEncryptionKey>>;

type FileverseEnvelopeKind = 'meshsearch-search-record' | 'meshsearch-report';

interface EncryptedEnvelope<TKind extends FileverseEnvelopeKind> {
  version: 1;
  kind: TKind;
  ciphertext: string;
  iv: string;
  storedAt: number;
}

interface FileverseDocument {
  ddocId: string;
  title: string;
  content: string;
  syncStatus: FileverseSyncStatus;
  link?: string;
}

interface FileverseListResponse {
  ddocs: FileverseDocument[];
  total: number;
  hasNext: boolean;
}

interface FileverseSyncResponse {
  ddocId: string;
  syncStatus: FileverseSyncStatus;
  link?: string;
}

/**
 * Save a search record to Fileverse (encrypted with the configured history key).
 */
export async function saveSearchRecord(
  record: SearchRecord,
  walletKey: string,
  config: FileverseClientConfig
): Promise<EncryptedEntry> {
  const key = await deriveEncryptionKey(walletKey);
  const { ciphertext, iv } = await encryptData(JSON.stringify(record), key);

  if (config.fileverseTransport === 'mcp') {
    const storedAt = Date.now();
    const envelope: EncryptedEnvelope<'meshsearch-search-record'> = {
      version: 1,
      kind: 'meshsearch-search-record',
      ciphertext,
      iv,
      storedAt,
    };

    const document = await createDocumentViaMcp(
      createSearchDocumentTitle(record.timestamp),
      JSON.stringify(envelope),
      config
    );

    return {
      id: document.ddocId,
      provider: 'fileverse-mcp',
      link: document.link,
      syncStatus: document.syncStatus,
      encryption: {
        algorithm: 'aes-256-gcm',
        iv,
        publicKey: walletKey.slice(0, 10) + '...',
      },
      storedAt,
    };
  }

  const response = await fetch(`${config.fileverseApiUrl}/store`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ciphertext, iv }),
  });

  if (!response.ok) {
    throw new Error(`Fileverse storage error: ${response.status}`);
  }

  const { cid } = await response.json() as { cid: string };

  return {
    id: cid,
    provider: 'legacy-local',
    encryption: {
      algorithm: 'aes-256-gcm',
      iv,
      publicKey: walletKey.slice(0, 10) + '...',
    },
    storedAt: Date.now(),
  };
}

/**
 * Retrieve and decrypt search history from Fileverse.
 */
export async function getSearchHistory(
  walletKey: string,
  config: FileverseClientConfig,
  limit: number = 10
): Promise<HistoryEntry[]> {
  const key = await deriveEncryptionKey(walletKey);

  if (config.fileverseTransport === 'mcp') {
    return getSearchHistoryViaMcp(key, config, limit);
  }

  const response = await fetch(`${config.fileverseApiUrl}/history?limit=${limit}`);
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
      id: entry.cid,
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
  searchIds: string[],
  walletKey: string,
  author: HexString,
  config: FileverseClientConfig
): Promise<{ report: ResearchReport; entry: EncryptedEntry }> {
  const key = await deriveEncryptionKey(walletKey);

  if (config.fileverseTransport === 'mcp') {
    return compileReportViaMcp(title, searchIds, walletKey, author, key, config);
  }

  const searches: SearchRecord[] = [];
  for (const id of searchIds) {
    const response = await fetch(`${config.fileverseApiUrl}/entry/${id}`);
    if (!response.ok) continue;
    const { ciphertext, iv } = await response.json() as { ciphertext: string; iv: string };
    const plaintext = await decryptData(ciphertext, iv, key);
    searches.push(JSON.parse(plaintext) as SearchRecord);
  }

  if (searches.length === 0) {
    throw new Error('None of the requested search records could be retrieved from Fileverse');
  }

  const summary = buildReportSummary(searches);
  const report: ResearchReport = {
    title,
    searchIds,
    summary,
    searches,
    createdAt: Date.now(),
    author,
  };

  const { ciphertext, iv } = await encryptData(JSON.stringify(report), key);

  const storeResponse = await fetch(`${config.fileverseApiUrl}/store`, {
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
      id: cid,
      provider: 'legacy-local',
      encryption: {
        algorithm: 'aes-256-gcm',
        iv,
        publicKey: walletKey.slice(0, 10) + '...',
      },
      storedAt: Date.now(),
    },
  };
}

async function getSearchHistoryViaMcp(
  key: DerivedEncryptionKey,
  config: FileverseClientConfig,
  limit: number
): Promise<HistoryEntry[]> {
  const history: HistoryEntry[] = [];
  const pageSize = Math.min(Math.max(limit * 3, 10), 50);
  let skip = 0;
  let hasNext = true;

  while (history.length < limit && hasNext) {
    const page = await callFileverseTool<FileverseListResponse>(
      config,
      'fileverse_list_documents',
      { limit: pageSize, skip }
    );

    for (const document of page.ddocs) {
      if (history.length >= limit) break;
      const envelope = parseEnvelope(document.content, 'meshsearch-search-record');
      if (!envelope) continue;

      try {
        const plaintext = await decryptData(envelope.ciphertext, envelope.iv, key);
        history.push({
          record: JSON.parse(plaintext) as SearchRecord,
          id: document.ddocId,
          link: document.link,
          syncStatus: document.syncStatus,
          decryptedAt: Date.now(),
        });
      } catch {
        continue;
      }
    }

    skip += page.ddocs.length;
    hasNext = page.hasNext;
    if (page.ddocs.length === 0) break;
  }

  return history;
}

async function compileReportViaMcp(
  title: string,
  searchIds: string[],
  walletKey: string,
  author: HexString,
  key: DerivedEncryptionKey,
  config: FileverseClientConfig
): Promise<{ report: ResearchReport; entry: EncryptedEntry }> {
  const searches: SearchRecord[] = [];

  for (const id of searchIds) {
    const document = await callFileverseTool<FileverseDocument>(
      config,
      'fileverse_get_document',
      { ddocId: id }
    );
    const envelope = parseEnvelope(document.content, 'meshsearch-search-record');
    if (!envelope) continue;

    try {
      const plaintext = await decryptData(envelope.ciphertext, envelope.iv, key);
      searches.push(JSON.parse(plaintext) as SearchRecord);
    } catch {
      continue;
    }
  }

  if (searches.length === 0) {
    throw new Error('None of the requested search records could be retrieved from Fileverse');
  }

  const report: ResearchReport = {
    title,
    searchIds,
    summary: buildReportSummary(searches),
    searches,
    createdAt: Date.now(),
    author,
  };

  const { ciphertext, iv } = await encryptData(JSON.stringify(report), key);
  const envelope: EncryptedEnvelope<'meshsearch-report'> = {
    version: 1,
    kind: 'meshsearch-report',
    ciphertext,
    iv,
    storedAt: Date.now(),
  };

  const document = await createDocumentViaMcp(
    createReportDocumentTitle(title),
    JSON.stringify(envelope),
    config
  );

  return {
    report: {
      ...report,
      link: document.link,
      syncStatus: document.syncStatus,
    },
    entry: {
      id: document.ddocId,
      provider: 'fileverse-mcp',
      link: document.link,
      syncStatus: document.syncStatus,
      encryption: {
        algorithm: 'aes-256-gcm',
        iv,
        publicKey: walletKey.slice(0, 10) + '...',
      },
      storedAt: envelope.storedAt,
    },
  };
}

async function createDocumentViaMcp(
  title: string,
  content: string,
  config: FileverseClientConfig
): Promise<FileverseDocument> {
  const created = await callFileverseTool<FileverseDocument>(
    config,
    'fileverse_create_document',
    { title, content }
  );

  if (created.syncStatus === 'synced' || created.syncStatus === 'failed') {
    return created;
  }

  const status = await waitForSync(created.ddocId, config);
  return {
    ...created,
    link: status.link || created.link,
    syncStatus: status.syncStatus,
  };
}

async function waitForSync(
  ddocId: string,
  config: FileverseClientConfig
): Promise<FileverseSyncResponse> {
  const deadline = Date.now() + config.fileverseSyncTimeoutMs;
  let current: FileverseSyncResponse = {
    ddocId,
    syncStatus: 'pending',
    link: '',
  };

  while (Date.now() < deadline) {
    await sleep(config.fileverseSyncPollIntervalMs);
    current = await callFileverseTool<FileverseSyncResponse>(
      config,
      'fileverse_get_sync_status',
      { ddocId }
    );

    if (current.syncStatus === 'synced') {
      return current;
    }

    if (current.syncStatus === 'failed') {
      throw new Error(`Fileverse sync failed for ${ddocId}`);
    }
  }

  return current;
}

async function callFileverseTool<TResult>(
  config: FileverseClientConfig,
  toolName: string,
  args: Record<string, unknown>
): Promise<TResult> {
  const serverUrl = config.fileverseServerUrl.trim();
  if (!serverUrl) {
    throw new Error('FILEVERSE_SERVER_URL is required when FILEVERSE_TRANSPORT=mcp');
  }

  const response = await fetch(fileverseMcpUrl(serverUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Fileverse MCP error: ${response.status}`);
  }

  const rawResponse = await response.text();
  const payload = JSON.parse(extractJsonRpcPayload(rawResponse)) as {
    error?: { message?: string };
    result?: {
      isError?: boolean;
      content?: Array<{ type?: string; text?: string }>;
    };
  };

  if (payload.error) {
    throw new Error(payload.error.message ?? 'Unknown Fileverse MCP error');
  }

  if (payload.result?.isError) {
    throw new Error(extractToolText(payload.result.content) || 'Unknown Fileverse MCP tool error');
  }

  const text = extractToolText(payload.result?.content);
  if (!text) {
    throw new Error(`Fileverse MCP tool ${toolName} returned no content`);
  }

  return JSON.parse(text) as TResult;
}

function buildReportSummary(searches: SearchRecord[]): string {
  return searches
    .flatMap(search => search.response.results)
    .map(result => `- [${result.title}](${result.url}): ${result.snippet}`)
    .join('\n');
}

function createSearchDocumentTitle(timestamp: number): string {
  return `MeshSearch Search ${new Date(timestamp).toISOString()}`;
}

function createReportDocumentTitle(title: string): string {
  return `MeshSearch Report ${title}`;
}

function parseEnvelope<TKind extends FileverseEnvelopeKind>(
  content: string,
  kind: TKind
): EncryptedEnvelope<TKind> | null {
  try {
    const parsed = JSON.parse(content) as Partial<EncryptedEnvelope<TKind>>;
    if (
      parsed.version !== 1 ||
      parsed.kind !== kind ||
      typeof parsed.ciphertext !== 'string' ||
      typeof parsed.iv !== 'string' ||
      typeof parsed.storedAt !== 'number'
    ) {
      return null;
    }
    return parsed as EncryptedEnvelope<TKind>;
  } catch {
    return null;
  }
}

function extractJsonRpcPayload(rawResponse: string): string {
  const trimmed = rawResponse.trim();
  if (trimmed.startsWith('{')) {
    return trimmed;
  }

  const dataLines = trimmed
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice('data:'.length).trim())
    .filter(Boolean);

  if (dataLines.length > 0) {
    return dataLines[dataLines.length - 1];
  }

  throw new Error('Unexpected Fileverse MCP response');
}

function extractToolText(content: Array<{ type?: string; text?: string }> | undefined): string {
  return (content ?? [])
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
    .trim();
}

function fileverseMcpUrl(serverUrl: string): string {
  const normalized = serverUrl.replace(/\/+$/, '');
  return normalized.endsWith('/mcp') ? normalized : `${normalized}/mcp`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

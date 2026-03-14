/**
 * Fileverse Storage Service — Encrypted history + report storage on IPFS.
 *
 * Calls the Fileverse Storage V2 REST API to pin encrypted blobs to IPFS.
 * Supports three auth modes:
 *   - public: /upload/public
 *   - apiKey: header-based auth using FILEVERSE_API_KEY
 *   - ucan: Bearer UCAN token + contract/invoker headers
 *
 * Env vars:
 *   FILEVERSE_STORAGE_URL    — Fileverse Storage V2 API base URL
 *   FILEVERSE_AUTH_MODE      — public | apiKey | ucan (auto-detected if unset)
 *   FILEVERSE_API_KEY        — API key for header-based auth
 *   FILEVERSE_API_KEY_HEADER — Header name for FILEVERSE_API_KEY (default: X-API-Key)
 *   FILEVERSE_API_KEY_PREFIX — Optional prefix, e.g. "Bearer "
 *   FILEVERSE_UPLOAD_PATH    — Override upload path
 *   FILEVERSE_UCAN_TOKEN     — UCAN Bearer token
 *   FILEVERSE_CONTRACT       — Contract address associated with uploads
 *   FILEVERSE_INVOKER        — Invoker wallet address
 *   FILEVERSE_CHAIN          — Chain ID (default: 1)
 *   FILEVERSE_GATEWAY        — IPFS gateway base URL for reads
 *   PORT                     — HTTP port (default: 4005)
 *   CACHE_DIR                — Local cache directory (default: .fileverse-cache)
 */

import { config as loadDotenv } from 'dotenv';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
loadDotenv({ path: resolve(projectRoot, '.env') });
loadDotenv();

const app = new Hono();

const PORT = parseInt(process.env.PORT || '4005', 10);
const CACHE_DIR = process.env.CACHE_DIR || join(process.cwd(), '.fileverse-cache');

// Ensure cache directory exists
mkdirSync(CACHE_DIR, { recursive: true });

// ─── Fileverse Storage V2 configuration ────────────────────────────────────

const FILEVERSE_STORAGE_URL  = process.env.FILEVERSE_STORAGE_URL?.replace(/\/$/, '');
const FILEVERSE_AUTH_MODE    = process.env.FILEVERSE_AUTH_MODE;
const FILEVERSE_API_KEY      = process.env.FILEVERSE_API_KEY;
const FILEVERSE_API_KEY_HEADER = process.env.FILEVERSE_API_KEY_HEADER || 'X-API-Key';
const FILEVERSE_API_KEY_PREFIX = process.env.FILEVERSE_API_KEY_PREFIX || '';
const FILEVERSE_UPLOAD_PATH  = process.env.FILEVERSE_UPLOAD_PATH;
const FILEVERSE_UCAN_TOKEN   = process.env.FILEVERSE_UCAN_TOKEN;
const FILEVERSE_CONTRACT     = process.env.FILEVERSE_CONTRACT;
const FILEVERSE_INVOKER      = process.env.FILEVERSE_INVOKER;
const FILEVERSE_CHAIN        = process.env.FILEVERSE_CHAIN || '1';
const FILEVERSE_GATEWAY      = (process.env.FILEVERSE_GATEWAY || 'https://ipfs.io/ipfs').replace(/\/$/, '');

const hasUcanCredentials = !!(FILEVERSE_UCAN_TOKEN && FILEVERSE_CONTRACT && FILEVERSE_INVOKER);
const authMode = FILEVERSE_AUTH_MODE
  ?? (FILEVERSE_API_KEY ? 'apiKey' : hasUcanCredentials ? 'ucan' : 'public');
const isApiKeyAuth = authMode === 'apiKey' && !!FILEVERSE_API_KEY;
const isUcanAuth = authMode === 'ucan' && hasUcanCredentials;

if (FILEVERSE_STORAGE_URL) {
  console.log(`[fileverse] Fileverse Storage API: ${FILEVERSE_STORAGE_URL} (auth: ${authMode})`);
} else {
  console.warn('[fileverse] FILEVERSE_STORAGE_URL not set — IPFS pinning disabled, local cache only');
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface StoredEntry {
  cid: string;
  ciphertext: string;
  iv: string;
  type?: string;
  storedAt: number;
}

// ─── Local cache layer (mirrors IPFS for fast reads + listing) ──────────────

function safeCid(cid: string): string {
  return cid.replace(/[^a-zA-Z0-9]/g, '');
}

function entryPath(cid: string): string {
  return join(CACHE_DIR, `${safeCid(cid)}.json`);
}

function cacheRead(cid: string): StoredEntry | null {
  const path = entryPath(cid);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as StoredEntry;
}

function cacheWrite(entry: StoredEntry): void {
  writeFileSync(entryPath(entry.cid), JSON.stringify(entry), 'utf-8');
}

function cacheList(): StoredEntry[] {
  if (!existsSync(CACHE_DIR)) return [];
  return readdirSync(CACHE_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        return JSON.parse(readFileSync(join(CACHE_DIR, f), 'utf-8')) as StoredEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is StoredEntry => e !== null);
}

// ─── IPFS retrieval via configurable gateway ────────────────────────────────

async function ipfsGet(cid: string): Promise<StoredEntry | null> {
  if (!FILEVERSE_STORAGE_URL) return null;
  try {
    const res = await fetch(`${FILEVERSE_GATEWAY}/${cid}`);
    if (!res.ok) return null;
    const data = await res.json() as StoredEntry;
    if (data && data.ciphertext) {
      const entry: StoredEntry = { ...data, cid };
      cacheWrite(entry);
      return entry;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// Health check
app.get('/health', (c) => {
  const entryCount = existsSync(CACHE_DIR)
    ? readdirSync(CACHE_DIR).filter(f => f.endsWith('.json')).length
    : 0;
  return c.json({
    status: 'ok',
    entries: entryCount,
    ipfsEnabled: !!FILEVERSE_STORAGE_URL,
    auth: FILEVERSE_STORAGE_URL ? authMode : 'disabled',
    timestamp: Date.now(),
  });
});

// Store an encrypted entry → pin to Fileverse IPFS, cache locally
app.post('/store', async (c) => {
  const body = await c.req.json<{ ciphertext: string; iv: string; type?: string }>();

  if (!body.ciphertext || !body.iv) {
    return c.json({ error: 'Missing ciphertext or iv' }, 400);
  }

  const storedAt = Date.now();
  const payload = {
    ciphertext: body.ciphertext,
    iv: body.iv,
    type: body.type,
    storedAt,
  };

  let cid: string;

  if (FILEVERSE_STORAGE_URL) {
    // Upload to Fileverse Storage V2 API as multipart form data
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const form = new FormData();
    form.append('file', blob, 'entry.json');
    form.append('sourceApp', 'meshsearch');
    form.append('ipfsType', body.type === 'report' ? 'CONTENT' : 'METADATA');

    const endpoint = `${FILEVERSE_STORAGE_URL}${FILEVERSE_UPLOAD_PATH || (isApiKeyAuth || isUcanAuth ? '/upload/' : '/upload/public')}`;
    const headers: Record<string, string> = {};

    if (isUcanAuth) {
      headers['Authorization'] = `Bearer ${FILEVERSE_UCAN_TOKEN}`;
      headers['Contract']      = FILEVERSE_CONTRACT!;
      headers['Invoker']       = FILEVERSE_INVOKER!;
      headers['Chain']         = FILEVERSE_CHAIN;
    } else if (isApiKeyAuth) {
      headers[FILEVERSE_API_KEY_HEADER] = `${FILEVERSE_API_KEY_PREFIX}${FILEVERSE_API_KEY}`;
    }

    const uploadRes = await fetch(endpoint, { method: 'POST', headers, body: form });
    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      return c.json({ error: `Fileverse upload failed: ${errText}` }, 502);
    }
    const uploadData = await uploadRes.json() as { ipfsHash: string };
    cid = uploadData.ipfsHash;
  } else {
    // Local-only: derive CID from content hash (development mode)
    const { sha256 } = await import('@noble/hashes/sha256');
    const { bytesToHex } = await import('@noble/hashes/utils');
    const hash = sha256(new TextEncoder().encode(body.ciphertext));
    cid = `bafk${bytesToHex(hash).slice(0, 32)}`;
  }

  // Cache locally for fast reads
  const entry: StoredEntry = { cid, ...payload };
  cacheWrite(entry);

  return c.json({ cid, storedAt, ipfsPinned: !!FILEVERSE_STORAGE_URL });
});

// Retrieve a specific entry by CID — cache first, then IPFS gateway
app.get('/entry/:cid', async (c) => {
  const cid = c.req.param('cid');

  // Try local cache first
  let entry = cacheRead(cid);

  // Fall back to IPFS gateway
  if (!entry) {
    entry = await ipfsGet(cid);
  }

  if (!entry) {
    return c.json({ error: 'Entry not found' }, 404);
  }

  return c.json({
    cid: entry.cid,
    ciphertext: entry.ciphertext,
    iv: entry.iv,
  });
});

// List history entries (most recent first)
app.get('/history', (c) => {
  const limit = parseInt(c.req.query('limit') || '10', 10);
  const entries = cacheList()
    .filter(e => e.type !== 'report')
    .sort((a, b) => b.storedAt - a.storedAt)
    .slice(0, limit)
    .map(e => ({
      cid: e.cid,
      ciphertext: e.ciphertext,
      iv: e.iv,
    }));

  return c.json(entries);
});

// List reports
app.get('/reports', (c) => {
  const entries = cacheList()
    .filter(e => e.type === 'report')
    .sort((a, b) => b.storedAt - a.storedAt)
    .map(e => ({
      cid: e.cid,
      ciphertext: e.ciphertext,
      iv: e.iv,
    }));

  return c.json(entries);
});

// Delete an entry — remove from local cache (Fileverse Storage V2 has no unpin API)
app.delete('/entry/:cid', async (c) => {
  const cid = c.req.param('cid');
  const path = entryPath(cid);

  if (!existsSync(path)) {
    return c.json({ error: 'Entry not found' }, 404);
  }

  unlinkSync(path);
  return c.json({ deleted: true });
});

// Export for testing
export { app, CACHE_DIR as DATA_DIR };

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Fileverse storage service running on port ${PORT} (IPFS: ${FILEVERSE_STORAGE_URL ? 'enabled' : 'disabled'}, auth: ${FILEVERSE_STORAGE_URL ? authMode : 'disabled'})`);
});

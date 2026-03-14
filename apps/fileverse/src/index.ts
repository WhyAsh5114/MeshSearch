/**
 * Fileverse Storage Service — Encrypted history + report storage.
 *
 * Persistent file-backed storage using content-addressed CIDs.
 * Entries are SHA-256 hashed for content-addressing (like IPFS).
 * The service never sees plaintext — only encrypted blobs.
 */

import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';

const app = new Hono();

const PORT = parseInt(process.env.PORT || '4005', 10);
const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), '.fileverse-data');

// Ensure data directory exists
mkdirSync(DATA_DIR, { recursive: true });

interface StoredEntry {
  cid: string;
  ciphertext: string;
  iv: string;
  type?: string;
  storedAt: number;
}

/** Content-addressed CID from sha256 of ciphertext */
function computeCid(ciphertext: string): string {
  const hash = sha256(new TextEncoder().encode(ciphertext));
  return `bafk${bytesToHex(hash).slice(0, 32)}`;
}

function entryPath(cid: string): string {
  // Sanitize CID to prevent path traversal
  const safeCid = cid.replace(/[^a-zA-Z0-9]/g, '');
  return join(DATA_DIR, `${safeCid}.json`);
}

function readEntry(cid: string): StoredEntry | null {
  const path = entryPath(cid);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as StoredEntry;
}

function writeEntry(entry: StoredEntry): void {
  writeFileSync(entryPath(entry.cid), JSON.stringify(entry), 'utf-8');
}

function listEntries(): StoredEntry[] {
  if (!existsSync(DATA_DIR)) return [];
  return readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        return JSON.parse(readFileSync(join(DATA_DIR, f), 'utf-8')) as StoredEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is StoredEntry => e !== null);
}

// Health check
app.get('/health', (c) => {
  const entryCount = existsSync(DATA_DIR) ? readdirSync(DATA_DIR).filter(f => f.endsWith('.json')).length : 0;
  return c.json({ status: 'ok', entries: entryCount, timestamp: Date.now() });
});

// Store an encrypted entry
app.post('/store', async (c) => {
  const body = await c.req.json<{ ciphertext: string; iv: string; type?: string }>();

  if (!body.ciphertext || !body.iv) {
    return c.json({ error: 'Missing ciphertext or iv' }, 400);
  }

  // Content-addressed CID (deterministic from content)
  const cid = computeCid(body.ciphertext);

  const entry: StoredEntry = {
    cid,
    ciphertext: body.ciphertext,
    iv: body.iv,
    type: body.type,
    storedAt: Date.now(),
  };

  writeEntry(entry);

  return c.json({ cid, storedAt: entry.storedAt });
});

// Retrieve a specific entry by CID
app.get('/entry/:cid', (c) => {
  const cid = c.req.param('cid');
  const entry = readEntry(cid);

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
  const entries = listEntries()
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
  const entries = listEntries()
    .filter(e => e.type === 'report')
    .sort((a, b) => b.storedAt - a.storedAt)
    .map(e => ({
      cid: e.cid,
      ciphertext: e.ciphertext,
      iv: e.iv,
    }));

  return c.json(entries);
});

// Delete an entry (owner action only in production)
app.delete('/entry/:cid', (c) => {
  const cid = c.req.param('cid');
  const path = entryPath(cid);
  if (!existsSync(path)) {
    return c.json({ error: 'Entry not found' }, 404);
  }
  unlinkSync(path);
  return c.json({ deleted: true });
});

// Export for testing
export { app, DATA_DIR };

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Fileverse storage service running on port ${PORT}`);
});

/**
 * Fileverse Storage Service — Encrypted history + report storage.
 *
 * Local development implementation that stores encrypted entries in-memory.
 * In production, entries are stored on IPFS via the Fileverse API.
 * The service never sees plaintext — only encrypted blobs.
 */

import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { randomBytes, bytesToHex } from '@noble/hashes/utils';

const app = new Hono();

const PORT = parseInt(process.env.PORT || '4005', 10);

interface StoredEntry {
  cid: string;
  ciphertext: string;
  iv: string;
  type?: string;
  storedAt: number;
}

// In-memory store (production: IPFS via Fileverse)
const store = new Map<string, StoredEntry>();

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', entries: store.size, timestamp: Date.now() });
});

// Store an encrypted entry
app.post('/store', async (c) => {
  const body = await c.req.json<{ ciphertext: string; iv: string; type?: string }>();

  if (!body.ciphertext || !body.iv) {
    return c.json({ error: 'Missing ciphertext or iv' }, 400);
  }

  // Generate a CID-like identifier (production: actual IPFS CID)
  const cid = `bafk${bytesToHex(randomBytes(16))}`;

  const entry: StoredEntry = {
    cid,
    ciphertext: body.ciphertext,
    iv: body.iv,
    type: body.type,
    storedAt: Date.now(),
  };

  store.set(cid, entry);

  return c.json({ cid, storedAt: entry.storedAt });
});

// Retrieve a specific entry by CID
app.get('/entry/:cid', (c) => {
  const cid = c.req.param('cid');
  const entry = store.get(cid);

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
  const entries = Array.from(store.values())
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
  const entries = Array.from(store.values())
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
  if (!store.has(cid)) {
    return c.json({ error: 'Entry not found' }, 404);
  }
  store.delete(cid);
  return c.json({ deleted: true });
});

// Export for testing
export { app, store };

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Fileverse storage service running on port ${PORT}`);
});

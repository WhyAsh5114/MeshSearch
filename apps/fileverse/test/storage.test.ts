import { describe, it, expect, beforeEach } from 'vitest';
import { app, store } from '../src/index.js';

describe('Fileverse Storage Service', () => {
  beforeEach(() => {
    store.clear();
  });

  it('should respond to health check', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; entries: number };
    expect(body.entries).toBe(0);
  });

  it('should store an encrypted entry', async () => {
    const res = await app.request('/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ciphertext: 'deadbeef',
        iv: 'aabbccdd',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { cid: string; storedAt: string };
    expect(body.storedAt).toBeDefined();
  });

  it('should reject store without ciphertext', async () => {
    const res = await app.request('/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iv: 'aabbccdd' }),
    });
    expect(res.status).toBe(400);
  });

  it('should retrieve an entry by CID', async () => {
    // Store first
    const storeRes = await app.request('/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ciphertext: 'encrypted-data', iv: '1234' }),
    });
    const { cid } = await storeRes.json() as { cid: string };

    // Retrieve
    const getRes = await app.request(`/entry/${cid}`);
    expect(getRes.status).toBe(200);
    const body = await getRes.json() as { ciphertext: string; iv: string };
    expect(body.iv).toBe('1234');
  });

  it('should return 404 for missing entry', async () => {
    const res = await app.request('/entry/nonexistent');
    expect(res.status).toBe(404);
  });

  it('should list history entries', async () => {
    // Store two entries
    await app.request('/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ciphertext: 'a', iv: '1' }),
    });
    await app.request('/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ciphertext: 'b', iv: '2' }),
    });

    const res = await app.request('/history');
    expect(res.status).toBe(200);
    const entries = await res.json() as unknown[];
    expect(entries).toHaveLength(2);
  });

  it('should delete an entry', async () => {
    const storeRes = await app.request('/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ciphertext: 'to-delete', iv: '1' }),
    });
    const { cid } = await storeRes.json() as { cid: string };

    const delRes = await app.request(`/entry/${cid}`, { method: 'DELETE' });
    expect(delRes.status).toBe(200);

    const getRes = await app.request(`/entry/${cid}`);
    expect(getRes.status).toBe(404);
  });

  it('should separate reports from history', async () => {
    await app.request('/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ciphertext: 'search', iv: '1' }),
    });
    await app.request('/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ciphertext: 'report', iv: '2', type: 'report' }),
    });

    const historyRes = await app.request('/history');
    const history = await historyRes.json() as unknown[];
    expect(history).toHaveLength(1);

    const reportsRes = await app.request('/reports');
    const reports = await reportsRes.json() as unknown[];
    expect(reports).toHaveLength(1);
  });
});

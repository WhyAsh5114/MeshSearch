import { describe, it, expect } from 'vitest';
import { app } from '../src/index.js';

describe('Relay Node', () => {
  it('should respond to health check', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; ensName: string; publicKey: string; timestamp: number };
    expect(body.ensName).toBeDefined();
    expect(body.publicKey).toBeDefined();
    expect(body.timestamp).toBeDefined();
  });

  it('should respond to status check', async () => {
    const res = await app.request('/status');
    expect(res.status).toBe(200);
    const body = await res.json() as { ensName: string; relayedCount: number; errorCount: number };
    expect(typeof body.errorCount).toBe('number');
  });

  it('should reject invalid relay request', async () => {
    const res = await app.request('/relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('should reject relay request with missing onionLayer', async () => {
    const res = await app.request('/relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ routingId: 'test' }),
    });
    expect(res.status).toBe(400);
  });

  it('should return 502 for undecryptable onion layer', async () => {
    const res = await app.request('/relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        routingId: 'test-route',
        onionLayer: {
          ciphertext: 'deadbeef',
          ephemeralPublicKey: '02' + 'aa'.repeat(32),
          nonce: 'aabbccdd',
        },
        hopIndex: 0,
      }),
    });
    // Should fail decryption and return 502
    expect(res.status).toBe(502);
  });
});

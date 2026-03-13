import { describe, it, expect } from 'vitest';
import { app } from '../src/index.js';

describe('Search Backend', () => {
  it('should respond to health check', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('should reject missing encryptedQuery', async () => {
    const res = await app.request('/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('should reject malformed encrypted query', async () => {
    const res = await app.request('/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        encryptedQuery: {
          ciphertext: 'invalid',
          ephemeralPublicKey: 'invalid',
          nonce: 'invalid',
        },
      }),
    });
    // Should fail decryption
    expect(res.status).toBe(400);
  });
});

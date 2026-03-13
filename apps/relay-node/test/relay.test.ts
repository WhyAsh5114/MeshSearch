import { describe, it, expect } from 'vitest';
import { app } from '../src/index.js';

describe('Relay Node', () => {
  it('should respond to health check', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; ensName: string; timestamp: string };
    expect(body.ensName).toBeDefined();
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

  it('should reject relay request with missing fields', async () => {
    const res = await app.request('/relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ routingId: 'test' }),
    });
    expect(res.status).toBe(400);
  });
});

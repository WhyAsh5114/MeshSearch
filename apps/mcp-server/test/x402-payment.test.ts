import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkENSSubscription,
  createNodeAdapter,
  _testHelpers,
} from '../src/middleware/x402-payment.js';
import type { IncomingMessage } from 'node:http';

const RPC = 'http://localhost:8545';
const CONTRACT = '0x0000000000000000000000000000000000000000';

/** Minimal IncomingMessage stub for testing the adapter */
function fakeReq(overrides: Partial<{ method: string; url: string; headers: Record<string, string | undefined> }> = {}): IncomingMessage {
  return {
    method: overrides.method ?? 'POST',
    url: overrides.url ?? '/mcp',
    headers: overrides.headers ?? {},
  } as unknown as IncomingMessage;
}

describe('x402 Payment Middleware', () => {
  beforeEach(() => {
    _testHelpers.resetState();
  });

  describe('HTTPAdapter (createNodeAdapter)', () => {
    it('should extract method and path from a request', () => {
      const adapter = createNodeAdapter(fakeReq({ method: 'POST', url: '/mcp?foo=bar' }));
      expect(adapter.getMethod()).toBe('POST');
      expect(adapter.getPath()).toBe('/mcp');
      expect(adapter.getUrl()).toBe('/mcp?foo=bar');
    });

    it('should read headers case-insensitively', () => {
      const adapter = createNodeAdapter(fakeReq({
        headers: { 'x-payment': 'some-token', 'content-type': 'application/json' },
      }));
      expect(adapter.getHeader('X-Payment')).toBe('some-token');
      expect(adapter.getHeader('Content-Type')).toBe('application/json');
    });

    it('should return undefined for missing headers', () => {
      const adapter = createNodeAdapter(fakeReq());
      expect(adapter.getHeader('x-payment')).toBeUndefined();
    });
  });

  describe('ENS Subscription', () => {
    it('should return false for unknown ENS name', async () => {
      expect(await checkENSSubscription('unknown.eth', RPC, CONTRACT)).toBe(false);
    });

    it('should return true for subscribed ENS name', async () => {
      _testHelpers.addSubscription('user.eth');
      expect(await checkENSSubscription('user.eth', RPC, CONTRACT)).toBe(true);
    });

    it('should reject non-.eth names', async () => {
      expect(await checkENSSubscription('user.com', RPC, CONTRACT)).toBe(false);
    });

    it('should reject empty ENS names', async () => {
      expect(await checkENSSubscription('', RPC, CONTRACT)).toBe(false);
    });
  });
});

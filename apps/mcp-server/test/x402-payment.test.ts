import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  checkENSSubscription,
  createNodeAdapter,
  _testHelpers,
} from '../src/middleware/x402-payment.js';
import type { IncomingMessage } from 'node:http';

// Mock the ENS client to avoid network calls in unit tests
vi.mock('../src/ens/client.js', () => ({
  resolveEnsName: vi.fn(async (name: string) => {
    // Simulate known ENS names resolving
    const known: Record<string, string> = {
      'vitalik.eth': '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      'user.eth': '0x1234567890abcdef1234567890abcdef12345678',
    };
    return known[name] ?? null;
  }),
}));

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
    it('should return false for unknown ENS name (does not resolve)', async () => {
      // 'unknown.eth' is not in our mock ENS data
      expect(await checkENSSubscription('unknown.eth', RPC, CONTRACT)).toBe(false);
    });

    it('should return true for subscribed ENS name that resolves', async () => {
      // 'user.eth' resolves in our mock, and we add it to the dev subscription set
      _testHelpers.addSubscription('user.eth');
      expect(await checkENSSubscription('user.eth', RPC, CONTRACT)).toBe(true);
    });

    it('should return false for resolvable ENS name without subscription', async () => {
      // 'vitalik.eth' resolves but has no subscription
      expect(await checkENSSubscription('vitalik.eth', RPC, CONTRACT)).toBe(false);
    });

    it('should reject non-.eth names', async () => {
      expect(await checkENSSubscription('user.com', RPC, CONTRACT)).toBe(false);
    });

    it('should reject empty ENS names', async () => {
      expect(await checkENSSubscription('', RPC, CONTRACT)).toBe(false);
    });
  });
});

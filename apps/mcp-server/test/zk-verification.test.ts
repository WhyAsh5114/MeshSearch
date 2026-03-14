import { describe, it, expect, beforeEach } from 'vitest';
import { checkNullifier, recordNullifier, storeResultHashOnchain, _testHelpers } from '../src/middleware/zk-verification.js';
import type { HexString } from '@meshsearch/types';

// Use zero-address contract to exercise in-memory fallback paths
const RPC = 'http://localhost:8545';
const CONTRACT = '0x0000000000000000000000000000000000000000';

describe('ZK Verification Middleware', () => {
  beforeEach(() => {
    _testHelpers.resetState();
  });

  describe('Nullifier tracking (in-memory fallback)', () => {
    const nullifier = '12345678901234567890';

    it('should report unused nullifier', async () => {
      expect(await checkNullifier(nullifier, RPC, CONTRACT)).toBe(false);
    });

    it('should record and detect used nullifier', async () => {
      await recordNullifier(nullifier, RPC, CONTRACT);
      expect(await checkNullifier(nullifier, RPC, CONTRACT)).toBe(true);
    });

    it('should track different nullifiers independently', async () => {
      await recordNullifier('nullifier-a', RPC, CONTRACT);
      expect(await checkNullifier('nullifier-a', RPC, CONTRACT)).toBe(true);
      expect(await checkNullifier('nullifier-b', RPC, CONTRACT)).toBe(false);
    });
  });

  describe('Result hash storage (in-memory fallback)', () => {
    it('should store and return result hash', async () => {
      const commitment = '0xabc123' as HexString;
      const results = '{"results": []}';

      const hash = await storeResultHashOnchain(commitment, results, RPC, CONTRACT);
      expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
    });

    it('should produce deterministic hashes', async () => {
      const commitment = '0xabc123' as HexString;
      const results = '{"results": [{"title": "test"}]}';

      const h1 = await storeResultHashOnchain(commitment, results, RPC, CONTRACT);
      const h2 = await storeResultHashOnchain(commitment, results, RPC, CONTRACT);
      expect(h1).toBe(h2);
    });
  });
});

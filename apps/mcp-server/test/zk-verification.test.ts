import { describe, it, expect, beforeEach } from 'vitest';
import { verifyZKProof, checkNullifier, recordNullifier, storeResultHashOnchain, _testHelpers } from '../src/middleware/zk-verification.js';
import type { ZKProof, HexString } from '@meshsearch/types';

const RPC = 'http://localhost:8545';
const CONTRACT = '0x0000000000000000000000000000000000000000';

describe('ZK Verification Middleware', () => {
  beforeEach(() => {
    _testHelpers.resetState();
  });

  it('should accept a valid ZK proof', async () => {
    const proof: ZKProof = {
      commitment: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as HexString,
      nullifierHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as HexString,
      proof: '0xdeadbeef' as HexString,
      merkleTreeRoot: '0xcafebabe' as HexString,
      externalNullifier: '0xfeedface' as HexString,
    };

    const result = await verifyZKProof(proof);
    expect(result.valid).toBe(true);
  });

  it('should reject proof with missing fields', async () => {
    const proof = {
      commitment: '' as HexString,
      nullifierHash: '0x1234' as HexString,
      proof: '0xdeadbeef' as HexString,
      merkleTreeRoot: '0xcafebabe' as HexString,
      externalNullifier: '0xfeedface' as HexString,
    };

    const result = await verifyZKProof(proof);
    expect(result.valid).toBe(false);
  });

  it('should reject proof with invalid hex', async () => {
    const proof: ZKProof = {
      commitment: 'not-hex' as HexString,
      nullifierHash: '0x1234' as HexString,
      proof: '0xdeadbeef' as HexString,
      merkleTreeRoot: '0xcafebabe' as HexString,
      externalNullifier: '0xfeedface' as HexString,
    };

    const result = await verifyZKProof(proof);
    expect(result.valid).toBe(false);
  });

  describe('Nullifier tracking', () => {
    const nullifier = '0xabcdef' as HexString;

    it('should report unused nullifier', async () => {
      expect(await checkNullifier(nullifier, RPC, CONTRACT)).toBe(false);
    });

    it('should record and detect used nullifier', async () => {
      await recordNullifier(nullifier, RPC, CONTRACT);
      expect(await checkNullifier(nullifier, RPC, CONTRACT)).toBe(true);
    });
  });

  describe('Result hash storage', () => {
    it('should store and return result hash', async () => {
      const commitment = '0xabc123' as HexString;
      const results = '{"results": []}';

      const hash = await storeResultHashOnchain(commitment, results, RPC, CONTRACT);
      expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
    });
  });
});

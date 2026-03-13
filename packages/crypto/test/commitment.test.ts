import { describe, it, expect } from 'vitest';
import {
  generateSalt,
  createQueryCommitment,
  verifyQueryCommitment,
  hashResults,
  generateNullifier,
} from '../src/commitment.js';

describe('Query Commitment', () => {
  it('should generate a valid salt', () => {
    const salt = generateSalt();
    expect(salt).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it('should create a deterministic commitment from query + salt', () => {
    const salt = '0x' + 'ab'.repeat(32) as `0x${string}`;
    const c1 = createQueryCommitment('test query', salt);
    const c2 = createQueryCommitment('test query', salt);
    expect(c1.commitment).toBe(c2.commitment);
  });

  it('should create different commitments for different queries', () => {
    const salt = '0x' + 'ab'.repeat(32) as `0x${string}`;
    const c1 = createQueryCommitment('query one', salt);
    const c2 = createQueryCommitment('query two', salt);
    expect(c1.commitment).not.toBe(c2.commitment);
  });

  it('should create different commitments for different salts', () => {
    const salt1 = '0x' + 'ab'.repeat(32) as `0x${string}`;
    const salt2 = '0x' + 'cd'.repeat(32) as `0x${string}`;
    const c1 = createQueryCommitment('same query', salt1);
    const c2 = createQueryCommitment('same query', salt2);
    expect(c1.commitment).not.toBe(c2.commitment);
  });

  it('should verify a valid commitment', () => {
    const { commitment, salt, query } = createQueryCommitment('test query');
    expect(verifyQueryCommitment(commitment, query, salt)).toBe(true);
  });

  it('should reject an invalid commitment', () => {
    const { commitment, salt } = createQueryCommitment('test query');
    expect(verifyQueryCommitment(commitment, 'wrong query', salt)).toBe(false);
  });

  it('should preserve query in commitment output', () => {
    const result = createQueryCommitment('my private search');
    expect(result.query).toBe('my private search');
  });
});

describe('Hash Results', () => {
  it('should produce a hex hash', () => {
    const hash = hashResults('{"results": []}');
    expect(hash).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it('should produce consistent hashes', () => {
    const h1 = hashResults('{"results": [{"title": "a"}]}');
    const h2 = hashResults('{"results": [{"title": "a"}]}');
    expect(h1).toBe(h2);
  });

  it('should produce different hashes for different content', () => {
    const h1 = hashResults('{"results": [{"title": "a"}]}');
    const h2 = hashResults('{"results": [{"title": "b"}]}');
    expect(h1).not.toBe(h2);
  });
});

describe('Nullifier Generation', () => {
  it('should generate a valid nullifier', () => {
    const identity = '0x' + 'aa'.repeat(32) as `0x${string}`;
    const external = '0x' + 'bb'.repeat(32) as `0x${string}`;
    const nullifier = generateNullifier(identity, external);
    expect(nullifier).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it('should be deterministic', () => {
    const identity = '0x' + 'aa'.repeat(32) as `0x${string}`;
    const external = '0x' + 'bb'.repeat(32) as `0x${string}`;
    const n1 = generateNullifier(identity, external);
    const n2 = generateNullifier(identity, external);
    expect(n1).toBe(n2);
  });

  it('should differ for different identities', () => {
    const id1 = '0x' + 'aa'.repeat(32) as `0x${string}`;
    const id2 = '0x' + 'cc'.repeat(32) as `0x${string}`;
    const external = '0x' + 'bb'.repeat(32) as `0x${string}`;
    expect(generateNullifier(id1, external)).not.toBe(generateNullifier(id2, external));
  });
});

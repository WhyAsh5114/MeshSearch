import { describe, it, expect } from 'vitest';
import {
  deriveEncryptionKey,
  encryptData,
  decryptData,
} from '../src/encryption.js';

describe('AES-256-GCM Encryption', () => {
  it('should encrypt and decrypt data', async () => {
    const key = await deriveEncryptionKey('test-wallet-private-key');
    const plaintext = 'hello world search query';

    const { ciphertext, iv } = await encryptData(plaintext, key);
    expect(ciphertext).toBeTruthy();
    expect(iv).toBeTruthy();

    const decrypted = await decryptData(ciphertext, iv, key);
    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertexts for same plaintext (random IV)', async () => {
    const key = await deriveEncryptionKey('test-key');
    const plaintext = 'same input';

    const enc1 = await encryptData(plaintext, key);
    const enc2 = await encryptData(plaintext, key);

    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
    expect(enc1.iv).not.toBe(enc2.iv);
  });

  it('should fail decryption with wrong key', async () => {
    const key1 = await deriveEncryptionKey('key-one');
    const key2 = await deriveEncryptionKey('key-two');

    const { ciphertext, iv } = await encryptData('secret data', key1);

    await expect(decryptData(ciphertext, iv, key2)).rejects.toThrow();
  });

  it('should handle empty string', async () => {
    const key = await deriveEncryptionKey('test-key');
    const { ciphertext, iv } = await encryptData('', key);
    const decrypted = await decryptData(ciphertext, iv, key);
    expect(decrypted).toBe('');
  });

  it('should handle unicode content', async () => {
    const key = await deriveEncryptionKey('test-key');
    const plaintext = '搜索查询 🔍 données privées';
    const { ciphertext, iv } = await encryptData(plaintext, key);
    const decrypted = await decryptData(ciphertext, iv, key);
    expect(decrypted).toBe(plaintext);
  });
});

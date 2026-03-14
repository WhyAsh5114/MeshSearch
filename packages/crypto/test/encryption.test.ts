import { describe, it, expect } from 'vitest';
import {
  deriveEncryptionKey,
  encryptData,
  decryptData,
  generatePrivateKey,
  getPublicKey,
  encryptQueryForBackend,
  decryptQueryAtBackend,
  encryptOnionLayer,
  decryptOnionLayer,
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

describe('secp256k1 Key Generation', () => {
  it('should generate a 32-byte private key', () => {
    const priv = generatePrivateKey();
    expect(priv).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should derive a 33-byte compressed public key', () => {
    const priv = generatePrivateKey();
    const pub = getPublicKey(priv);
    // Compressed secp256k1 public key: 02 or 03 prefix + 32 bytes
    expect(pub).toMatch(/^0[23][a-f0-9]{64}$/);
  });

  it('should produce deterministic public keys', () => {
    const priv = generatePrivateKey();
    expect(getPublicKey(priv)).toBe(getPublicKey(priv));
  });
});

describe('ECDH Query Encryption', () => {
  it('should encrypt and decrypt a query via secp256k1 ECDH', async () => {
    const backendPriv = generatePrivateKey();
    const backendPub = getPublicKey(backendPriv);

    const query = 'private search query';
    const blob = await encryptQueryForBackend(query, backendPub);

    expect(blob.ciphertext).toBeTruthy();
    expect(blob.ephemeralPublicKey).toBeTruthy();
    expect(blob.nonce).toBeTruthy();

    const decrypted = await decryptQueryAtBackend(blob, backendPriv);
    expect(decrypted).toBe(query);
  });

  it('should fail with wrong private key', async () => {
    const backendPriv = generatePrivateKey();
    const backendPub = getPublicKey(backendPriv);
    const wrongPriv = generatePrivateKey();

    const blob = await encryptQueryForBackend('secret', backendPub);
    await expect(decryptQueryAtBackend(blob, wrongPriv)).rejects.toThrow();
  });
});

describe('Onion Layer Encryption', () => {
  it('should encrypt and decrypt onion layers', async () => {
    const relayPriv = generatePrivateKey();
    const relayPub = getPublicKey(relayPriv);

    const payload = JSON.stringify({ nextHop: 'http://relay2:4003/relay', isLastHop: false });
    const layer = await encryptOnionLayer(payload, relayPub);

    expect(layer.ciphertext).toBeTruthy();
    expect(layer.ephemeralPublicKey).toBeTruthy();
    expect(layer.nonce).toBeTruthy();

    const decrypted = await decryptOnionLayer(layer, relayPriv);
    expect(decrypted).toBe(payload);
  });

  it('should fail decryption with wrong relay key', async () => {
    const relay1Priv = generatePrivateKey();
    const relay1Pub = getPublicKey(relay1Priv);
    const relay2Priv = generatePrivateKey();

    const layer = await encryptOnionLayer('secret payload', relay1Pub);
    await expect(decryptOnionLayer(layer, relay2Priv)).rejects.toThrow();
  });

  it('should support 3-layer onion wrapping', async () => {
    const relay1Priv = generatePrivateKey();
    const relay2Priv = generatePrivateKey();
    const relay3Priv = generatePrivateKey();

    const relay1Pub = getPublicKey(relay1Priv);
    const relay2Pub = getPublicKey(relay2Priv);
    const relay3Pub = getPublicKey(relay3Priv);

    const innerPayload = 'final destination data';

    // Wrap 3 layers (inside-out)
    const layer3 = await encryptOnionLayer(innerPayload, relay3Pub);
    const layer2 = await encryptOnionLayer(JSON.stringify(layer3), relay2Pub);
    const layer1 = await encryptOnionLayer(JSON.stringify(layer2), relay1Pub);

    // Peel 3 layers (outside-in)
    const peeled1 = await decryptOnionLayer(layer1, relay1Priv);
    const peeled2 = await decryptOnionLayer(JSON.parse(peeled1), relay2Priv);
    const peeled3 = await decryptOnionLayer(JSON.parse(peeled2), relay3Priv);

    expect(peeled3).toBe(innerPayload);
  });
});

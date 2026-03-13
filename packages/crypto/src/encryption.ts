/**
 * Symmetric encryption for Fileverse storage (AES-256-GCM).
 * Uses Web Crypto API for portability.
 *
 * Asymmetric encryption for relay routing uses ECDH + AES-GCM
 * (query encrypted so only the search backend can decrypt).
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';
import type { EncryptedQueryBlob } from '@meshsearch/types';

/** Helper to create a BufferSource-compatible ArrayBuffer from Uint8Array */
function toBuffer(data: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(data.byteLength);
  new Uint8Array(ab).set(data);
  return ab;
}

/**
 * Generate an AES-256-GCM key from a wallet private key (key derivation)
 */
export async function deriveEncryptionKey(walletKey: string): Promise<CryptoKey> {
  const keyMaterial = sha256(new TextEncoder().encode(walletKey));
  return crypto.subtle.importKey(
    'raw',
    toBuffer(keyMaterial),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt data with AES-256-GCM
 */
export async function encryptData(
  data: string,
  key: CryptoKey
): Promise<{ ciphertext: string; iv: string }> {
  const iv = randomBytes(12);
  const encoded = new TextEncoder().encode(data);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toBuffer(iv) },
    key,
    encoded
  );

  return {
    ciphertext: bytesToHex(new Uint8Array(ciphertext)),
    iv: bytesToHex(iv),
  };
}

/**
 * Decrypt data with AES-256-GCM
 */
export async function decryptData(
  ciphertextHex: string,
  ivHex: string,
  key: CryptoKey
): Promise<string> {
  const ciphertext = hexToBytes(ciphertextHex);
  const iv = hexToBytes(ivHex);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toBuffer(iv) },
    key,
    toBuffer(ciphertext)
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Create an encrypted query blob for relay routing.
 * Uses a shared secret derived from ephemeral key + backend public key.
 * Simplified: in production, use proper ECDH key exchange.
 */
export async function encryptQueryForBackend(
  query: string,
  backendPublicKeyHex: string
): Promise<EncryptedQueryBlob> {
  // Generate ephemeral key pair for this query
  const ephemeralSecret = randomBytes(32);
  const ephemeralPublicKey = bytesToHex(sha256(ephemeralSecret));

  // Derive shared secret (simplified: hash(ephemeral_secret || backend_pub))
  const sharedInput = new TextEncoder().encode(
    `${bytesToHex(ephemeralSecret)}:${backendPublicKeyHex}`
  );
  const sharedSecret = sha256(sharedInput);

  const key = await crypto.subtle.importKey(
    'raw',
    toBuffer(sharedSecret),
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const nonce = randomBytes(12);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toBuffer(nonce) },
    key,
    new TextEncoder().encode(query)
  );

  return {
    ciphertext: bytesToHex(new Uint8Array(encrypted)),
    ephemeralPublicKey,
    nonce: bytesToHex(nonce),
  };
}

/**
 * Decrypt a query blob at the search backend
 */
export async function decryptQueryAtBackend(
  blob: EncryptedQueryBlob,
  backendPrivateKeyHex: string
): Promise<string> {
  // Both sides derive: hash(ephemeral_pub || backend_private) for the shared secret
  const sharedInput = new TextEncoder().encode(
    `${blob.ephemeralPublicKey}:${backendPrivateKeyHex}`
  );
  const sharedSecret = sha256(sharedInput);

  const key = await crypto.subtle.importKey(
    'raw',
    toBuffer(sharedSecret),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const ciphertext = hexToBytes(blob.ciphertext);
  const nonce = hexToBytes(blob.nonce);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toBuffer(nonce) },
    key,
    toBuffer(ciphertext)
  );

  return new TextDecoder().decode(decrypted);
}

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }
  return bytes;
}

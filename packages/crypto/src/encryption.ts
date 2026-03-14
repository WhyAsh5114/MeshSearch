/**
 * Encryption primitives for MeshSearch.
 *
 * Symmetric: AES-256-GCM via Web Crypto API (for Fileverse storage).
 * Asymmetric: secp256k1 ECDH + HKDF + AES-256-GCM (for relay/backend encryption).
 *
 * The backend and each relay node hold a secp256k1 private key.
 * The MCP server knows their public keys and performs real ECDH to derive
 * per-message shared secrets. This is genuine asymmetric encryption —
 * knowing the public key does NOT allow decryption.
 */

import { sha256 } from '@noble/hashes/sha256';
import { hkdf } from '@noble/hashes/hkdf';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';
// @ts-ignore — noble/curves v2 exports ./secp256k1.js
import { secp256k1 } from '@noble/curves/secp256k1.js';
import type { EncryptedQueryBlob, OnionLayer } from '@meshsearch/types';

/** Convert Uint8Array to ArrayBuffer for Web Crypto */
function toBuffer(data: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(data.byteLength);
  new Uint8Array(ab).set(data);
  return ab;
}

// ─── Key generation ──────────────────────────────────────────────────────────

/** Generate a secp256k1 private key (32 random bytes). */
export function generatePrivateKey(): string {
  return bytesToHex(randomBytes(32));
}

/** Derive the compressed public key (33 bytes hex) from a private key. */
export function getPublicKey(privateKeyHex: string): string {
  const privBytes = hexToBytes(privateKeyHex);
  return bytesToHex(secp256k1.getPublicKey(privBytes, true));
}

// ─── Symmetric AES-256-GCM (for Fileverse storage) ──────────────────────────

/**
 * Derive an AES-256-GCM key from a wallet key using HKDF.
 */
export async function deriveEncryptionKey(walletKey: string): Promise<CryptoKey> {
  const ikm = new TextEncoder().encode(walletKey);
  const salt = new TextEncoder().encode('meshsearch-fileverse-v1');
  const keyMaterial = hkdf(sha256, ikm, salt, new TextEncoder().encode('aes-gcm-key'), 32);
  return crypto.subtle.importKey(
    'raw',
    toBuffer(keyMaterial),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Encrypt data with AES-256-GCM. */
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

/** Decrypt data with AES-256-GCM. */
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

// ─── ECDH + AES-256-GCM (for query encryption to search backend) ────────────

/**
 * Derive an AES-256-GCM CryptoKey from a secp256k1 ECDH shared secret via HKDF.
 */
async function deriveAesKeyFromSharedSecret(
  sharedPoint: Uint8Array,
  info: string
): Promise<CryptoKey> {
  const salt = new TextEncoder().encode('meshsearch-ecdh-v1');
  const keyBytes = hkdf(sha256, sharedPoint, salt, new TextEncoder().encode(info), 32);
  return crypto.subtle.importKey(
    'raw',
    toBuffer(keyBytes),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a query for the search backend using real secp256k1 ECDH.
 *
 * 1. Generate an ephemeral secp256k1 key pair.
 * 2. ECDH: sharedPoint = ephemeralPrivate × backendPublicKey.
 * 3. HKDF the shared point into an AES-256-GCM key.
 * 4. Encrypt the query with AES-256-GCM.
 * 5. Return { ciphertext, ephemeralPublicKey, nonce }.
 *
 * Only the holder of backendPrivateKey can reverse step 2.
 */
export async function encryptQueryForBackend(
  query: string,
  backendPublicKeyHex: string
): Promise<EncryptedQueryBlob> {
  const ephemeralPriv = randomBytes(32);
  const ephemeralPub = secp256k1.getPublicKey(ephemeralPriv, true); // compressed

  const backendPubBytes = hexToBytes(backendPublicKeyHex);
  const sharedPoint = secp256k1.getSharedSecret(ephemeralPriv, backendPubBytes);

  const key = await deriveAesKeyFromSharedSecret(sharedPoint, 'query-encryption');
  const nonce = randomBytes(12);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toBuffer(nonce) },
    key,
    new TextEncoder().encode(query)
  );

  return {
    ciphertext: bytesToHex(new Uint8Array(encrypted)),
    ephemeralPublicKey: bytesToHex(ephemeralPub),
    nonce: bytesToHex(nonce),
  };
}

/**
 * Decrypt a query blob at the search backend using real secp256k1 ECDH.
 *
 * 1. ECDH: sharedPoint = backendPrivateKey × ephemeralPublicKey.
 * 2. HKDF the shared point into an AES-256-GCM key.
 * 3. Decrypt the ciphertext.
 */
export async function decryptQueryAtBackend(
  blob: EncryptedQueryBlob,
  backendPrivateKeyHex: string
): Promise<string> {
  const backendPrivBytes = hexToBytes(backendPrivateKeyHex);
  const ephPubBytes = hexToBytes(blob.ephemeralPublicKey);

  const sharedPoint = secp256k1.getSharedSecret(backendPrivBytes, ephPubBytes);

  const key = await deriveAesKeyFromSharedSecret(sharedPoint, 'query-encryption');
  const ciphertext = hexToBytes(blob.ciphertext);
  const nonce = hexToBytes(blob.nonce);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toBuffer(nonce) },
    key,
    toBuffer(ciphertext)
  );
  return new TextDecoder().decode(decrypted);
}

// ─── Onion layer encryption/decryption (for relay routing) ───────────────────

/**
 * Encrypt a payload as one onion layer for a specific relay's public key.
 * Uses the same ECDH + HKDF + AES-GCM scheme.
 */
export async function encryptOnionLayer(
  payload: string,
  recipientPublicKeyHex: string
): Promise<OnionLayer> {
  const ephemeralPriv = randomBytes(32);
  const ephemeralPub = secp256k1.getPublicKey(ephemeralPriv, true);

  const recipientPubBytes = hexToBytes(recipientPublicKeyHex);
  const sharedPoint = secp256k1.getSharedSecret(ephemeralPriv, recipientPubBytes);

  const key = await deriveAesKeyFromSharedSecret(sharedPoint, 'onion-layer');
  const nonce = randomBytes(12);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toBuffer(nonce) },
    key,
    new TextEncoder().encode(payload)
  );

  return {
    ciphertext: bytesToHex(new Uint8Array(encrypted)),
    ephemeralPublicKey: bytesToHex(ephemeralPub),
    nonce: bytesToHex(nonce),
  };
}

/**
 * Decrypt an onion layer using the relay's private key.
 * Returns the inner payload (which is the next onion layer or search request).
 */
export async function decryptOnionLayer(
  layer: OnionLayer,
  recipientPrivateKeyHex: string
): Promise<string> {
  const privBytes = hexToBytes(recipientPrivateKeyHex);
  const ephPubBytes = hexToBytes(layer.ephemeralPublicKey);

  const sharedPoint = secp256k1.getSharedSecret(privBytes, ephPubBytes);

  const key = await deriveAesKeyFromSharedSecret(sharedPoint, 'onion-layer');
  const ciphertext = hexToBytes(layer.ciphertext);
  const nonce = hexToBytes(layer.nonce);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toBuffer(nonce) },
    key,
    toBuffer(ciphertext)
  );
  return new TextDecoder().decode(decrypted);
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }
  return bytes;
}

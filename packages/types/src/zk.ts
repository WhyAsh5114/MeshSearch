/**
 * ZK proof and commitment types used across the system.
 * Aligned with Semaphore v4 protocol and secp256k1 ECDH.
 */

/** A hex-encoded string (0x prefixed) */
export type HexString = `0x${string}`;

/** Query commitment using SHA-256 hiding commitment */
export interface QueryCommitment {
  /** SHA-256(query || salt) — hides the query */
  commitment: HexString;
  /** Random 32-byte salt */
  salt: HexString;
  /** The raw query plaintext (NEVER sent to the server) */
  query: string;
}

/**
 * Semaphore v4 proof output — direct from @semaphore-protocol/core generateProof().
 * All numeric fields are NumericString (decimal string representation of bigints).
 */
export interface SemaphoreProof {
  merkleTreeDepth: number;
  merkleTreeRoot: string;
  nullifier: string;
  message: string;
  scope: string;
  points: [string, string, string, string, string, string, string, string];
}

/** Encrypted query blob for relay routing (real secp256k1 ECDH) */
export interface EncryptedQueryBlob {
  /** AES-256-GCM ciphertext (hex) */
  ciphertext: string;
  /** Compressed secp256k1 ephemeral public key (hex, 33 bytes) */
  ephemeralPublicKey: string;
  /** AES-GCM nonce/IV (hex, 12 bytes) */
  nonce: string;
}

/**
 * An onion-encrypted relay layer.
 * The MCP server wraps the query in 3 layers; each relay peels one.
 */
export interface OnionLayer {
  /** AES-256-GCM ciphertext of the inner payload (hex) */
  ciphertext: string;
  /** Compressed secp256k1 ephemeral public key for ECDH (hex) */
  ephemeralPublicKey: string;
  /** AES-GCM nonce (hex) */
  nonce: string;
}

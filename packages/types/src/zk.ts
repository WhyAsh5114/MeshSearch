/**
 * ZK proof and commitment types used across the system
 */

/** A hex-encoded string (0x prefixed) */
export type HexString = `0x${string}`;

/** Poseidon hash commitment of a query + salt */
export interface QueryCommitment {
  /** The Poseidon hash of (query, salt) */
  commitment: HexString;
  /** Random salt used in the commitment */
  salt: HexString;
  /** The raw query plaintext (only kept client-side) */
  query: string;
}

/** Semaphore nullifier for payment unlinking */
export interface Nullifier {
  /** The nullifier hash */
  nullifierHash: HexString;
  /** Semaphore identity commitment */
  identityCommitment: HexString;
}

/** ZK authorization proof */
export interface ZKProof {
  /** Commitment to the query */
  commitment: HexString;
  /** Nullifier hash */
  nullifierHash: HexString;
  /** Proof data (packed) */
  proof: HexString;
  /** Merkle tree root (group membership) */
  merkleTreeRoot: HexString;
  /** External nullifier (search context) */
  externalNullifier: HexString;
}

/** Encrypted query blob for relay routing */
export interface EncryptedQueryBlob {
  /** Asymmetrically encrypted query (only search backend can decrypt) */
  ciphertext: string;
  /** Ephemeral public key used for encryption */
  ephemeralPublicKey: string;
  /** Nonce/IV */
  nonce: string;
}

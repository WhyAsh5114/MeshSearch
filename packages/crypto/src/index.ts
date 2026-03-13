export {
  generateSalt,
  createQueryCommitment,
  verifyQueryCommitment,
  hashResults,
  generateNullifier,
} from './commitment.js';

export {
  deriveEncryptionKey,
  encryptData,
  decryptData,
  encryptQueryForBackend,
  decryptQueryAtBackend,
} from './encryption.js';

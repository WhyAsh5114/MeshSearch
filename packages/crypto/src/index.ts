export {
  generateSalt,
  createQueryCommitment,
  verifyQueryCommitment,
  hashResults,
} from './commitment.js';

export {
  generatePrivateKey,
  getPublicKey,
  deriveEncryptionKey,
  encryptData,
  decryptData,
  encryptQueryForBackend,
  decryptQueryAtBackend,
  encryptOnionLayer,
  decryptOnionLayer,
} from './encryption.js';

export {
  Identity,
  Group,
  createIdentity,
  createGroup,
  generateSearchProof,
  verifySearchProof,
} from './semaphore.js';

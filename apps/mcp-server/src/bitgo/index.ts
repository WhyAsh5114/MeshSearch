/**
 * BitGo integration — privacy-preserving wallet infrastructure.
 *
 * Provides stealth-address payments, webhook-confirmed settlements,
 * and policy-enforced governance built on BitGo's wallet SDK.
 */

export { isBitGoEnabled, loadBitGoConfig, generateFreshAddress, sendTransaction, getWalletBalance, getWallet } from './client.js';
export type { BitGoConfig } from './client.js';
export { disburseToRelays, loadDisbursementConfig } from './stealth-disbursement.js';
export type { DisbursementConfig, DisbursementResult, RelayWalletConfig } from './stealth-disbursement.js';
export { handleBitGoWebhook, onBitGoWebhook, waitForPayment } from './webhooks.js';
export type { WebhookEvent, BitGoWebhookPayload } from './webhooks.js';
export { setupTreasuryPolicies, listTreasuryPolicies } from './policies.js';

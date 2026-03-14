/**
 * BitGo SDK client wrapper — manages wallet lifecycle for privacy-preserving payments.
 *
 * Provides:
 * - Wallet initialization and caching
 * - Fresh address generation per transaction (stealth-address pattern)
 * - Transaction building, signing, and sending
 * - Wallet balance queries
 *
 * Uses BitGo's testnet environment by default (app.bitgo-test.com).
 * Supports self-custody MPC hot wallets via BitGo Express for key management.
 *
 * Env vars:
 *   BITGO_ACCESS_TOKEN  — long-lived API token from app.bitgo-test.com
 *   BITGO_ENV           — 'test' (default) or 'prod'
 *   BITGO_WALLET_ID     — treasury wallet ID for receiving search payments
 *   BITGO_WALLET_PASSPHRASE — wallet passphrase for signing transactions
 *   BITGO_COIN           — coin identifier (default: 'hteth' = Hoodi Testnet ETH)
 *   BITGO_EXPRESS_URL    — BitGo Express URL if running locally (optional)
 */

import { BitGoAPI } from '@bitgo/sdk-api';
import { Hteth } from '@bitgo/sdk-coin-eth';
import type { Wallet } from 'bitgo';

// ─── Configuration ──────────────────────────────────────────────────────────

export interface BitGoConfig {
  accessToken: string;
  env: 'test' | 'prod';
  walletId: string;
  walletPassphrase: string;
  coin: string;
  expressUrl?: string;
}

export function loadBitGoConfig(): BitGoConfig {
  return {
    accessToken: process.env.BITGO_ACCESS_TOKEN ?? '',
    env: (process.env.BITGO_ENV as 'test' | 'prod') ?? 'test',
    walletId: process.env.BITGO_WALLET_ID ?? '',
    walletPassphrase: process.env.BITGO_WALLET_PASSPHRASE ?? '',
    coin: process.env.BITGO_COIN ?? 'hteth',
    expressUrl: process.env.BITGO_EXPRESS_URL,
  };
}

export function isBitGoEnabled(): boolean {
  return !!(process.env.BITGO_ACCESS_TOKEN && process.env.BITGO_WALLET_ID);
}

// ─── Singleton client ───────────────────────────────────────────────────────

let _sdk: BitGoAPI | null = null;
let _signingSDK: BitGoAPI | null = null;
const _wallets = new Map<string, Wallet>();

/**
 * API SDK — connects directly to app.bitgo-test.com (or prod).
 * Used for read operations and address creation; no Express required.
 */
function getSDK(config: BitGoConfig): BitGoAPI {
  if (_sdk) return _sdk;

  _sdk = new BitGoAPI({
    accessToken: config.accessToken,
    env: config.env,
  });
  _sdk.register('hteth', Hteth.createInstance);

  console.error(`[bitgo] SDK initialized — env=${config.env} coin=${config.coin} (direct API)`);
  return _sdk;
}

/**
 * Signing SDK — routes through BitGo Express for TSS wallet signing.
 * Returns null if Express URL is not configured.
 * Only needed for sendMany; address creation uses getSDK() directly.
 */
function getSigningSDK(config: BitGoConfig): BitGoAPI | null {
  if (!config.expressUrl) return null;
  if (_signingSDK) return _signingSDK;

  _signingSDK = new BitGoAPI({
    accessToken: config.accessToken,
    env: config.env,
    customRootURI: config.expressUrl,
  });
  _signingSDK.register('hteth', Hteth.createInstance);

  console.error(`[bitgo] Signing SDK initialized — Express at ${config.expressUrl}`);
  return _signingSDK;
}

/**
 * Get (or lazily fetch) a BitGo wallet by its ID.
 * Caches per walletId so treasury and relay wallets don't collide.
 */
export async function getWallet(config: BitGoConfig): Promise<Wallet> {
  const cached = _wallets.get(config.walletId);
  if (cached) return cached;

  const sdk = getSDK(config);
  const coin = sdk.coin(config.coin);
  const wallet = (await coin.wallets().get({ id: config.walletId })) as Wallet;
  _wallets.set(config.walletId, wallet);

  console.error(`[bitgo] Wallet loaded: ${wallet.label()} (${config.walletId.slice(0, 8)}…)`);
  return wallet;
}

/**
 * Generate a fresh, unlinkable receive address on the treasury wallet.
 *
 * Each search payment goes to a unique address — an observer watching the
 * blockchain cannot link two payments to the same service. This is the
 * stealth-address pattern BitGo's prize track describes.
 *
 * @param label Optional human-readable label for auditing (never onchain)
 */
export async function generateFreshAddress(
  config: BitGoConfig,
  label?: string,
): Promise<{ address: string; id: string }> {
  const wallet = await getWallet(config);

  const addr = await wallet.createAddress({
    label: label ?? `meshsearch-${Date.now()}`,
  });

  console.error(`[bitgo] Fresh address: ${addr.address} (label: ${addr.label ?? 'none'})`);
  return { address: addr.address, id: addr.id };
}

/**
 * Send funds from the treasury wallet to one or more recipients.
 *
 * Used for relay operator disbursement: after a search payment is confirmed,
 * the server splits the payment and sends shares to relay operators'
 * fresh BitGo addresses.
 *
 * @param recipients Array of { address, amount } where amount is in base units (wei)
 * @returns Transaction ID and status
 */
export async function sendTransaction(
  config: BitGoConfig,
  recipients: Array<{ address: string; amount: string }>,
): Promise<{ txid: string; status: string }> {
  // For BitGo custodial wallets created via the dashboard, the passphrase
  // decrypts the user key server-side — no local Express signing required.
  const wallet = await getWallet(config);
  const balance = wallet.spendableBalanceString() ?? '0';
  const totalNeeded = recipients.reduce((sum, r) => sum + BigInt(r.amount), 0n);

  if (BigInt(balance) === 0n) {
    throw new Error(
      `[bitgo] Treasury wallet has 0 spendable balance on ${config.coin}. ` +
      `Fund it via the BitGo dashboard or a Hoodi faucet before disbursing.`,
    );
  }
  if (BigInt(balance) < totalNeeded) {
    throw new Error(
      `[bitgo] Insufficient balance: have ${balance} wei, need ${totalNeeded.toString()} wei`,
    );
  }

  const result = await wallet.sendMany({
    recipients,
    walletPassphrase: config.walletPassphrase,
    type: 'transfer',
  });

  const txid = result.txid ?? result.hash ?? 'unknown';
  const status = result.status ?? 'signed';

  console.error(`[bitgo] Transaction sent: txid=${txid} status=${status} recipients=${recipients.length}`);
  return { txid, status };
}

/**
 * Get the wallet balance.
 */
export async function getWalletBalance(config: BitGoConfig): Promise<{
  balance: string;
  confirmedBalance: string;
  spendableBalance: string;
}> {
  const wallet = await getWallet(config);

  return {
    balance: wallet.balanceString() ?? '0',
    confirmedBalance: wallet.confirmedBalanceString() ?? '0',
    spendableBalance: wallet.spendableBalanceString() ?? '0',
  };
}

/**
 * Reset cached instances (for testing).
 */
export function _resetBitGoClient(): void {
  _sdk = null;
  _signingSDK = null;
  _wallets.clear();
}

/**
 * Live connectivity check — actually talks to BitGo API.
 * Returns a structured status for the health endpoint.
 */
export async function probeBitGoHealth(config: BitGoConfig): Promise<{
  api: boolean;
  walletLabel: string | null;
  balance: string | null;
  expressReachable: boolean | null;
  error: string | null;
}> {
  let api = false;
  let walletLabel: string | null = null;
  let balance: string | null = null;
  let expressReachable: boolean | null = null;
  let error: string | null = null;

  try {
    const wallet = await getWallet(config);
    api = true;
    walletLabel = wallet.label() ?? null;
    balance = wallet.spendableBalanceString() ?? '0';
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (config.expressUrl) {
    try {
      const res = await fetch(`${config.expressUrl}/api/v2/ping`);
      expressReachable = res.ok;
    } catch {
      expressReachable = false;
    }
  }

  return { api, walletLabel, balance, expressReachable, error };
}

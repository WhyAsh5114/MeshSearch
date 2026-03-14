/**
 * BitGo webhook handler — receives payment confirmations from BitGo.
 *
 * Instead of polling or trusting the x402 facilitator alone, BitGo webhooks
 * provide cryptographically verifiable payment confirmation:
 *
 * - Incoming payment to a one-time receive address (search payment confirmed)
 * - Outgoing relay disbursement completed
 * - Policy-triggered events (spending limit hit, approval required)
 *
 * Webhook setup:
 *   Register via BitGo API: POST /api/v2/{coin}/wallet/{walletId}/webhooks
 *   Type: 'transfer' for incoming/outgoing payment notifications
 *
 * Env vars:
 *   BITGO_WEBHOOK_SECRET — shared secret for validating webhook signatures (optional)
 *   BITGO_WEBHOOK_URL    — public URL where BitGo sends notifications
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BitGoWebhookPayload {
  /** Webhook type (e.g., 'transfer') */
  type: string;
  /** The wallet ID this event is for */
  walletId: string;
  /** The transfer hash (transaction ID) */
  hash?: string;
  /** Transfer state: 'confirmed', 'signed', 'pendingApproval' */
  state?: string;
  /** Coin identifier */
  coin?: string;
  /** Transfer details */
  transfer?: {
    id: string;
    txid: string;
    value: number;
    valueString: string;
    state: string;
    confirmedTime?: string;
    entries: Array<{
      address: string;
      value: number;
      valueString: string;
    }>;
  };
}

export interface WebhookEvent {
  type: 'payment_received' | 'disbursement_confirmed' | 'policy_triggered' | 'unknown';
  walletId: string;
  txid: string;
  amount: string;
  state: string;
  timestamp: number;
  raw: BitGoWebhookPayload;
}

// ─── Event listeners ────────────────────────────────────────────────────────

type WebhookListener = (event: WebhookEvent) => void | Promise<void>;
const listeners: WebhookListener[] = [];

/**
 * Register a listener for BitGo webhook events.
 * Used by the payment settlement layer to trigger search execution
 * only after BitGo confirms receipt.
 */
export function onBitGoWebhook(listener: WebhookListener): void {
  listeners.push(listener);
}

async function notifyListeners(event: WebhookEvent): Promise<void> {
  for (const listener of listeners) {
    try {
      await listener(event);
    } catch (err) {
      console.error('[bitgo-webhook] Listener error:', err instanceof Error ? err.message : err);
    }
  }
}

// ─── Signature validation ───────────────────────────────────────────────────

const WEBHOOK_SECRET = process.env.BITGO_WEBHOOK_SECRET ?? '';

/**
 * Validate the webhook signature from BitGo.
 * BitGo signs webhook payloads with the shared secret using HMAC-SHA256.
 */
function validateSignature(body: string, signature: string | undefined): boolean {
  if (!WEBHOOK_SECRET) {
    // No secret configured — accept all webhooks (dev mode)
    return true;
  }
  if (!signature) return false;

  const expected = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

// ─── Classify webhook events ────────────────────────────────────────────────

const treasuryWalletId = process.env.BITGO_WALLET_ID ?? '';

function classifyEvent(payload: BitGoWebhookPayload): WebhookEvent['type'] {
  if (payload.type !== 'transfer') return 'unknown';

  // If the transfer is TO our treasury wallet, it's an incoming payment
  if (payload.walletId === treasuryWalletId) {
    const value = payload.transfer?.value ?? 0;
    if (value > 0) return 'payment_received';
    if (value < 0) return 'disbursement_confirmed';
  }

  return 'unknown';
}

// ─── HTTP handler ───────────────────────────────────────────────────────────

/**
 * Handle incoming BitGo webhook HTTP request.
 * Mount this at POST /webhooks/bitgo in the MCP server.
 */
export async function handleBitGoWebhook(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // Read body
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const bodyStr = Buffer.concat(chunks).toString();

  // Validate signature
  const signature = req.headers['x-bitgo-signature'] as string | undefined;
  if (!validateSignature(bodyStr, signature)) {
    console.error('[bitgo-webhook] Invalid signature — rejecting');
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid signature' }));
    return;
  }

  // Parse payload
  let payload: BitGoWebhookPayload;
  try {
    payload = JSON.parse(bodyStr) as BitGoWebhookPayload;
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  // Build event
  const eventType = classifyEvent(payload);
  const event: WebhookEvent = {
    type: eventType,
    walletId: payload.walletId,
    txid: payload.transfer?.txid ?? payload.hash ?? '',
    amount: payload.transfer?.valueString ?? '0',
    state: payload.transfer?.state ?? payload.state ?? 'unknown',
    timestamp: Date.now(),
    raw: payload,
  };

  console.error(
    `[bitgo-webhook] Event: type=${event.type} wallet=${event.walletId.slice(0, 8)}… ` +
    `txid=${event.txid.slice(0, 12)}… amount=${event.amount} state=${event.state}`,
  );

  // Notify listeners
  await notifyListeners(event);

  // Acknowledge
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ received: true, type: event.type }));
}

// ─── Pending payment tracking ───────────────────────────────────────────────

/**
 * In-memory map of pending payments awaiting BitGo confirmation.
 * Key: receive address, Value: resolve function for the waiting promise.
 *
 * When a search payment is initiated, the server generates a fresh address
 * and stores a pending entry here. The webhook listener resolves it
 * when BitGo confirms the deposit.
 */
const pendingPayments = new Map<string, {
  resolve: (txid: string) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

/**
 * Wait for a payment to be confirmed at a specific address.
 * Returns the transaction ID once BitGo fires the webhook.
 *
 * @param address The one-time receive address to watch
 * @param timeoutMs Maximum time to wait (default: 120s)
 */
export function waitForPayment(address: string, timeoutMs = 120_000): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingPayments.delete(address);
      reject(new Error(`Payment timeout: no confirmation at ${address} within ${timeoutMs}ms`));
    }, timeoutMs);

    pendingPayments.set(address, { resolve, timeout });
  });
}

// Register the internal listener that resolves pending payments
onBitGoWebhook((event) => {
  if (event.type !== 'payment_received') return;
  if (!event.raw.transfer?.entries) return;

  for (const entry of event.raw.transfer.entries) {
    const pending = pendingPayments.get(entry.address);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingPayments.delete(entry.address);
      pending.resolve(event.txid);
      console.error(`[bitgo-webhook] Payment confirmed at ${entry.address}: txid=${event.txid}`);
    }
  }
});

/**
 * x402 Payment Flow E2E Test
 *
 * Tests the full x402 payment gate on the MCP server:
 *   1. Initialize MCP session
 *   2. Call private_search WITHOUT payment → expect HTTP 402
 *   3. Parse PaymentRequired from 402 response
 *   4. Create payment payload (signs USDC ERC-20 approval via viem)
 *   5. Re-send with X-PAYMENT header → expect HTTP 200 + search results
 *
 * Prerequisites:
 *   - MCP server running with X402_ENABLED=true
 *   - TEST_WALLET_KEY env var = private key with Base Sepolia USDC
 *   - Base Sepolia ETH for gas (faucet: https://www.alchemy.com/faucets/base-sepolia)
 *   - Base Sepolia USDC (faucet: https://faucet.circle.com)
 *
 * Usage:
 *   TEST_WALLET_KEY=0x... node test-x402.mjs
 *   TEST_WALLET_KEY=0x... MCP_URL=http://localhost:3038 node test-x402.mjs
 */

import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, sepolia } from 'viem/chains';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { toClientEvmSigner } from '@x402/evm';
import { decodePaymentRequiredHeader } from '@x402/core/http';

// ─── Config ─────────────────────────────────────────────────────────────────

const BASE = process.env.MCP_URL || 'http://localhost:3038';
const WALLET_KEY = process.env.TEST_WALLET_KEY;
const CHAIN = process.env.X402_NETWORK === 'eip155:11155111' ? 'sepolia' : 'base-sepolia';

if (!WALLET_KEY) {
  console.error('❌ Set TEST_WALLET_KEY=0x<your-private-key> to run this test');
  console.error('   This wallet needs Base Sepolia ETH + USDC.');
  console.error('   ETH faucet: https://www.alchemy.com/faucets/base-sepolia');
  console.error('   USDC faucet: https://faucet.circle.com');
  process.exit(1);
}

const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseSSE(text) {
  const messages = [];
  for (const block of text.split('\n\n')) {
    for (const line of block.split('\n')) {
      if (line.startsWith('data: ')) {
        try { messages.push(JSON.parse(line.slice(6))); } catch {}
      }
    }
  }
  return messages;
}

async function parseResponse(res) {
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  if (ct.includes('text/event-stream')) return parseSSE(text);
  try { return [JSON.parse(text)]; } catch { return [{ _raw: text }]; }
}

function step(n, title) {
  console.log(`\n${c.bold(c.cyan(`── Step ${n}: ${title} ──`))}`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(c.bold(`\nx402 Payment Flow Test — ${BASE}\n`));

  // Set up viem wallet — use toClientEvmSigner to bridge viem -> x402 signer interface
  const chain = CHAIN === 'sepolia' ? sepolia : baseSepolia;
  const account = privateKeyToAccount(WALLET_KEY);
  const publicClient = createPublicClient({ chain, transport: http() });
  const signer = toClientEvmSigner(account, publicClient);

  console.log(`Wallet: ${c.cyan(account.address)}`);
  console.log(`Chain:  ${c.cyan(chain.name)} (${chain.id})`);

  // Check ETH balance
  const ethBal = await publicClient.getBalance({ address: account.address });
  console.log(`ETH:    ${c.cyan((Number(ethBal) / 1e18).toFixed(6))}`);
  if (ethBal === 0n) {
    console.error(c.red('⚠ No ETH — get testnet ETH from https://www.alchemy.com/faucets/base-sepolia'));
  }

  // ── Step 1: Initialize MCP session ──────────────────────────────────────
  step(1, 'Initialize MCP session');

  const initRes = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x402-test', version: '0.1.0' } }
    })
  });

  const sid = initRes.headers.get('mcp-session-id');
  if (!sid) {
    console.error(c.red('Failed to get session ID'));
    const text = await initRes.text();
    console.error('Response:', initRes.status, text);
    process.exit(1);
  }
  console.log(`Session: ${c.green(sid)}`);

  // Send initialized notification
  await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-session-id': sid,
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
  });
  console.log(c.dim('Sent notifications/initialized'));

  // ── Step 2: Call private_search WITHOUT payment → expect 402 ────────────
  step(2, 'Call private_search WITHOUT payment (expect 402)');

  const searchBody = JSON.stringify({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'private_search', arguments: { query: 'ethereum zero knowledge proofs' } }
  });

  const noPayRes = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-session-id': sid,
    },
    body: searchBody,
  });

  console.log(`Status: ${noPayRes.status}`);

  if (noPayRes.status !== 402) {
    console.log(c.yellow(`Expected 402 but got ${noPayRes.status}`));
    if (noPayRes.status === 200) {
      console.log(c.yellow('x402 might be disabled on the server. Set X402_ENABLED=true in .env'));
      const msgs = await parseResponse(noPayRes);
      console.log('Response:', JSON.stringify(msgs[0]?.result || msgs[0], null, 2).slice(0, 500));
    }
    process.exit(1);
  }

  console.log(c.green('✓ Got 402 Payment Required'));

  // ── Step 3: Parse PaymentRequired ───────────────────────────────────────
  step(3, 'Parse PaymentRequired from 402 response');

  // x402 v2 uses "PAYMENT-REQUIRED" header (lowercase in fetch: "payment-required")
  const payReqHeader = noPayRes.headers.get('payment-required');
  if (!payReqHeader) {
    const body = await noPayRes.json().catch(() => null);
    console.error(c.red('No PAYMENT-REQUIRED header found'));
    console.error('Response headers:', Object.fromEntries(noPayRes.headers.entries()));
    if (body) console.error('Body:', JSON.stringify(body, null, 2).slice(0, 1000));
    process.exit(1);
  }

  const paymentRequired = decodePaymentRequiredHeader(payReqHeader);
  console.log(`Version:  ${c.cyan(String(paymentRequired.x402Version))}`);
  console.log(`Resource: ${c.cyan(paymentRequired.resource || 'N/A')}`);
  if (paymentRequired.paymentRequirements) {
    for (const req of paymentRequired.paymentRequirements) {
      console.log(`  Scheme:  ${c.cyan(req.scheme)}`);
      console.log(`  Network: ${c.cyan(req.network)}`);
      console.log(`  PayTo:   ${c.cyan(req.payTo)}`);
      console.log(`  Amount:  ${c.cyan(req.maxAmountRequired)} (token: ${c.dim(req.asset || 'USDC')})`);
    }
  }

  // ── Step 4: Create payment payload (sign USDC approval) ─────────────────
  step(4, 'Create payment payload');

  const coreClient = new x402Client();
  registerExactEvmScheme(coreClient, { signer });

  const httpClient = new x402HTTPClient(coreClient);
  let paymentPayload;
  try {
    paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
    console.log(c.green('✓ Payment payload created'));
    console.log(c.dim(`  Payload scheme: ${paymentPayload.scheme || 'exact'}`));
  } catch (err) {
    console.error(c.red('✗ Failed to create payment payload:'), err.message);
    if (err.message.includes('insufficient') || err.message.includes('allowance')) {
      console.error(c.yellow('  → You may need to get USDC from https://faucet.circle.com'));
    }
    process.exit(1);
  }

  // ── Step 5: Re-send with X-PAYMENT header → expect 200 ─────────────────
  step(5, 'Re-send with payment (expect 200)');

  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
  // x402 v2 sends PAYMENT-SIGNATURE header (v1 used X-PAYMENT)
  const headerLen = paymentHeaders['PAYMENT-SIGNATURE']?.length || paymentHeaders['X-PAYMENT']?.length || 0;
  console.log(c.dim(`  Payment header length: ${headerLen} chars`));

  const paidRes = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-session-id': sid,
      ...paymentHeaders,
    },
    body: searchBody,
  });

  console.log(`Status: ${paidRes.status}`);

  if (paidRes.status === 200) {
    console.log(c.green('✓ Payment accepted — search succeeded!'));

    // x402 v2: PAYMENT-RESPONSE header
    const settleHeader = paidRes.headers.get('payment-response');
    if (settleHeader) {
      console.log(c.green('✓ Settlement response present'));
    }

    const msgs = await parseResponse(paidRes);
    const result = msgs.find(m => m.result)?.result || msgs[0];
    if (result?.content?.[0]?.text) {
      const preview = result.content[0].text.slice(0, 300);
      console.log(`\n${c.bold('Search results preview:')}\n${c.dim(preview)}...`);
    }
  } else if (paidRes.status === 402) {
    console.error(c.red('✗ Still 402 — payment was not accepted'));
    const body = await paidRes.text();
    console.error(c.dim(body.slice(0, 500)));
  } else {
    console.error(c.red(`✗ Unexpected status: ${paidRes.status}`));
    const body = await paidRes.text();
    console.error(c.dim(body.slice(0, 500)));
  }

  // ── Cleanup ────────────────────────────────────────────────────────────
  step(6, 'Cleanup — close session');
  await fetch(`${BASE}/mcp`, {
    method: 'DELETE',
    headers: { 'mcp-session-id': sid },
  });
  console.log(c.dim('Session closed'));

  console.log(c.bold(c.green('\n✓ x402 payment flow test complete\n')));
}

main().catch(err => {
  console.error(c.red('\n✗ Test failed:'), err);
  process.exit(1);
});

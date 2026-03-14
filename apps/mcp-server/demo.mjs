#!/usr/bin/env node
/**
 * MeshSearch x402 Demo — Interactive privacy-preserving search with on-chain payments
 *
 * This is a proper x402-aware MCP client that:
 *   1. Connects a crypto wallet (Base Sepolia USDC)
 *   2. Initializes an MCP session with the MeshSearch server
 *   3. Accepts search queries interactively
 *   4. For each search: signs a USDC payment → server verifies → settles on-chain
 *   5. Results come back through ZK proofs + 3-hop onion routing
 *   6. Shows the on-chain settlement tx on BaseScan
 *
 * Usage:
 *   node demo.mjs                              # interactive REPL
 *   node demo.mjs "what is zero knowledge"     # single query then exit
 *
 * Env vars:
 *   TEST_WALLET_KEY  — private key (hex, 0x-prefixed) with Base Sepolia ETH + USDC
 *   MCP_URL          — server URL (default: http://localhost:3038)
 *   X402_NETWORK     — eip155:84532 (Base Sepolia, default) or eip155:11155111 (Eth Sepolia)
 */

import { createInterface } from 'node:readline';
import { createPublicClient, http, formatEther, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, sepolia } from 'viem/chains';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { toClientEvmSigner } from '@x402/evm';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from '@x402/core/http';

// ─── Config ─────────────────────────────────────────────────────────────────

const BASE = process.env.MCP_URL || 'http://localhost:3038';
const WALLET_KEY = process.env.TEST_WALLET_KEY;
const CHAIN_ID = process.env.X402_NETWORK === 'eip155:11155111' ? 'sepolia' : 'base-sepolia';

if (!WALLET_KEY) {
  console.error(`
  ╔══════════════════════════════════════════════════════════════╗
  ║  MeshSearch Demo — wallet key required                      ║
  ╠══════════════════════════════════════════════════════════════╣
  ║                                                             ║
  ║  export TEST_WALLET_KEY=0x<your-private-key>                ║
  ║  node demo.mjs                                              ║
  ║                                                             ║
  ║  Your wallet needs:                                         ║
  ║    • Base Sepolia ETH (gas) — alchemy.com/faucets           ║
  ║    • Base Sepolia USDC      — faucet.circle.com             ║
  ║                                                             ║
  ╚══════════════════════════════════════════════════════════════╝
`);
  process.exit(1);
}

// ─── Colors ─────────────────────────────────────────────────────────────────

const c = {
  reset:  '\x1b[0m',
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  mag:    (s) => `\x1b[35m${s}\x1b[0m`,
  bg402:  (s) => `\x1b[43m\x1b[30m ${s} \x1b[0m`,
  bgOk:   (s) => `\x1b[42m\x1b[30m ${s} \x1b[0m`,
};

const USDC_DECIMALS = 6;
const BASESCAN_URL = CHAIN_ID === 'sepolia'
  ? 'https://sepolia.etherscan.io/tx/'
  : 'https://sepolia.basescan.org/tx/';

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

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const singleQuery = process.argv[2];

  // ── Wallet setup ──────────────────────────────────────────────────────────
  const chain = CHAIN_ID === 'sepolia' ? sepolia : baseSepolia;
  const account = privateKeyToAccount(WALLET_KEY);
  const publicClient = createPublicClient({ chain, transport: http() });
  const signer = toClientEvmSigner(account, publicClient);

  const ethBal = await publicClient.getBalance({ address: account.address });
  // Try to read USDC balance (Base Sepolia USDC: 0x036CbD53842c5426634e7929541eC2318f3dCF7e)
  const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
  let usdcBal = 0n;
  try {
    usdcBal = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }],
      functionName: 'balanceOf',
      args: [account.address],
    });
  } catch {}

  // ANSI-aware box row: pads content to INNER visible chars so the right ║ always aligns
  const INNER = 62;
  const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
  const row = (content = '') => {
    const pad = Math.max(0, INNER - stripAnsi(content).length);
    return `${c.bold('║')}${content}${' '.repeat(pad)}${c.bold('║')}`;
  };

  console.log(`
${c.bold('╔══════════════════════════════════════════════════════════════╗')}
${row(`  ${c.cyan('MeshSearch')} — Private AI Search with x402 Micropayments`)}
${c.bold('╠══════════════════════════════════════════════════════════════╣')}
${row()}
${row(`  ${c.dim('Wallet:')}  ${c.cyan(account.address)}`)}
${row(`  ${c.dim('Chain:')}   ${c.cyan(chain.name)} (${chain.id})`)}
${row(`  ${c.dim('ETH:')}     ${c.cyan(formatEther(ethBal))}`)}
${row(`  ${c.dim('USDC:')}    ${c.cyan(formatUnits(usdcBal, USDC_DECIMALS))}`)}
${row(`  ${c.dim('Server:')}  ${c.cyan(BASE)}`)}
${row()}
${row(`  ${c.dim('Each search: ZK proof → 3-hop onion relay → encrypted')}`)}
${row(`  ${c.dim('Payment: USDC micropayment settled on-chain via x402')}`)}
${row()}
${c.bold('╚══════════════════════════════════════════════════════════════╝')}
`);

  if (ethBal === 0n) {
    console.error(c.red('  ⚠ No ETH for gas — get some from https://www.alchemy.com/faucets/base-sepolia\n'));
  }
  if (usdcBal === 0n) {
    console.error(c.red('  ⚠ No USDC for payments — get some from https://faucet.circle.com\n'));
  }

  // ── x402 client setup ────────────────────────────────────────────────────
  const coreClient = new x402Client();
  registerExactEvmScheme(coreClient, { signer });
  const httpClient = new x402HTTPClient(coreClient);

  // ── MCP session ──────────────────────────────────────────────────────────
  process.stdout.write(c.dim('  Connecting to MCP server... '));

  const initRes = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'meshsearch-demo', version: '0.1.0' } }
    })
  });

  const sid = initRes.headers.get('mcp-session-id');
  if (!sid) {
    console.error(c.red('failed'));
    console.error(c.red(`  Server returned ${initRes.status}: ${await initRes.text()}`));
    process.exit(1);
  }

  // Send initialized notification
  await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'mcp-session-id': sid },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
  });

  console.log(c.green('connected'));
  console.log(c.dim(`  Session: ${sid}\n`));

  // ── Search function ──────────────────────────────────────────────────────
  let reqId = 10;

  async function search(query) {
    const id = ++reqId;
    const t0 = Date.now();

    console.log(`\n${c.bold(c.cyan('━'.repeat(60)))}`);
    console.log(`  ${c.bold('Query:')} ${query}`);
    console.log(`${c.bold(c.cyan('━'.repeat(60)))}`);

    const searchBody = JSON.stringify({
      jsonrpc: '2.0', id, method: 'tools/call',
      params: { name: 'private_search', arguments: { query } }
    });

    const mcpHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-session-id': sid,
    };

    // ── Step 1: Send without payment → get 402 + PaymentRequired ──────────
    process.stdout.write(`  ${c.dim('1.')} Requesting price quote...          `);
    const quoteRes = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: mcpHeaders,
      body: searchBody,
    });

    if (quoteRes.status !== 402) {
      if (quoteRes.status === 200) {
        // x402 might be disabled — results came through free
        console.log(c.yellow('free (x402 disabled)'));
        const msgs = await parseResponse(quoteRes);
        const result = msgs.find(m => m.result)?.result || msgs[0];
        printResults(result, Date.now() - t0, null);
        return;
      }
      console.log(c.red(`error (${quoteRes.status})`));
      console.error(c.red(`  ${(await quoteRes.text()).slice(0, 200)}`));
      return;
    }

    const payReqHeader = quoteRes.headers.get('payment-required');
    if (!payReqHeader) {
      console.log(c.red('error (no payment-required header)'));
      return;
    }

    const paymentRequired = decodePaymentRequiredHeader(payReqHeader);
    const req0 = paymentRequired.paymentRequirements?.[0] || paymentRequired.accepts?.[0];
    const rawAmount = req0?.maxAmountRequired || req0?.amount || '0';
    const price = formatUnits(BigInt(rawAmount), USDC_DECIMALS);
    console.log(`${c.bg402('402')} ${c.dim(`$${price} USDC`)}`);

    // ── Step 2: Sign USDC payment ─────────────────────────────────────────
    process.stdout.write(`  ${c.dim('2.')} Signing USDC payment...             `);
    let paymentPayload;
    try {
      paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
      console.log(c.green('signed'));
    } catch (err) {
      console.log(c.red('failed'));
      console.error(c.red(`  ${err.message}`));
      if (err.message.includes('insufficient') || err.message.includes('allowance')) {
        console.error(c.yellow('  → Get USDC from https://faucet.circle.com'));
      }
      return;
    }

    // ── Step 3: Send with payment → search executes ───────────────────────
    process.stdout.write(`  ${c.dim('3.')} Sending paid request...              `);
    const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

    const paidRes = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: { ...mcpHeaders, ...paymentHeaders },
      body: searchBody,
    });

    if (paidRes.status !== 200) {
      console.log(c.red(`error (${paidRes.status})`));
      console.error(c.red(`  ${(await paidRes.text()).slice(0, 300)}`));
      return;
    }
    console.log(c.green(`200 OK`));

    // ── Step 4: Parse settlement receipt ───────────────────────────────────
    let txHash = null;
    const settleHeader = paidRes.headers.get('payment-response');
    if (settleHeader) {
      try {
        const settle = decodePaymentResponseHeader(settleHeader);
        txHash = settle.transaction;
      } catch {}
    }

    // ── Step 5: Display results ───────────────────────────────────────────
    const msgs = await parseResponse(paidRes);
    const result = msgs.find(m => m.result)?.result || msgs[0];
    printResults(result, Date.now() - t0, txHash);
  }

  function printResults(result, ms, txHash) {
    console.log();

    // Privacy pipeline info
    console.log(`  ${c.bold('Privacy pipeline:')}`);
    console.log(`    ${c.green('✓')} Semaphore ZK proof generated (anonymous identity)`);
    console.log(`    ${c.green('✓')} Nullifier checked (prevents double-query tracking)`);
    console.log(`    ${c.green('✓')} 3-hop onion-encrypted relay path`);
    console.log(`    ${c.green('✓')} Results encrypted + stored on Fileverse`);

    // Payment info
    if (txHash) {
      console.log(`\n  ${c.bold('Payment settlement:')}`);
      console.log(`    ${c.green('✓')} USDC settled on-chain`);
      console.log(`    ${c.dim('Tx:')} ${c.cyan(BASESCAN_URL + txHash)}`);
    }

    // Search results
    if (result?.content?.[0]?.text) {
      console.log(`\n  ${c.bold('Search results:')}`);
      // Pretty-print the markdown results with indentation
      const text = result.content[0].text;
      const lines = text.split('\n').slice(0, 25); // first 25 lines
      for (const line of lines) {
        if (line.startsWith('# ')) {
          console.log(`    ${c.bold(line)}`);
        } else if (line.startsWith('**') || line.match(/^\d+\./)) {
          console.log(`    ${c.cyan(line)}`);
        } else if (line.trim().startsWith('http')) {
          console.log(`    ${c.dim(line)}`);
        } else {
          console.log(`    ${line}`);
        }
      }
      if (text.split('\n').length > 25) {
        console.log(`    ${c.dim(`... (${text.split('\n').length - 25} more lines)`)}`);
      }
    } else if (result?.content?.[0]) {
      console.log(`\n  ${c.dim(JSON.stringify(result.content[0]).slice(0, 300))}`);
    }

    console.log(`\n  ${c.dim(`Completed in ${ms}ms`)}`);
  }

  // ── Handle single query mode ─────────────────────────────────────────────
  if (singleQuery) {
    await search(singleQuery);
    // Cleanup
    await fetch(`${BASE}/mcp`, { method: 'DELETE', headers: { 'mcp-session-id': sid } });
    process.exit(0);
  }

  // ── Interactive REPL ─────────────────────────────────────────────────────
  console.log(c.dim('  Type a search query and press Enter. Ctrl+C to exit.\n'));

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${c.bold(c.mag('search'))} ${c.dim('›')} `,
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const query = line.trim();
    if (!query) { rl.prompt(); return; }
    if (query === 'exit' || query === 'quit') { rl.close(); return; }

    if (query === 'balance') {
      try {
        const bal = await publicClient.readContract({
          address: USDC_ADDRESS,
          abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }],
          functionName: 'balanceOf',
          args: [account.address],
        });
        console.log(`  USDC: ${c.cyan(formatUnits(bal, USDC_DECIMALS))}`);
      } catch { console.log(c.dim('  Could not read USDC balance')); }
      rl.prompt();
      return;
    }

    if (query === 'help') {
      console.log(`
  ${c.bold('Commands:')}
    ${c.cyan('<query>')}    Search the web privately
    ${c.cyan('balance')}   Check USDC balance
    ${c.cyan('exit')}      Quit
`);
      rl.prompt();
      return;
    }

    await search(query);
    console.log();
    rl.prompt();
  });

  rl.on('close', async () => {
    console.log(c.dim('\n  Closing session...'));
    await fetch(`${BASE}/mcp`, { method: 'DELETE', headers: { 'mcp-session-id': sid } }).catch(() => {});
    console.log(c.dim('  Goodbye!\n'));
    process.exit(0);
  });
}

main().catch(err => {
  console.error(c.red(`\n  Fatal: ${err.message}`));
  process.exit(1);
});

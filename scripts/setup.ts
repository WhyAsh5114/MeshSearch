#!/usr/bin/env tsx
/**
 * MeshSearch Interactive Setup & Launcher
 *
 * Walks through all pre-flight checks, key-pair generation, env
 * file writing, service startup, and prints the final wiring config.
 *
 * Usage:  pnpm tsx scripts/setup.ts
 */

import { createInterface } from 'node:readline/promises';
import {
  existsSync, writeFileSync, readFileSync,
  mkdirSync, createWriteStream,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import * as crypto from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ─── Colours ────────────────────────────────────────────────────────────────
const c = {
  bold:  (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim:   (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  cyan:  (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow:(s: string) => `\x1b[33m${s}\x1b[0m`,
  red:   (s: string) => `\x1b[31m${s}\x1b[0m`,
  ok:    (s: string) => `  ${c.green('✓')} ${s}`,
  fail:  (s: string) => `  ${c.red('✗')} ${s}`,
  info:  (s: string) => `  ${c.cyan('ℹ')} ${s}`,
  warn:  (s: string) => `  ${c.yellow('⚠')} ${s}`,
  step:  (n: number, s: string) => `\n${c.bold(c.cyan(`[${n}]`))} ${c.bold(s)}`,
};

// ─── Readline helper ──────────────────────────────────────────────────────────
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => rl.question(`  ${c.bold('?')} ${q} `);
const askYN = async (q: string, def = true): Promise<boolean> => {
  const hint = def ? 'Y/n' : 'y/N';
  const ans = (await ask(`${q} ${c.dim(`(${hint})`)}`)).trim().toLowerCase();
  if (!ans) return def;
  return ans === 'y' || ans === 'yes';
};

// ─── secp256k1 key generation (pure Node, no external deps needed) ──────────
function genPrivKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Derive compressed public key using the already-installed @noble/curves. */
async function derivePublicKey(privHex: string): Promise<string> {
  // Import from the local crypto package's node_modules
  const cryptoPkgPath = join(ROOT, 'packages', 'crypto');
  const { secp256k1 } =
    await import(`${cryptoPkgPath}/node_modules/@noble/curves/secp256k1.js`);
  const { bytesToHex, hexToBytes } =
    await import(`${cryptoPkgPath}/node_modules/@noble/hashes/utils.js`);
  return bytesToHex(secp256k1.getPublicKey(hexToBytes(privHex), true));
}

// ─── .env helpers ────────────────────────────────────────────────────────────
function readEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const result: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    result[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return result;
}

function writeEnv(path: string, vars: Record<string, string>, comment = '') {
  const lines: string[] = [];
  if (comment) lines.push(comment, '');
  for (const [k, v] of Object.entries(vars)) {
    lines.push(`${k}=${v}`);
  }
  writeFileSync(path, lines.join('\n') + '\n', 'utf-8');
}

function mergeEnv(path: string, updates: Record<string, string>) {
  const existing = readEnv(path);
  const merged = { ...existing, ...updates };
  // Preserve comment lines from original
  const originalLines = existsSync(path) ? readFileSync(path, 'utf-8').split('\n') : [];
  const commentLines = originalLines.filter(l => l.trim().startsWith('#') || l.trim() === '');
  // Write comments first, then all keys
  const keyLines = Object.entries(merged).map(([k, v]) => `${k}=${v}`);
  writeFileSync(path, [...commentLines, ...keyLines].join('\n') + '\n', 'utf-8');
}

// ─── Process management ──────────────────────────────────────────────────────
interface ManagedProcess {
  name: string;
  port: number;
  pid?: number;
  logFile: string;
}
const procs: ManagedProcess[] = [];

function isPortBound(port: number): boolean {
  try {
    execSync(`lsof -iTCP:${port} -sTCP:LISTEN -t`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function waitForPort(port: number, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isPortBound(port)) return true;
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

// ─── Prereq checks ────────────────────────────────────────────────────────────
function checkPrereqs(): boolean {
  let ok = true;
  for (const cmd of ['node', 'pnpm', 'docker']) {
    try {
      execSync(`which ${cmd}`, { stdio: 'pipe' });
      console.log(c.ok(`${cmd} found`));
    } catch {
      console.log(c.fail(`${cmd} not found — please install it`));
      ok = false;
    }
  }
  return ok;
}

// ─── Docker SearXNG ─────────────────────────────────────────────────────────
function getSearxngState(): 'running' | 'stopped' | 'absent' {
  try {
    const out = execSync('docker inspect meshsearch-searxng --format "{{.State.Running}}"', {
      stdio: 'pipe',
    }).toString().trim();
    return out === 'true' ? 'running' : 'stopped';
  } catch {
    return 'absent';
  }
}

function startSearxng(port: number): 'running' | 'started' | 'failed' {
  const state = getSearxngState();
  if (state === 'running') return 'running';
  if (state === 'stopped') {
    try { execSync('docker start meshsearch-searxng', { stdio: 'pipe' }); return 'started'; }
    catch { return 'failed'; }
  }
  // absent — create + start
  try {
    execSync(
      `docker run -d --name meshsearch-searxng -p ${port}:8080 -e SEARXNG_BASE_URL=http://localhost:${port} searxng/searxng:latest`,
      { stdio: 'pipe' },
    );
    return 'started';
  } catch (e) {
    return 'failed';
  }
}

// ─── Build check ─────────────────────────────────────────────────────────────
function ensureBuilt() {
  const cryptoDist = join(ROOT, 'packages', 'crypto', 'dist', 'index.js');
  const typesDist = join(ROOT, 'packages', 'types', 'dist', 'index.js');
  if (!existsSync(cryptoDist) || !existsSync(typesDist)) {
    console.log(c.info('Building packages...'));
    execSync('pnpm turbo build --filter="@meshsearch/types" --filter="@meshsearch/crypto" --filter="@meshsearch/relay-node" --filter="@meshsearch/search-backend" --filter="@meshsearch/fileverse" --filter="@meshsearch/mcp-server"', {
      cwd: ROOT, stdio: 'inherit',
    });
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`
${c.bold(c.cyan('╔══════════════════════════════════════════════════╗'))}
${c.bold(c.cyan('║       MeshSearch — Interactive Setup             ║'))}
${c.bold(c.cyan('╚══════════════════════════════════════════════════╝'))}
`);

  // ── Step 1: Prerequisites ────────────────────────────────────────────────
  console.log(c.step(1, 'Checking prerequisites'));
  if (!checkPrereqs()) {
    console.log(c.red('\nFix missing prerequisites and try again.'));
    process.exit(1);
  }

  // ── Step 2: Key pairs ────────────────────────────────────────────────────
  console.log(c.step(2, 'Cryptographic key pairs'));

  // Load what's already in the env files
  const backendEnv   = readEnv(join(ROOT, 'apps', 'search-backend', '.env'));
  const relayEnv     = readEnv(join(ROOT, 'apps', 'relay-node', '.env'));
  const mcpEnv       = readEnv(join(ROOT, 'apps', 'mcp-server', '.env'));

  let backendPriv    = backendEnv['BACKEND_PRIVATE_KEY'] || '';
  let relay1Priv     = relayEnv['RELAY_PRIVATE_KEY'] || '';
  let semaphoreSecret = mcpEnv['SEMAPHORE_SECRET'] || '';

  // relay 2 & 3 are inlined in RELAY_ENDPOINTS — parse them back out
  const endpointStr  = mcpEnv['RELAY_ENDPOINTS'] || '';
  const endpointParts = endpointStr.split(',').map(e => e.split('|'));

  let relay2Priv = '';
  let relay3Priv = '';

  // Try to read from dotenv-style files if they exist
  const r2env = readEnv(join(ROOT, 'apps', 'relay-node', '.env.relay2'));
  const r3env = readEnv(join(ROOT, 'apps', 'relay-node', '.env.relay3'));
  relay2Priv = r2env['RELAY_PRIVATE_KEY'] || '';
  relay3Priv = r3env['RELAY_PRIVATE_KEY'] || '';

  const hasExistingKeys = backendPriv && relay1Priv && relay2Priv && relay3Priv;

  if (hasExistingKeys) {
    console.log(c.ok('Existing key pairs found'));
    const regen = await askYN('Regenerate all key pairs?', false);
    if (regen) {
      backendPriv = relay1Priv = relay2Priv = relay3Priv = semaphoreSecret = '';
    }
  }

  console.log(c.info('Deriving public keys — this takes a moment...'));

  if (!backendPriv)     backendPriv     = genPrivKey();
  if (!relay1Priv)      relay1Priv      = genPrivKey();
  if (!relay2Priv)      relay2Priv      = genPrivKey();
  if (!relay3Priv)      relay3Priv      = genPrivKey();
  if (!semaphoreSecret) semaphoreSecret = genPrivKey();

  const [backendPub, relay1Pub, relay2Pub, relay3Pub] = await Promise.all([
    derivePublicKey(backendPriv),
    derivePublicKey(relay1Priv),
    derivePublicKey(relay2Priv),
    derivePublicKey(relay3Priv),
  ]);

  console.log(c.ok(`Backend  ${c.dim(backendPub.slice(0, 16) + '...')}`));
  console.log(c.ok(`Relay 1  ${c.dim(relay1Pub.slice(0, 16) + '...')}`));
  console.log(c.ok(`Relay 2  ${c.dim(relay2Pub.slice(0, 16) + '...')}`));
  console.log(c.ok(`Relay 3  ${c.dim(relay3Pub.slice(0, 16) + '...')}`));

  // ── Step 3: Port config ──────────────────────────────────────────────────
  console.log(c.step(3, 'Port configuration'));

  const defaultPorts = { searxng: 8888, backend: 4001, relay1: 4002, relay2: 4003, relay3: 4004, fileverse: 4005, mcp: 3038 };

  const customPorts = await askYN('Use default ports (8888/4001-4005/3038)?', true);
  const ports = { ...defaultPorts };
  if (!customPorts) {
    ports.searxng   = parseInt(await ask(`SearXNG port [${defaultPorts.searxng}]:`   ) || String(defaultPorts.searxng),   10);
    ports.backend   = parseInt(await ask(`Search backend port [${defaultPorts.backend}]:`  ) || String(defaultPorts.backend),   10);
    ports.relay1    = parseInt(await ask(`Relay 1 port [${defaultPorts.relay1}]:`    ) || String(defaultPorts.relay1),    10);
    ports.relay2    = parseInt(await ask(`Relay 2 port [${defaultPorts.relay2}]:`    ) || String(defaultPorts.relay2),    10);
    ports.relay3    = parseInt(await ask(`Relay 3 port [${defaultPorts.relay3}]:`    ) || String(defaultPorts.relay3),    10);
    ports.fileverse = parseInt(await ask(`Fileverse port [${defaultPorts.fileverse}]:`) || String(defaultPorts.fileverse), 10);
    ports.mcp       = parseInt(await ask(`MCP server port [${defaultPorts.mcp}]:`    ) || String(defaultPorts.mcp),       10);
  }
  console.log(c.ok(`Ports: SearXNG=${ports.searxng} backend=${ports.backend} relays=${ports.relay1}/${ports.relay2}/${ports.relay3} fileverse=${ports.fileverse} mcp=${ports.mcp}`));

  // ── Step 4: Brave API key (optional) ─────────────────────────────────────
  console.log(c.step(4, 'Search engine config'));
  const existingBrave = backendEnv['BRAVE_API_KEY'] || '';
  let braveKey = existingBrave;
  if (!braveKey) {
    braveKey = (await ask('Brave Search API key (leave blank to use SearXNG only):')).trim();
  } else {
    console.log(c.ok('Brave API key already set — keeping it'));
  }

  // ── Step 5: Blockchain / contracts ───────────────────────────────────────
  console.log(c.step(5, 'Smart contracts'));

  let rpcUrl          = mcpEnv['RPC_URL']                   || 'http://localhost:8545';
  let nodeReg         = mcpEnv['NODE_REGISTRY_ADDRESS']     || '';
  let nullifierReg    = mcpEnv['NULLIFIER_REGISTRY_ADDRESS']|| '';
  let paymentSplitter = mcpEnv['PAYMENT_SPLITTER_ADDRESS']  || '';
  let accessControl   = mcpEnv['ACCESS_CONTROL_ADDRESS']    || '';

  const needsContracts = [nodeReg, nullifierReg, paymentSplitter, accessControl]
    .some(a => !a || a === '0x0000000000000000000000000000000000000000');

  if (needsContracts) {
    const deployLocal = await askYN('Deploy contracts to local Hardhat node?', true);
    if (deployLocal) {
      rpcUrl = 'http://localhost:8545';

      // Start Hardhat node in background if not running
      if (!isPortBound(8545)) {
        console.log(c.info('Starting Hardhat node...'));
        const hardhatProc = spawn('npx', ['hardhat', 'node'], {
          cwd: join(ROOT, 'packages', 'contracts'),
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
        });
        const logsDir = join(ROOT, '.logs');
        mkdirSync(logsDir, { recursive: true });
        const logStream = createWriteStream(join(logsDir, 'hardhat.log'), { flags: 'a' });
        hardhatProc.stdout.pipe(logStream);
        hardhatProc.stderr.pipe(logStream);

        const ready = await waitForPort(8545, 20000);
        if (!ready) {
          console.log(c.fail('Hardhat node did not start in time — check .logs/hardhat.log'));
          process.exit(1);
        }
        console.log(c.ok('Hardhat node running on :8545'));
      } else {
        console.log(c.ok('Hardhat node already running on :8545'));
      }

      // Deploy contracts
      console.log(c.info('Deploying contracts...'));
      try {
        const output = execSync(
          'npx hardhat run scripts/deploy.ts --network localhost',
          { cwd: join(ROOT, 'packages', 'contracts'), encoding: 'utf-8' },
        );
        // Parse addresses from output
        const addrMatch = output.match(/\{[\s\S]*"nodeRegistry"[\s\S]*\}/);
        if (addrMatch) {
          const addrs = JSON.parse(addrMatch[0]);
          nodeReg         = addrs.nodeRegistry;
          nullifierReg    = addrs.nullifierRegistry;
          paymentSplitter = addrs.paymentSplitter;
          accessControl   = addrs.accessControl;
          console.log(c.ok('Contracts deployed'));
          console.log(c.dim(`  NodeRegistry:      ${nodeReg}`));
          console.log(c.dim(`  NullifierRegistry: ${nullifierReg}`));
          console.log(c.dim(`  PaymentSplitter:   ${paymentSplitter}`));
          console.log(c.dim(`  AccessControl:     ${accessControl}`));
        } else {
          console.log(c.warn('Could not parse contract addresses — fill them in manually'));
        }
      } catch (e) {
        console.log(c.fail('Contract deployment failed — continuing with zero addresses'));
      }
    } else {
      rpcUrl = (await ask(`RPC URL [${rpcUrl}]:`)).trim() || rpcUrl;
      nodeReg         = (await ask('NodeRegistry address:'     )).trim() || nodeReg;
      nullifierReg    = (await ask('NullifierRegistry address:')).trim() || nullifierReg;
      paymentSplitter = (await ask('PaymentSplitter address:'  )).trim() || paymentSplitter;
      accessControl   = (await ask('AccessControl address:'    )).trim() || accessControl;
    }
  } else {
    console.log(c.ok('Contract addresses already configured — reusing them'));
  }

  // ── Step 5b: x402 Payment config ──────────────────────────────────────────
  console.log(c.step(5, 'x402 Payment gate (optional)'));

  const existingX402 = mcpEnv['X402_ENABLED'] === 'true';
  let x402Enabled  = existingX402;
  let x402PayTo    = mcpEnv['X402_PAY_TO'] || '';
  let x402Price    = mcpEnv['X402_SEARCH_PRICE'] || '$0.001';
  let x402Network  = mcpEnv['X402_NETWORK'] || 'eip155:84532';

  if (existingX402) {
    console.log(c.ok(`x402 already enabled — payTo=${x402PayTo} price=${x402Price}`));
    const reconfigure = await askYN('Reconfigure x402 settings?', false);
    if (reconfigure) x402Enabled = false; // will re-prompt below
  }
  if (!x402Enabled) {
    x402Enabled = await askYN('Enable x402 per-search payments (Base Sepolia USDC)?', false);
    if (x402Enabled) {
      x402PayTo  = (await ask('Wallet address to receive payments (your Base Sepolia address):')).trim();
      if (!x402PayTo || !x402PayTo.startsWith('0x')) {
        console.log(c.warn('Invalid address — x402 disabled'));
        x402Enabled = false;
      } else {
        x402Price   = (await ask(`Price per search in USD [${x402Price}]:`)).trim() || x402Price;
        const networkChoice = await ask(`Chain: (1) Base Sepolia  (2) Sepolia  [1]:`);
        if (networkChoice.trim() === '2') {
          x402Network = 'eip155:11155111'; // Ethereum Sepolia
        }
        console.log(c.ok(`x402: ${x402Price}/search → ${x402PayTo.slice(0, 10)}… on ${x402Network}`));
      }
    }
  }

  // ── Step 6: Write .env files ──────────────────────────────────────────────
  console.log(c.step(6, 'Writing .env files'));

  const relayEndpoints = [
    `http://localhost:${ports.relay1}|${relay1Pub}|relay1.meshsearch.eth`,
    `http://localhost:${ports.relay2}|${relay2Pub}|relay2.meshsearch.eth`,
    `http://localhost:${ports.relay3}|${relay3Pub}|relay3.meshsearch.eth`,
  ].join(',');

  // search-backend
  writeEnv(join(ROOT, 'apps', 'search-backend', '.env'), {
    PORT: String(ports.backend),
    SEARXNG_URL: `http://localhost:${ports.searxng}`,
    BACKEND_PRIVATE_KEY: backendPriv,
    BRAVE_API_KEY: braveKey,
  }, '# Search Backend — auto-generated by setup.ts');

  // relay node 1
  writeEnv(join(ROOT, 'apps', 'relay-node', '.env'), {
    PORT: String(ports.relay1),
    RELAY_ENS_NAME: 'relay1.meshsearch.eth',
    RELAY_PRIVATE_KEY: relay1Priv,
  }, '# Relay Node 1 — auto-generated by setup.ts');

  // relay nodes 2 & 3 — separate env files
  writeEnv(join(ROOT, 'apps', 'relay-node', '.env.relay2'), {
    PORT: String(ports.relay2),
    RELAY_ENS_NAME: 'relay2.meshsearch.eth',
    RELAY_PRIVATE_KEY: relay2Priv,
  }, '# Relay Node 2 — auto-generated by setup.ts');
  writeEnv(join(ROOT, 'apps', 'relay-node', '.env.relay3'), {
    PORT: String(ports.relay3),
    RELAY_ENS_NAME: 'relay3.meshsearch.eth',
    RELAY_PRIVATE_KEY: relay3Priv,
  }, '# Relay Node 3 — auto-generated by setup.ts');

  // fileverse
  writeEnv(join(ROOT, 'apps', 'fileverse', '.env'), {
    PORT: String(ports.fileverse),
  }, '# Fileverse Storage — auto-generated by setup.ts');

  // mcp-server
  const zero = '0x0000000000000000000000000000000000000000';
  const mcpEnvVars: Record<string, string> = {
    PORT: String(ports.mcp),
    MCP_TRANSPORT: 'http',
    SEARCH_BACKEND_URL: `http://localhost:${ports.backend}`,
    RELAY_ENDPOINTS: relayEndpoints,
    FILEVERSE_API_URL: `http://localhost:${ports.fileverse}`,
    BACKEND_PUBLIC_KEY: backendPub,
    SEMAPHORE_SECRET: semaphoreSecret,
    RPC_URL: rpcUrl,
    NODE_REGISTRY_ADDRESS: nodeReg || zero,
    NULLIFIER_REGISTRY_ADDRESS: nullifierReg || zero,
    PAYMENT_SPLITTER_ADDRESS: paymentSplitter || zero,
    ACCESS_CONTROL_ADDRESS: accessControl || zero,
    X402_ENABLED: x402Enabled ? 'true' : 'false',
  };
  if (x402Enabled) {
    mcpEnvVars['X402_PAY_TO'] = x402PayTo;
    mcpEnvVars['X402_SEARCH_PRICE'] = x402Price;
    mcpEnvVars['X402_NETWORK'] = x402Network;
  }
  writeEnv(join(ROOT, 'apps', 'mcp-server', '.env'), mcpEnvVars, '# MCP Server — auto-generated by setup.ts');

  console.log(c.ok('All .env files written'));

  // ── Step 7: SearXNG ──────────────────────────────────────────────────────
  console.log(c.step(7, 'Starting SearXNG'));
  const searxngState = startSearxng(ports.searxng);
  if (searxngState === 'failed') {
    console.log(c.warn('SearXNG failed to start — search will still work if already running elsewhere'));
  } else {
    console.log(c.ok(`SearXNG ${searxngState} on :${ports.searxng}`));
  }

  // ── Step 8: Build packages ───────────────────────────────────────────────
  console.log(c.step(8, 'Building packages'));
  try {
    ensureBuilt();
    console.log(c.ok('All packages built'));
  } catch (e) {
    console.log(c.fail('Build failed — trying incremental build'));
    try {
      execSync('pnpm turbo build', { cwd: ROOT, stdio: 'inherit' });
      console.log(c.ok('Build succeeded'));
    } catch {
      console.log(c.red('Build failed — cannot start services'));
      process.exit(1);
    }
  }

  // ── Step 9: Start services ───────────────────────────────────────────────
  console.log(c.step(9, 'Starting services'));

  function spawnService(
    name: string, port: number, cwd: string,
    env: Record<string, string>,
  ) {
    const logsDir = join(ROOT, '.logs');
    mkdirSync(logsDir, { recursive: true });
    const logFile = join(logsDir, `${name}.log`);
    const logStream = createWriteStream(logFile, { flags: 'a' });

    const child = spawn('pnpm', ['dev'], {
      cwd: resolve(ROOT, cwd),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);
    child.on('exit', code => {
      if (code !== 0 && code !== null)
        console.error(c.fail(`${name} exited with code ${code} — check ${logFile}`));
    });
    procs.push({ name, port, pid: child.pid, logFile });
    return child;
  }

  // Search backend
  spawnService('search-backend', ports.backend, 'apps/search-backend', {
    PORT: String(ports.backend),
    SEARXNG_URL: `http://localhost:${ports.searxng}`,
    BACKEND_PRIVATE_KEY: backendPriv,
    BRAVE_API_KEY: braveKey,
  });

  // Relay 1
  spawnService('relay1', ports.relay1, 'apps/relay-node', {
    PORT: String(ports.relay1),
    RELAY_ENS_NAME: 'relay1.meshsearch.eth',
    RELAY_PRIVATE_KEY: relay1Priv,
  });

  // Relay 2
  spawnService('relay2', ports.relay2, 'apps/relay-node', {
    PORT: String(ports.relay2),
    RELAY_ENS_NAME: 'relay2.meshsearch.eth',
    RELAY_PRIVATE_KEY: relay2Priv,
  });

  // Relay 3
  spawnService('relay3', ports.relay3, 'apps/relay-node', {
    PORT: String(ports.relay3),
    RELAY_ENS_NAME: 'relay3.meshsearch.eth',
    RELAY_PRIVATE_KEY: relay3Priv,
  });

  // Fileverse
  spawnService('fileverse', ports.fileverse, 'apps/fileverse', {
    PORT: String(ports.fileverse),
  });

  // MCP server
  spawnService('mcp-server', ports.mcp, 'apps/mcp-server', {
    PORT: String(ports.mcp),
    MCP_TRANSPORT: 'http',
    SEARCH_BACKEND_URL: `http://localhost:${ports.backend}`,
    RELAY_ENDPOINTS: relayEndpoints,
    FILEVERSE_API_URL: `http://localhost:${ports.fileverse}`,
    BACKEND_PUBLIC_KEY: backendPub,
    SEMAPHORE_SECRET: semaphoreSecret,
    RPC_URL: rpcUrl,
    NODE_REGISTRY_ADDRESS: nodeReg || zero,
    NULLIFIER_REGISTRY_ADDRESS: nullifierReg || zero,
    PAYMENT_SPLITTER_ADDRESS: paymentSplitter || zero,
    ACCESS_CONTROL_ADDRESS: accessControl || zero,
    ...(x402Enabled ? {
      X402_ENABLED: 'true',
      X402_PAY_TO: x402PayTo,
      X402_SEARCH_PRICE: x402Price,
      X402_NETWORK: x402Network,
    } : {}),
  });

  // ── Step 10: Wait for readiness ──────────────────────────────────────────
  console.log(c.step(10, 'Waiting for services to come online'));

  const targets = [
    { name: 'search-backend', port: ports.backend },
    { name: 'relay1',         port: ports.relay1 },
    { name: 'relay2',         port: ports.relay2 },
    { name: 'relay3',         port: ports.relay3 },
    { name: 'fileverse',      port: ports.fileverse },
    { name: 'mcp-server',     port: ports.mcp },
  ];

  for (const { name, port } of targets) {
    const up = await waitForPort(port, 20000);
    if (up) {
      console.log(c.ok(`${name} :${port}`));
    } else {
      console.log(c.warn(`${name} :${port} did not respond in time — check .logs/${name}.log`));
    }
  }

  // ── Step 11: Output wiring config ────────────────────────────────────────
  const mcpDistPath = resolve(ROOT, 'apps', 'mcp-server', 'dist', 'index.js');
  const mcpConfig = {
    mcpServers: {
      meshsearch: {
        command: 'node',
        args: [mcpDistPath],
        env: {
          PORT: String(ports.mcp),
          MCP_TRANSPORT: 'stdio',
          SEARCH_BACKEND_URL: `http://localhost:${ports.backend}`,
          RELAY_ENDPOINTS: relayEndpoints,
          FILEVERSE_API_URL: `http://localhost:${ports.fileverse}`,
          BACKEND_PUBLIC_KEY: backendPub,
          SEMAPHORE_SECRET: semaphoreSecret,
          RPC_URL: rpcUrl,
          NODE_REGISTRY_ADDRESS: nodeReg || zero,
          NULLIFIER_REGISTRY_ADDRESS: nullifierReg || zero,
          PAYMENT_SPLITTER_ADDRESS: paymentSplitter || zero,
          ACCESS_CONTROL_ADDRESS: accessControl || zero,
          ...(x402Enabled ? {
            X402_ENABLED: 'true',
            X402_PAY_TO: x402PayTo,
            X402_SEARCH_PRICE: x402Price,
            X402_NETWORK: x402Network,
          } : {}),
        },
      },
    },
  };

  const border = c.bold(c.cyan('═'.repeat(56)));
  console.log(`
${border}
${c.bold(c.cyan('  MeshSearch is running — here\'s your wiring config'))}
${border}

${c.bold('Service status')}
  SearXNG     → http://localhost:${ports.searxng}
  Backend     → http://localhost:${ports.backend}
  Relay 1     → http://localhost:${ports.relay1}
  Relay 2     → http://localhost:${ports.relay2}
  Relay 3     → http://localhost:${ports.relay3}
  Fileverse   → http://localhost:${ports.fileverse}
  MCP Server  → http://localhost:${ports.mcp}

${c.bold('Logs')}  ${c.dim(join(ROOT, '.logs', '<service>.log'))}

${c.bold('Quick health check')}
  ${c.dim(`curl http://localhost:${ports.mcp}/health | jq .`)}

${c.bold('Test MCP (Streamable HTTP requires initialize → tool call)')}
  ${c.dim(`# Step 1: Initialize session — capture the session ID
SID=$(curl -sD- http://localhost:${ports.mcp}/mcp \\
  -H 'Content-Type: application/json' \\
  -H 'Accept: application/json, text/event-stream' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}' \\
  | grep -i mcp-session-id | tr -d '\\r' | awk '{print $2}')
echo "Session: $SID"

# Step 2: List tools
curl -s http://localhost:${ports.mcp}/mcp \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -H "mcp-session-id: $SID" \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | jq .

# Step 3: Call a tool
curl -s http://localhost:${ports.mcp}/mcp \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -H "mcp-session-id: $SID" \\
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"private_search","arguments":{"query":"test"}}}' | jq .`)}

${c.bold('LAN / Tailscale access')}
  ${c.dim(`All services bind to 0.0.0.0 — reachable at http://<your-ip>:${ports.mcp}/mcp`)}
  ${c.dim(`Use 'ifconfig | grep inet' or your Tailscale IP.`)}

${c.bold('Claude Desktop / Cursor config')}
${c.dim('Add to: ~/.config/claude/claude_desktop_config.json')}
${c.dim('  (macOS: ~/Library/Application Support/Claude/claude_desktop_config.json)')}

${JSON.stringify(mcpConfig, null, 2)}

${c.bold('Onchain')}
  RPC:               ${rpcUrl}
  NodeRegistry:      ${nodeReg || c.yellow('not deployed')}
  NullifierRegistry: ${nullifierReg || c.yellow('not deployed')}
  PaymentSplitter:   ${paymentSplitter || c.yellow('not deployed')}
  AccessControl:     ${accessControl || c.yellow('not deployed')}

${border}
  All services are ${c.green('running')} in this terminal session.
  Press ${c.bold('Ctrl+C')} to stop everything.
${border}
`);

  // Save the MCP config to a file for easy copy-paste
  const configPath = join(ROOT, 'mcp-config.json');
  writeFileSync(configPath, JSON.stringify(mcpConfig, null, 2) + '\n', 'utf-8');
  console.log(c.info(`MCP config saved to: ${configPath}`));

  rl.close();

  // Keep process alive until Ctrl+C
  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      console.log(c.yellow('\n\nShutting down...'));
      resolve();
    });
    process.on('SIGTERM', () => resolve());
  });
}

main().catch(err => {
  console.error(c.red('\nSetup failed: ' + err.message));
  process.exit(1);
});

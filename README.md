# MeshSearch — Private Web Search for AI Agents

> Queries committed with ZK proofs, payments via x402 micropayments, 3-hop onion relay routing, encrypted history on Fileverse. Cryptographic privacy, not promises.

---

## What It Does

Every web search leaks **who you are** and **what you searched.** MeshSearch removes the need to trust anyone: queries are committed client-side with ZK proofs before they leave your device, payments are anonymous USDC micropayments via x402, traffic routes through 3 ENS-named relay hops, and results are stored encrypted on Fileverse.

It ships as an **MCP server** — any AI agent (Claude, Cursor, etc.) can use it as a tool.

**See [ARCHITECTURE.md](ARCHITECTURE.md) for the full technical deep-dive.**

---

## Quick Start

### Prerequisites

- **Node.js** ≥ 20
- **pnpm** ≥ 9
- **Docker** (for SearXNG search engine)

### One-Command Setup

```bash
pnpm install
pnpm run:setup
```

The interactive setup script will:

1. Check prerequisites (node, pnpm, docker)
2. Generate secp256k1 key pairs for all services
3. Configure ports (defaults: SearXNG 8888, relays 4002–4004, MCP 3038)
4. Deploy smart contracts to Base Sepolia by default (local Hardhat is optional)
5. Optionally enable x402 payments (Base Sepolia USDC)
6. Write all `.env` files
7. Start SearXNG, 3 relay nodes, search backend, Fileverse, and the MCP server
8. Output the MCP wiring config for Claude Desktop / Cursor

Once setup finishes, all services are running and the MCP config is saved to `mcp-config.json`.

### Base Sepolia Deployment

Contracts are expected to run on Base Sepolia for demos/judging.

```bash
cd packages/contracts
export BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
export DEPLOYER_PRIVATE_KEY=0x<your-private-key>
pnpm deploy
```

The deploy script prints BaseScan links for all deployed contracts.

`private_search` now fails fast if RPC/contract configuration is missing or unavailable (no silent in-memory fallback). For local-only testing, set:

```env
MESHSEARCH_ALLOW_INMEMORY_FALLBACK=true
```

---

## x402 Payments

MeshSearch uses the [x402 protocol](https://x402.org) for anonymous per-search micropayments on Base Sepolia.

When enabled, calling `private_search` returns **HTTP 402** with a USDC price quote. The client signs a USDC authorization, re-sends the request, and the server settles payment on-chain. No account, no identity — just a wallet.

### Enable x402

During `pnpm run:setup`, answer **yes** to "Enable x402 per-search payments" and provide your Base Sepolia wallet address. Or set manually in `apps/mcp-server/.env`:

```env
X402_ENABLED=true
X402_PAY_TO=0xYourWalletAddress
X402_SEARCH_PRICE=$0.001
X402_NETWORK=eip155:84532
```

### Demo Client (Interactive REPL)

The demo client is a proper x402-aware MCP client with a crypto wallet built in. It shows the full payment flow: price quote → USDC signing → on-chain settlement → BaseScan transaction link.

```bash
cd apps/mcp-server

# Set your wallet key (needs Base Sepolia ETH + USDC)
export TEST_WALLET_KEY=0x<your-private-key>

# Interactive mode
pnpm demo

# Single query
node demo.mjs "what are zero knowledge proofs"
```

**Get testnet tokens:**

- ETH for gas: [alchemy.com/faucets/base-sepolia](https://www.alchemy.com/faucets/base-sepolia)
- USDC: [faucet.circle.com](https://faucet.circle.com)

**REPL commands:** type a query to search, `balance` to check USDC, `help` for options.

---

## MCP Tools

The server exposes three tools:

| Tool             | Description                                             |
| ---------------- | ------------------------------------------------------- |
| `private_search` | ZK-committed search with onion routing and x402 payment |
| `get_history`    | Retrieve + decrypt search history from Fileverse        |
| `compile_report` | Aggregate searches into an encrypted Fileverse document |

---

## Web App

MeshSearch ships a full browser UI alongside the MCP server — no CLI or AI agent required.

```bash
# Start all backend services first (see Quick Start above), then:
cd apps/web && pnpm dev
# Open http://localhost:3000
```

Or from the monorepo root:

```bash
pnpm dev   # starts relay nodes, search backend, MCP server, and the web app together
```

**Features:**
- **Connect wallet** — MetaMask or any injected EVM wallet via wagmi
- **AI-powered search** — streaming chat with any OpenAI-compatible LLM (configure endpoint + model via the gear icon)
- **x402 payment flow** — one-click Pay & Search button triggers MetaMask USDC signing; payment settles on Base Sepolia before the query is executed
- **Formatted results** — each result rendered as a card with title, clickable URL, snippet, plus a metadata footer showing relay routing path, search time, and result hash
- **Persistent context** — after a paid search, the LLM retains the results for follow-up questions in the same session without asking for another payment

---

## ENS Relay Network

All three relay nodes are identified by ENS names rather than IP addresses:

```
relay1.meshsearch.eth  →  localhost:4002 (configurable)
relay2.meshsearch.eth  →  localhost:4003
relay3.meshsearch.eth  →  localhost:4004
```

Each relay's ENS name appears in the `Routing:` field of every search result, giving every query an **auditable provenance trail** — you can verify exactly which relay operators handled your traffic. Relay operators earn a share of the x402 payment split, and their on-chain reputation is tracked by ENS name via the `NodeRegistry` contract.

---

## Fileverse Encrypted History

Every search is stored encrypted on [Fileverse](https://fileverse.io) (IPFS-backed content-addressed storage):

- The query commitment and result hash are written to Fileverse after each search
- Encrypted with the user's wallet key — **only you can decrypt your history**
- Accessible via the `get_history` and `compile_report` MCP tools
- No server-side plaintext ever — even the storage layer sees only ciphertext

This is the anti-thesis of how Google and Bing operate: your search history lives on a decentralised network under your key, not in a data centre under someone else's.

---

## Connect to Claude Desktop / Cursor

The setup script generates `mcp-config.json` at the repo root. Copy it into:

- **Claude Desktop (macOS):** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude Desktop (Linux):** `~/.config/claude/claude_desktop_config.json`
- **Cursor:** Settings → MCP Servers

Or use HTTP transport directly — the server runs on `http://localhost:3038/mcp`.

---

## Manual Setup

If you prefer setting things up step by step instead of using the setup script:

<details>
<summary>Expand manual setup instructions</summary>

### 1. Install & Build

```bash
pnpm install
pnpm build
```

### 2. Start SearXNG

```bash
docker run -d --name meshsearch-searxng -p 8888:8080 \
  -e SEARXNG_BASE_URL=http://localhost:8888 \
  searxng/searxng:latest
```

### 3. Start all services (6 terminals)

```bash
# Search backend
cd apps/search-backend && pnpm dev

# Relay nodes (one terminal each)
cd apps/relay-node && PORT=4002 pnpm dev
cd apps/relay-node && PORT=4003 RELAY_ENS_NAME=relay2.meshsearch.eth pnpm dev
cd apps/relay-node && PORT=4004 RELAY_ENS_NAME=relay3.meshsearch.eth pnpm dev

# Fileverse storage
cd apps/fileverse && pnpm dev

# MCP server
cd apps/mcp-server && pnpm dev
```

### 4. Verify

```bash
# Initialize an MCP session
SID=$(curl -sD- http://localhost:3038/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}' \
  | grep -i mcp-session-id | tr -d '\r' | awk '{print $2}')

# List tools
curl -s http://localhost:3038/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | jq .
```

</details>

---

## Run Tests

```bash
pnpm turbo test
```

95+ tests across all packages — crypto, contracts, middleware, relay routing, storage, and x402 payments.

---

## Repository Structure

```
MeshSearch/
├── apps/
│   ├── mcp-server/        MCP server (HTTP + stdio), x402 gate, ZK verification
│   │   ├── demo.mjs       Interactive x402 demo client (REPL)
│   │   └── src/
│   │       ├── tools/     private_search, get_history, compile_report
│   │       └── middleware/ x402-payment, zk-verification
│   ├── relay-node/        3-hop onion routing relay servers (ENS-named)
│   ├── search-backend/    SearXNG wrapper + result hashing
│   ├── fileverse/         Encrypted history storage on IPFS via Fileverse
│   ├── web/               Next.js browser UI — wallet connect, x402 chat, search results
│   └── dashboard/         Next.js UI (relay map, payment viz, history)
├── packages/
│   ├── contracts/         Solidity (NodeRegistry, NullifierRegistry, PaymentSplitter, AccessControl)
│   ├── crypto/            secp256k1 ECDH, AES-256-GCM, Semaphore ZK proofs
│   └── types/             Shared TypeScript types
└── scripts/
    └── setup.ts           Interactive setup & launcher
```

---

## Tech Stack

| Layer          | Tools                                                              |
| -------------- | ------------------------------------------------------------------ |
| **ZK**         | Semaphore v4 — Groth16 proofs, Poseidon hashing                    |
| **Crypto**     | `@noble/curves` secp256k1 ECDH, `@noble/hashes` HKDF + AES-256-GCM |
| **Payments**   | x402 (`@x402/core`, `@x402/evm`), USDC on Base Sepolia             |
| **Blockchain** | Solidity, Hardhat, ethers v6                                       |
| **MCP**        | `@modelcontextprotocol/sdk` — Streamable HTTP + stdio              |
| **Search**     | SearXNG (self-hosted)                                              |
| **Storage**    | Content-addressed encrypted file storage                           |
| **Frontend**   | Next.js, Tailwind                                                  |
| **Monorepo**   | pnpm workspaces, Turborepo                                         |

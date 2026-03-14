# MeshSearch — Private Web Search for AI Agents

> An untraceable web search protocol for AI agents and humans. Queries are committed with ZK proofs, payments are anonymous via x402, results are routed through ENS-named relay nodes, and history is stored encrypted on Fileverse.

---

## The Problem

Every web search today leaks two things: **who you are** and **what you searched.** Existing privacy tools (VPNs, Tor) can hide who you are, but your raw query still travels in plaintext to a search engine that logs it. For AI agents this is worse — an agent researching a trading strategy, a competitor, or a vulnerability exposes its entire intent to whoever runs the search backend.

There is no search tool today that is:
- Natively usable by AI agents via MCP
- Anonymous at the payment layer (no account, no identity)
- Cryptographically private at the query layer (not just "we promise not to log")
- Storing results in user-owned encrypted storage

MeshSearch builds all four.

---

## Core Insight

Most "private search" tools move surveillance from Google to themselves. They still receive your plaintext query — you've just changed who you're trusting. MeshSearch removes the need to trust anyone by committing queries client-side using ZK before they ever leave the user's device.

---

## Architecture

The system has four layers. Each layer solves one distinct privacy problem.

```
┌──────────────────────────────────────────────┐
│            User / AI Agent                   │
│                                              │
│  Query committed locally via ZK              │
│  Raw query never leaves this layer           │
└────────────────────┬─────────────────────────┘
                     │  ZK proof + encrypted query blob
                     │  x402 micropayment (no identity)
┌────────────────────▼─────────────────────────┐
│            MeshSearch MCP Server             │
│                                              │
│  Verifies ZK proof — never sees raw query    │
│  Checks x402 payment or ENS subscription     │
│  Stores nullifier onchain (anti-replay)      │
└────────────────────┬─────────────────────────┘
                     │  Encrypted query blob
┌────────────────────▼─────────────────────────┐
│         ENS-Named Relay Network              │
│                                              │
│  relay1.meshsearch.eth                       │
│  relay2.meshsearch.eth                       │
│  relay3.meshsearch.eth                       │
│                                              │
│  3-hop routing — each relay knows only       │
│  previous and next hop, never full path      │
│  Relay operators earn x402 payment split     │
│  Reputation tracked onchain by ENS name      │
└────────────────────┬─────────────────────────┘
                     │  Decrypted only here
┌────────────────────▼─────────────────────────┐
│         Self-Hosted Search Backend           │
│                                              │
│  SearXNG — only node that decrypts query     │
│  Aggregates results across providers         │
│  Result hash stored onchain for integrity    │
│  Zero logs by design                         │
└────────────────────┬─────────────────────────┘
                     │  Results + integrity proof
┌────────────────────▼─────────────────────────┐
│         Fileverse Encrypted Storage          │
│                                              │
│  Query commitment + result saved to IPFS     │
│  Encrypted with user's wallet key            │
│  Only user can decrypt their history         │
│  Accessible via Fileverse MCP                │
└──────────────────────────────────────────────┘
```

---

## ZK Primitives

### 1. Query Commitment
The user hashes their query with a random salt client-side before the request is sent. The MCP server receives only this commitment — a hash — never the raw text. The search backend receives an asymmetrically encrypted version of the query that only it can decrypt. No intermediate layer (MCP server, relay nodes) ever sees the plaintext query.

### 2. Payment Unlinking via Nullifiers
Each search payment generates a unique nullifier using Semaphore. The nullifier is stored onchain after use to prevent replay attacks. Crucially, the nullifier is not linked to the user's wallet — an observer watching the blockchain cannot connect a wallet address to a search event. This is the same pattern Tornado Cash used for anonymous withdrawals, applied to search payments.

### 3. ZK Authorization Proof
Users prove they are authorized to search (paid, or hold an ENS subscription) without revealing their identity. The MCP server verifies the proof onchain and proceeds. No account. No login. No linkable identifier.

### 4. Result Integrity Proof
After search completes, the result set is hashed and stored onchain. This creates a tamper-evident record — anyone can verify that the results returned to the user match what the search backend produced. Agents can trust their search results are not manipulated.

---

## ENS Integration

ENS serves two roles in MeshSearch that go beyond simple naming.

**Relay Identity and Reputation**
Each relay node is registered under a subdomain of `meshsearch.eth`. Relay operators stake their ENS reputation on honest behavior. The smart contract tracks a reputation score per ENS name, updated after each routing event. The routing algorithm selects the top three relays by reputation score for every request. A relay that tampers with traffic or goes offline loses its onchain score — creating a cryptoeconomic incentive for honest operation without any centralized oversight.

**Subscription Access**
Users holding an ENS name are automatically granted a premium search tier without any payment per query. The MCP server resolves the connected wallet's ENS name and grants access accordingly. No account creation, no API key, no email — ENS name is the identity and the access credential.

---

## x402 Payment Flow

x402 is an HTTP-native payment protocol. When a user without an ENS subscription calls the search tool, the server returns a `402 Payment Required` response with a payment address and amount on Base. The client (agent wallet or user wallet) pays the micropayment automatically. The server verifies payment onchain and proceeds.

The payment is then split between the three relay nodes that handled the request via an onchain splitter contract. Relay operators earn passively for providing routing infrastructure. The user never creates an account. The payment is not linked to the query by design.

---

## Fileverse Integration

Every search produces two artifacts: a query commitment and a result. Both are saved as an encrypted entry in a Fileverse document stored on IPFS. The document is encrypted with the user's wallet key — Fileverse cannot read it, the MCP server cannot read it, nobody can read it except the user.

This gives users a private, portable, permanent search history that no company owns. Agents can also compile multiple searches into a structured research report saved as a Fileverse document, shareable via wallet address with no intermediary.

This is the direct inverse of Google Workspace — collaboration and history without surveillance.

---

## Components

### Smart Contracts (Base L2)
- **NodeRegistry** — relay node registration, ENS name linking, reputation scores
- **NullifierRegistry** — stores used nullifiers to prevent search replay
- **PaymentSplitter** — distributes x402 payments to relay operators
- **AccessControl** — ENS subscription tier management

### MCP Server
Exposes three tools to any MCP-compatible AI agent:
- `private_search` — execute a private search with ZK proof + x402 payment
- `get_history` — retrieve and decrypt search history from Fileverse
- `compile_report` — aggregate multiple searches into an encrypted Fileverse document

### Relay Nodes
Three lightweight HTTP servers registered onchain with ENS names. Each relay forwards an encrypted request blob to the next hop. No relay can read the query. Each earns a share of the x402 payment per routing event.

### Search Backend
Self-hosted SearXNG instance. The only component that decrypts and executes the query. Aggregates results from multiple providers. Produces a result hash stored onchain. No query logs.

### Dashboard
A Next.js frontend for human users. Shows relay network status and ENS reputation scores, payment flow visualization, and a wallet-gated history viewer that decrypts Fileverse entries client-side.

---

## Repository Structure

```
meshsearch/
├── contracts/
│   ├── NodeRegistry.sol
│   ├── NullifierRegistry.sol
│   ├── PaymentSplitter.sol
│   └── AccessControl.sol
│
├── mcp-server/
│   ├── tools/          — search, history, report tool definitions
│   ├── middleware/     — ZK verification, x402, ENS resolution
│   └── relay/          — relay selection + routing client
│
├── relay-node/         — lightweight relay HTTP server
│
├── search-backend/     — SearXNG wrapper + result hashing
│
├── fileverse/          — encrypted history + report storage
│
├── dashboard/          — Next.js UI
│   ├── pages/          — search, history, relay network
│   └── components/     — relay map, payment indicator, history viewer
│
└── scripts/
    ├── deploy.ts           — contract deployment to Base Sepolia
    ├── setupENS.ts         — register relay ENS subdomains
    └── registerRelays.ts
```

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 20
- **pnpm** ≥ 9
- **Docker** (for SearXNG)

### 1. Install dependencies

```bash
pnpm install
```

### 2. Start SearXNG (search engine)

```bash
docker run -d --name meshsearch-searxng -p 8888:8080 \
  -e SEARXNG_BASE_URL=http://localhost:8888 \
  searxng/searxng:latest
```

### 3. Start a local Hardhat blockchain node

```bash
cd packages/contracts
npx hardhat node &
```

### 4. Deploy smart contracts

```bash
cd packages/contracts
npx hardhat run scripts/deploy.ts --network localhost
```

Copy the printed contract addresses into `apps/mcp-server/.env`.

### 5. Generate key pairs (if starting fresh)

```bash
# From the crypto package directory:
cd packages/crypto
node -e "
import('@noble/curves/secp256k1.js').then(({ secp256k1 }) => {
  import('@noble/hashes/utils').then(({ bytesToHex, randomBytes }) => {
    const priv = randomBytes(32);
    console.log('PRIVATE_KEY=' + bytesToHex(priv));
    console.log('PUBLIC_KEY=' + bytesToHex(secp256k1.getPublicKey(priv, true)));
  });
});
"
```

Generate one pair for the search backend and one for each relay node. Update the `.env` files accordingly (see `.env.example` for the full configuration format).

### 6. Start all services

```bash
# Terminal 1 — Search backend
cd apps/search-backend && pnpm dev

# Terminal 2 — Relay node 1
cd apps/relay-node && PORT=4002 pnpm dev

# Terminal 3 — Relay node 2
cd apps/relay-node && PORT=4003 RELAY_ENS_NAME=relay2.meshsearch.eth \
  RELAY_PRIVATE_KEY=<relay2-private-key> pnpm dev

# Terminal 4 — Relay node 3
cd apps/relay-node && PORT=4004 RELAY_ENS_NAME=relay3.meshsearch.eth \
  RELAY_PRIVATE_KEY=<relay3-private-key> pnpm dev

# Terminal 5 — Fileverse storage
cd apps/fileverse && pnpm dev

# Terminal 6 — MCP server (HTTP mode)
cd apps/mcp-server && pnpm dev
```

### 7. Test the MCP server

```bash
curl -s http://localhost:3038/mcp -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq .
```

### 8. Connect to Claude Desktop / Cursor

Add to your MCP config (e.g. `~/.config/claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "meshsearch": {
      "command": "node",
      "args": ["apps/mcp-server/dist/index.js"],
      "cwd": "/path/to/MeshSearch"
    }
  }
}
```

### 9. Run all tests

```bash
pnpm turbo test
```

---

## Tech Stack

| Layer | Tools |
|---|---|
| **ZK** | Semaphore v4 (`@semaphore-protocol/core`) — real Groth16 proofs, Poseidon hashing |
| **Crypto** | `@noble/curves` (secp256k1 ECDH), `@noble/hashes` (HKDF, SHA-256, AES-256-GCM) |
| **Blockchain** | Solidity, Base L2, Hardhat, ethers v6 |
| **Identity** | ENS SDK, SIWE |
| **Payments** | x402 (`@x402/core`, `@x402/evm`), USDC on Base |
| **MCP** | `@modelcontextprotocol/sdk` (Node.js, HTTP + stdio transport) |
| **Search** | SearXNG (self-hosted), Brave Search API |
| **Storage** | Content-addressed file storage (persistent, SHA-256 CIDs) |
| **Frontend** | Next.js, Tailwind |

---

## 42-Hour Build Plan

### Hours 0–6: Foundation
- Deploy contracts to Base Sepolia
- MCP server skeleton with `private_search` tool
- SearXNG running locally

### Hours 6–16: Core Privacy Layer
- Poseidon query commitment client-side
- Semaphore nullifier generation + onchain verification
- x402 payment middleware working end to end

### Hours 16–24: Relay Network
- Three relay nodes running with ENS subdomains
- 3-hop routing with encrypted query blob
- Payment splitting to relay operators onchain

### Hours 24–32: Storage + Identity
- Fileverse encrypted history saving after each search
- ENS subscription tier check in MCP server
- Result hash stored onchain after search

### Hours 32–38: Dashboard
- Relay network status with ENS names + reputation scores
- Wallet-gated history viewer (Fileverse decrypt client-side)
- x402 payment flow visualization

### Hours 38–42: Demo + Pitch
- End-to-end demo flow rehearsed
- Presentation ready
- README finalized

---

## Demo Flow

```
1. Configure Claude Desktop with MeshSearch MCP
2. Ask Claude to research any topic
3. MCP intercepts — show ZK proof generated client-side
4. Show x402 payment on Base explorer (no identity linked)
5. Show 3 ENS-named relay hops in dashboard
6. Results returned to Claude
7. Result hash visible on Base explorer
8. Open history viewer — wallet-sign to decrypt Fileverse entries
9. Show zero logs on MCP server terminal
```

Every step is visual, verifiable, and tells the privacy story without explanation.

---

## Prize Tracks

| Sponsor | Track | Why We Qualify |
|---|---|---|
| **HeyElsa** | Best Use of x402 + OpenClaw | x402 is the core anonymous payment layer |
| **HeyElsa** | Real World SDK Problems | Private agent search is an immediate real-world need |
| **ENS** | Best Creative Use | ENS as relay reputation infrastructure — not just naming |
| **ENS** | Pool Prize | Multiple ENS integrations (relay names + subscriptions) |
| **Fileverse** | Build What Big Tech Won't | Encrypted user-owned search history — Google's anti-thesis |
| **Base** | Privacy | ZK + anonymous payments running on Base |
| **Base** | AI × Onchain | AI agents paying onchain for private search via MCP |
| **ETHMumbai** | Privacy Track | ZK query commitments + nullifier unlinking |
| **ETHMumbai** | AI Track | MCP-native, works with any AI agent out of the box |

---

## One-Line Pitch

> *MeshSearch is a private web search MCP — queries are committed with ZK proofs before leaving the device, payments are anonymous via x402, routing is handled by ENS-named relay nodes with onchain reputation, and history is encrypted on Fileverse. Cryptographic privacy, not promises.*

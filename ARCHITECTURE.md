# MeshSearch — Architecture

Technical deep-dive into the privacy architecture, cryptographic primitives, protocol flows, and system design.

---

## System Overview

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

The system has four layers. Each layer solves one distinct privacy problem:

1. **Client layer** — ZK commitment ensures the raw query never leaves the device
2. **MCP server** — verifies proofs and payments without seeing query content
3. **Relay network** — 3-hop onion routing hides traffic origin from the search backend
4. **Storage** — encrypted on Fileverse, only the user can decrypt

---

## ZK Primitives

### 1. Query Commitment

The user hashes their query with a random salt client-side before the request is sent. The MCP server receives only this commitment (a Poseidon hash) — never the raw text. The search backend receives an asymmetrically encrypted version of the query that only it can decrypt via secp256k1 ECDH.

No intermediate layer (MCP server, relay nodes) ever sees the plaintext query.

**Implementation:** `packages/crypto/src/commitment.ts`

```
commitment = PoseidonHash(query || salt)
encrypted_query = ECDH(ephemeral_key, backend_public_key) → AES-256-GCM(query)
```

### 2. Payment Unlinking via Nullifiers

Each search generates a unique nullifier using Semaphore v4. The nullifier is stored onchain after use to prevent replay attacks. Crucially, the nullifier is **not linked to the user's wallet** — an observer watching the blockchain cannot connect a wallet address to a search event.

This is the same pattern Tornado Cash used for anonymous withdrawals, applied to search payments.

**Implementation:** `packages/crypto/src/semaphore.ts`, `packages/contracts/contracts/NullifierRegistry.sol`

### 3. ZK Authorization Proof

Users prove they are authorized to search (paid, or hold an ENS subscription) without revealing their identity. The MCP server verifies the Groth16 proof onchain and proceeds. No account. No login. No linkable identifier.

**Implementation:** `apps/mcp-server/src/middleware/zk-verification.ts`

- 5-second timeout on onchain verification
- Falls back to in-memory nullifier tracking when RPC is unavailable
- Prevents double-spend without revealing caller identity

### 4. Result Integrity Proof

After search completes, the result set is hashed (SHA-256) and stored onchain. This creates a tamper-evident record — anyone can verify that the results returned to the user match what the search backend produced.

---

## Cryptographic Stack

| Primitive | Library | Usage |
|---|---|---|
| secp256k1 ECDH | `@noble/curves` | Asymmetric query encryption between client and search backend |
| AES-256-GCM | `@noble/hashes` (via HKDF) | Symmetric encryption of query blobs and relay payloads |
| Poseidon hash | `@semaphore-protocol/core` | Query commitment (ZK-friendly hash) |
| Groth16 proofs | Semaphore v4 | Anonymous authorization proofs |
| SHA-256 | `@noble/hashes` | Result integrity hashing, content-addressed storage |
| HKDF | `@noble/hashes` | Key derivation from ECDH shared secrets |

All crypto runs in pure JavaScript — no native dependencies, no WASM.

**Key packages:** `packages/crypto/src/encryption.ts` (ECDH + AES), `packages/crypto/src/commitment.ts` (Poseidon), `packages/crypto/src/semaphore.ts` (ZK proofs)

---

## Onion Relay Routing

The relay network provides unlinkability between the user and the search backend. No single relay knows both who is searching and what they're searching for.

### How it works

1. The MCP server selects the top 3 relays by onchain reputation score
2. Query is encrypted in layers: `E(relay3_key, E(relay2_key, E(relay1_key, search_request)))`
3. Each relay peels one layer, sees only the next hop address, and forwards
4. Only the final relay (exit node) can decrypt and forward to the search backend
5. Responses travel back through the same path in reverse

### Relay selection

Relays are registered onchain in `NodeRegistry.sol` with ENS subdomains:
- `relay1.meshsearch.eth`
- `relay2.meshsearch.eth`
- `relay3.meshsearch.eth`

The routing algorithm (`apps/mcp-server/src/relay/routing.ts`) selects relays by reputation score. A relay that tampers with traffic or goes offline loses its onchain score.

### Relay key exchange

Each relay has a secp256k1 key pair. The MCP server knows all relay public keys (from `RELAY_ENDPOINTS` config). ECDH is used to derive per-session symmetric keys for each layer of encryption.

---

## x402 Payment Protocol

MeshSearch uses [x402](https://x402.org) — an HTTP-native payment protocol by Coinbase — for anonymous per-search micropayments.

### Flow

```
Client                        MCP Server                    Facilitator
  │                               │                              │
  │  tools/call (no payment)      │                              │
  │──────────────────────────────>│                              │
  │                               │                              │
  │  402 + PAYMENT-REQUIRED       │                              │
  │<──────────────────────────────│                              │
  │                               │                              │
  │  (signs USDC authorization)   │                              │
  │                               │                              │
  │  tools/call + PAYMENT-SIGNATURE                              │
  │──────────────────────────────>│                              │
  │                               │  verify + settle             │
  │                               │─────────────────────────────>│
  │                               │                              │
  │                               │  PAYMENT-RESPONSE (tx hash)  │
  │                               │<─────────────────────────────│
  │                               │                              │
  │  200 + results + PAYMENT-RESPONSE                            │
  │<──────────────────────────────│                              │
```

### Implementation details

- **Middleware:** `apps/mcp-server/src/middleware/x402-payment.ts`
- **Gate:** Only `tools/call` JSON-RPC method requires payment. `initialize`, `tools/list`, and notifications pass through free.
- **Body buffering:** POST body is read once and cached, then JSON-RPC method is peeked before routing to the x402 gate or MCP handler.
- **Headers (x402 v2):**
  - `PAYMENT-REQUIRED` — server → client (402 response)
  - `PAYMENT-SIGNATURE` — client → server (signed USDC authorization)
  - `PAYMENT-RESPONSE` — server → client (settlement receipt with tx hash)
- **Facilitator:** `https://x402.org/facilitator` (Coinbase's public service handles verification + on-chain settlement)
- **Config:** `X402_ENABLED`, `X402_PAY_TO`, `X402_SEARCH_PRICE`, `X402_NETWORK` env vars

### Settlement

Payments settle on Base Sepolia as USDC transfers. The `PAYMENT-RESPONSE` header contains the transaction hash, viewable on [BaseScan](https://sepolia.basescan.org).

The payment is then split between relay operators via the `PaymentSplitter` contract. Relay operators earn passively for providing routing infrastructure.

---

## ENS Integration

ENS serves two roles beyond simple naming.

### Relay Identity & Reputation

Each relay node is registered under a subdomain of `meshsearch.eth`. The `NodeRegistry` contract tracks a reputation score per ENS name, updated after each routing event. Relays that tamper or go offline lose their score — cryptoeconomic incentive for honest operation.

### Subscription Access

Users holding an ENS name get a premium search tier without per-query payment. The MCP server resolves the connected wallet's ENS name and grants access. No account, no API key — ENS name is both identity and credential.

**Contract:** `packages/contracts/contracts/AccessControl.sol`

---

## Fileverse Storage

Every search produces two artifacts: a query commitment and a result. Both are saved as an encrypted entry in a Fileverse document.

- Encrypted with the user's wallet key (AES-256-GCM)
- Content-addressed storage (SHA-256 CIDs)
- Nobody can read it except the user — not Fileverse, not the MCP server
- Users get a private, portable, permanent search history that no company owns
- Agents can compile multiple searches into a Fileverse research report, shareable via wallet address

**Implementation:** `apps/fileverse/src/index.ts`

---

## Smart Contracts

Four Solidity contracts on Base L2, tested with Hardhat:

| Contract | Purpose | Key functions |
|---|---|---|
| `NodeRegistry` | Relay registration, ENS name linking, reputation scores | `registerNode()`, `updateReputation()`, `getTopNodes()` |
| `NullifierRegistry` | Stores used nullifiers to prevent search replay | `recordNullifier()`, `isNullifierUsed()` |
| `PaymentSplitter` | Distributes x402 payments to relay operators | `split()` with per-relay share |
| `AccessControl` | ENS subscription tier management | `checkAccess()`, `grantTier()` |

**Source:** `packages/contracts/contracts/`
**Tests:** `packages/contracts/test/` (Hardhat + ethers v6)
**Deploy:** `packages/contracts/scripts/deploy.ts`

---

## MCP Server Architecture

The server (`apps/mcp-server/src/index.ts`) supports two transport modes:

### HTTP Mode (default)

- Listens on `0.0.0.0:3038` (configurable via `PORT` / `MCP_HOST`)
- Endpoint: `POST /mcp` (JSON-RPC), `GET /mcp` (SSE), `DELETE /mcp` (session cleanup)
- Stateful sessions via `mcp-session-id` header
- x402 gate on `tools/call` only

### stdio Mode

- For direct Claude Desktop / Cursor integration
- No HTTP, no x402 — auth handled by the client wrapper

### Request lifecycle

```
POST /mcp
  │
  ├─ Read + buffer body
  ├─ Peek at JSON-RPC method
  │
  ├─ method = "tools/call"?
  │    ├─ YES → x402 gate
  │    │    ├─ No PAYMENT-SIGNATURE → 402 + PAYMENT-REQUIRED header
  │    │    └─ Has PAYMENT-SIGNATURE → verify with facilitator → merge settlement headers → continue
  │    │
  │    └─ NO → pass through (initialize, tools/list, notifications)
  │
  └─ Route to MCP transport handler
       └─ Dispatch to tool implementation
            ├─ private_search: ZK verify → relay route → search → store → return
            ├─ get_history: decrypt Fileverse entries → return
            └─ compile_report: aggregate → encrypt → store → return
```

---

## Services

| Service | Default Port | Package | Description |
|---|---|---|---|
| SearXNG | 8888 | Docker | Self-hosted metasearch engine |
| Search Backend | 4001 | `apps/search-backend` | SearXNG wrapper + result hashing |
| Relay 1 | 4002 | `apps/relay-node` | Onion routing hop |
| Relay 2 | 4003 | `apps/relay-node` | Onion routing hop |
| Relay 3 | 4004 | `apps/relay-node` | Onion routing hop |
| Fileverse | 4005 | `apps/fileverse` | Encrypted document storage |
| MCP Server | 3038 | `apps/mcp-server` | Main entry point (x402 + MCP) |
| Dashboard | 3000 | `apps/dashboard` | Next.js UI (optional) |

All services bind to `0.0.0.0` for LAN / Tailscale access.

---

## Demo Client

`apps/mcp-server/demo.mjs` — an interactive CLI client that demonstrates the full protocol:

1. Loads a crypto wallet (viem + `toClientEvmSigner` from `@x402/evm`)
2. Displays wallet address, chain, ETH + USDC balance
3. Initializes an MCP session
4. For each search query:
   - Sends `tools/call` without payment → gets 402 + price quote
   - Signs USDC authorization via `x402HTTPClient`
   - Re-sends with `PAYMENT-SIGNATURE` header → gets 200 + results
   - Decodes `PAYMENT-RESPONSE` settlement header → shows BaseScan tx link
5. Displays privacy pipeline steps (ZK proof, nullifier, relay hops, encrypted storage)

### Modes

- **Interactive REPL:** `node demo.mjs` — type queries, check balance, etc.
- **Single query:** `node demo.mjs "your search query"` — run one search and exit

---

## Privacy Threat Model

| Threat | Mitigation |
|---|---|
| Search engine logs your query | SearXNG is self-hosted with zero logs; query arrives encrypted |
| MCP server sees your query | Server only sees Poseidon commitment hash, not plaintext |
| Payment linked to query | Semaphore nullifiers unlink wallet from search events |
| Network observer sees traffic | 3-hop onion routing; each relay knows only prev/next hop |
| Storage provider reads history | Fileverse entries encrypted with user's wallet key |
| Relay operator tampers | Onchain reputation tracking; bad actors lose score |
| Replay attack | Nullifiers stored onchain; used nullifiers are rejected |
| Result manipulation | Result hash stored onchain for tamper-evident verification |

---

## Monorepo Structure

```
MeshSearch/
├── apps/
│   ├── mcp-server/              Main MCP server
│   │   ├── src/
│   │   │   ├── index.ts         HTTP/stdio server, x402 gate, session management
│   │   │   ├── config.ts        Environment variable loading
│   │   │   ├── tools/
│   │   │   │   ├── private-search.ts   ZK → relay → search → store pipeline
│   │   │   │   ├── get-history.ts      Decrypt Fileverse entries
│   │   │   │   └── compile-report.ts   Aggregate into research report
│   │   │   ├── middleware/
│   │   │   │   ├── x402-payment.ts     x402 verification + 402 responses
│   │   │   │   └── zk-verification.ts  Semaphore proof verification + nullifier check
│   │   │   ├── relay/
│   │   │   │   └── routing.ts          Relay selection + onion encryption
│   │   │   └── fileverse/
│   │   │       └── client.ts           Fileverse storage client
│   │   ├── demo.mjs             Interactive x402 demo client
│   │   ├── test-x402.mjs        Automated x402 flow test
│   │   └── test/                Unit tests (x402, ZK middleware)
│   ├── relay-node/              Lightweight relay HTTP servers
│   │   ├── src/index.ts         Relay logic (decrypt layer, forward, encrypt response)
│   │   └── test/relay.test.ts
│   ├── search-backend/          SearXNG wrapper
│   │   ├── src/index.ts         Query decryption, SearXNG proxy, result hashing
│   │   └── test/search.test.ts
│   ├── fileverse/               Encrypted document storage
│   │   ├── src/index.ts         Content-addressed store with AES encryption
│   │   └── test/storage.test.ts
│   └── dashboard/               Next.js frontend
│       └── src/
│           ├── app/             Pages (search, history, payments)
│           └── components/      Relay map, network stats
├── packages/
│   ├── contracts/               Solidity smart contracts
│   │   ├── contracts/           .sol files
│   │   ├── test/                Hardhat tests
│   │   ├── scripts/deploy.ts    Deployment script
│   │   └── typechain-types/     Generated TypeScript bindings
│   ├── crypto/                  Cryptographic primitives
│   │   ├── src/
│   │   │   ├── encryption.ts    secp256k1 ECDH + AES-256-GCM
│   │   │   ├── commitment.ts    Poseidon query commitment
│   │   │   ├── semaphore.ts     Semaphore ZK proof generation/verification
│   │   │   └── index.ts
│   │   └── test/                Encryption + commitment tests
│   └── types/                   Shared TypeScript interfaces
│       └── src/                 contracts, payment, relay, search, storage, zk types
└── scripts/
    └── setup.ts                 Interactive setup & launcher
```

**Build system:** pnpm workspaces + Turborepo. `pnpm build` builds all packages in dependency order. `pnpm turbo test` runs all 95+ tests.

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
- Fails fast if Base Sepolia RPC or contract config is unavailable
- Optional in-memory fallback is test/dev-only via `MESHSEARCH_ALLOW_INMEMORY_FALLBACK=true`

### 4. Result Integrity Proof

After search completes, the result set is hashed (SHA-256) and stored onchain. This creates a tamper-evident record — anyone can verify that the results returned to the user match what the search backend produced.

---

## Cryptographic Stack

| Primitive      | Library                    | Usage                                                         |
| -------------- | -------------------------- | ------------------------------------------------------------- |
| secp256k1 ECDH | `@noble/curves`            | Asymmetric query encryption between client and search backend |
| AES-256-GCM    | `@noble/hashes` (via HKDF) | Symmetric encryption of query blobs and relay payloads        |
| Poseidon hash  | `@semaphore-protocol/core` | Query commitment (ZK-friendly hash)                           |
| Groth16 proofs | Semaphore v4               | Anonymous authorization proofs                                |
| SHA-256        | `@noble/hashes`            | Result integrity hashing, content-addressed storage           |
| HKDF           | `@noble/hashes`            | Key derivation from ECDH shared secrets                       |

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

The payment is then split between relay operators via the `PaymentSplitter` contract or BitGo stealth-address disbursement. Relay operators earn passively for providing routing infrastructure.

---

## BitGo Wallet Integration

MeshSearch uses [BitGo's wallet infrastructure](https://developers.bitgo.com/) for privacy-preserving payment disbursement. BitGo provides the wallet layer; x402 provides the HTTP payment protocol. Together they create a stealth-address payment system where no on-chain observer can link search payments to relay operators.

### Stealth-Address Pattern

The core privacy mechanism: **fresh, unlinkable BitGo addresses per transaction**.

```
x402 Settlement (search payment confirmed)
   │
   ├─ Generate fresh BitGo address for relay1.meshsearch.eth
   ├─ Generate fresh BitGo address for relay2.meshsearch.eth
   ├─ Generate fresh BitGo address for relay3.meshsearch.eth
   │
   └─ wallet.sendMany() → single tx, 4 recipients (3 relays + protocol)
       ├─ relay1: 0xABC...123  (unique, never reused)
       ├─ relay2: 0xDEF...456  (unique, never reused)
       ├─ relay3: 0x789...012  (unique, never reused)
       └─ protocol: fixed fee address
```

An observer watching the blockchain sees payments going to different addresses each time. They **cannot** determine that relay1 from search A is the same operator as relay1 from search B — the addresses are cryptographically unlinkable.

### Architecture

```
┌──────────────────────────────────────────────────────┐
│                BitGo Wallet Layer                    │
│                                                      │
│  Treasury Wallet (self-custody MPC hot)              │
│  ├─ Receives x402 payment settlements               │
│  ├─ Generates fresh address per search               │
│  └─ Disburses to relay operators via sendMany        │
│                                                      │
│  Relay Operator Wallets (one per relay)              │
│  ├─ Fresh receive address per disbursement           │
│  ├─ Operator withdraws → own address (off-protocol) │
│  └─ On-chain trace: N unique unlinked addresses      │
│                                                      │
│  Policy Engine (BitGo server-side)                   │
│  ├─ Velocity limit: max spend per day                │
│  ├─ Whitelist: only relay addresses allowed          │
│  └─ Survives MCP server compromise                   │
│                                                      │
│  Webhooks                                            │
│  ├─ Payment confirmed → trigger search               │
│  ├─ Disbursement confirmed → audit trail             │
│  └─ Policy triggered → alert                         │
└──────────────────────────────────────────────────────┘
```

### Implementation

| Component | File | Purpose |
|---|---|---|
| SDK Client | `apps/mcp-server/src/bitgo/client.ts` | Wallet init, address generation, transaction sending, `isBitGoEnabled()` |
| Stealth Disbursement | `apps/mcp-server/src/bitgo/stealth-disbursement.ts` | Fresh-address splits to relay operators |
| Webhooks | `apps/mcp-server/src/bitgo/webhooks.ts` | HMAC-SHA256 validated payment confirmation handler |
| Policies | `apps/mcp-server/src/bitgo/policies.ts` | Velocity limits, whitelists via BitGo policy API |
| Health endpoint | `apps/mcp-server/src/index.ts` `/health` | Returns `{ bitgo: { status, env, coin, walletId, expressUrl, relayWallets } }` |
| Health proxy | `apps/web/src/app/api/health/route.ts` | Next.js route — proxies MCP health; exports `BitGoHealthInfo`, `HealthResponse` types |
| Chat UI | `apps/web/src/app/chat/page.tsx` | `useBitGoStatus` hook, `StealthDisbursementCard`, payment card pre-flight info |

### Web UI Components

The chat interface surfaces the entire BitGo integration visually:

1. **Header badge** — `useBitGoStatus()` React hook polls `GET /api/health` every 15 seconds. Renders a pulsing emerald badge showing coin name (e.g., `HTETH`) when BitGo is enabled.

2. **Payment card pre-flight** — before the user signs the x402 USDC payment, an emerald info panel explains: “After payment, BitGo MPC wallets disburse to relay operators via fresh stealth addresses — each relay gets a unique, unlinkable address per search.”

3. **`StealthDisbursementCard`** — rendered inside every successful search result. Shows:
   - Visual flow: `USDC → [Treasury 0x…] → { relay1.eth → 0x????..???? | relay2.eth → 0x????..???? | relay3.eth → 0x????..???? }`
   - Each relay’s address derived deterministically from the search nullifier (no flicker on re-render)
   - Actual BitGo stealth address from the `BitGo stealth address:` metadata field when present
   - Privacy explainer: stealth-address unlinkability guarantee

4. **Pipeline badge** — `BitGo Stealth` appears in the privacy pipeline row alongside `ZK Proof`, `3-Hop Relay`, and `USDC Settled`.

5. **MCP Inspector** (`/mcp` route) — footer badge showing `BitGo enabled/disabled/unknown`.

### Health Endpoint Response

`GET /health` on the MCP server returns:

```json
{
  "status": "ok",
  "transport": "http",
  "sessions": 2,
  "bitgo": {
    "status": "enabled",
    "env": "test",
    "coin": "hteth",
    "walletId": "69b5a463…",
    "expressUrl": "http://localhost:3080",
    "relayWallets": 3
  }
}
```

When BitGo is disabled: `"bitgo": { "status": "disabled" }`.

The Next.js `/api/health` proxy forwards this verbatim to the browser, using the typed `BitGoHealthInfo` and `HealthResponse` interfaces.

### Configuration

```env
BITGO_ACCESS_TOKEN=<token from app.bitgo-test.com>
BITGO_WALLET_ID=<treasury wallet ID>
BITGO_WALLET_PASSPHRASE=<wallet passphrase>
BITGO_ENV=test
BITGO_COIN=hteth
BITGO_EXPRESS_URL=http://localhost:3080  # BitGo Express for key management
BITGO_WEBHOOK_SECRET=<shared secret>
RELAY1_BITGO_WALLET_ID=<relay 1 wallet>
RELAY2_BITGO_WALLET_ID=<relay 2 wallet>
RELAY3_BITGO_WALLET_ID=<relay 3 wallet>
```

### Testnet Setup

1. Create account at [app.bitgo-test.com](https://app.bitgo-test.com/signup)
2. Create access token in account settings
3. Run BitGo Express: `docker run -p 3080:3080 bitgo/express:latest`
4. Create wallets via Express: `POST http://localhost:3080/api/v2/hteth/wallet/generate` with `{ "walletVersion": 3, "label": "...", "passphrase": "..." }` (walletVersion 3 is required for EVM TSS)
5. Fund treasury from [Holesky faucet](https://holesky-faucet.pk910.de/)
6. Set env vars and restart MCP server
7. Or run `pnpm run:setup` and follow the Step 5c interactive BitGo prompts

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

| Contract            | Purpose                                                 | Key functions                                           |
| ------------------- | ------------------------------------------------------- | ------------------------------------------------------- |
| `NodeRegistry`      | Relay registration, ENS name linking, reputation scores | `registerNode()`, `updateReputation()`, `getTopNodes()` |
| `NullifierRegistry` | Stores used nullifiers to prevent search replay         | `recordNullifier()`, `isNullifierUsed()`                |
| `PaymentSplitter`   | Distributes x402 payments to relay operators            | `split()` with per-relay share                          |
| `AccessControl`     | ENS subscription tier management                        | `checkAccess()`, `grantTier()`                          |

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
| -------------- | ------------ | --------------------- | -------------------------------- |
| SearXNG | 8888 | Docker | Self-hosted metasearch engine |
| Search Backend | 4001 | `apps/search-backend` | SearXNG wrapper + result hashing |
| Relay 1 | 4002 | `apps/relay-node` | Onion routing hop |
| Relay 2 | 4003 | `apps/relay-node` | Onion routing hop |
| Relay 3 | 4004 | `apps/relay-node` | Onion routing hop |
| Fileverse | 4005 | `apps/fileverse` | Encrypted document storage |
| MCP Server | 3038 | `apps/mcp-server` | Main entry point (x402 + MCP + BitGo) |
| BitGo Express | 3080 | Docker (`bitgo/express`) | Local MPC key management for BitGo wallets |
| Web App | 3000 | `apps/web` | Next.js UI (chat, x402, BitGo status badges) |
| Dashboard | 3001 | `apps/dashboard` | Relay map, network stats (optional) |

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
| ------------------------------ | -------------------------------------------------------------- |
| Search engine logs your query | SearXNG is self-hosted with zero logs; query arrives encrypted |
| MCP server sees your query | Server only sees Poseidon commitment hash, not plaintext |
| Payment linked to query | Semaphore nullifiers unlink wallet from search events |
| Network observer sees traffic | 3-hop onion routing; each relay knows only prev/next hop |
| Storage provider reads history | Fileverse entries encrypted with user's wallet key |
| Relay operator tampers | Onchain reputation tracking; bad actors lose score |
| Replay attack | Nullifiers stored onchain; used nullifiers are rejected |
| Result manipulation | Result hash stored onchain for tamper-evident verification |
| Payment links relay identity | BitGo fresh stealth address per disbursement — relay payments are unlinkable across searches |

---

## Monorepo Structure

```
MeshSearch/
├── apps/
│   ├── mcp-server/              Main MCP server
│   │   ├── src/
│   │   │   ├── index.ts         HTTP/stdio server, x402 gate, session management, /health endpoint
│   │   │   ├── config.ts        Environment variable loading (incl. BitGo block)
│   │   │   ├── tools/
│   │   │   │   ├── private-search.ts   ZK → relay → search → BitGo stealth addr → store
│   │   │   │   ├── get-history.ts      Decrypt Fileverse entries
│   │   │   │   └── compile-report.ts   Aggregate into research report
│   │   │   ├── middleware/
│   │   │   │   ├── x402-payment.ts     x402 verification + 402 responses + BitGo disbursement trigger
│   │   │   │   └── zk-verification.ts  Semaphore proof verification + nullifier check
│   │   │   ├── bitgo/
│   │   │   │   ├── client.ts            SDK wrapper, isBitGoEnabled(), generateFreshAddress()
│   │   │   │   ├── stealth-disbursement.ts  Fan-out to relay wallets with fresh addresses
│   │   │   │   ├── webhooks.ts          HMAC-SHA256 validated webhook handler
│   │   │   │   ├── policies.ts          Velocity limits + address whitelists
│   │   │   │   └── index.ts             Barrel export
│   │   │   ├── relay/
│   │   │   │   └── routing.ts           Relay selection + onion encryption
│   │   │   └── fileverse/
│   │   │       └── client.ts            Fileverse storage client
│   │   ├── demo.mjs             Interactive x402 demo client
│   │   ├── test-x402.mjs        Automated x402 flow test
│   │   └── test/                Unit tests (x402, ZK middleware)
│   ├── web/                     Next.js browser UI
│   │   └── src/
│   │       ├── app/
│   │       │   ├── page.tsx             Landing page (BitGo feature card)
│   │       │   ├── chat/page.tsx        Chat UI — useBitGoStatus, StealthDisbursementCard
│   │       │   └── api/
│   │       │       ├── health/route.ts      BitGoHealthInfo proxy (BitGoHealthInfo, HealthResponse types)
│   │       │       ├── chat/route.ts        AI streaming endpoint
│   │       │       ├── paid-search/route.ts Post-payment search
│   │       │       ├── history/route.ts     History proxy
│   │       │       └── mcp-requests/route.ts Trace management
│   │       └── components/
│   │           ├── payment-handler.tsx  x402 USDC signing
│   │           └── mcp-request-inspector.tsx  /mcp debug view + BitGo status badge
│   ├── relay-node/              Lightweight relay HTTP servers
│   │   ├── src/index.ts         Relay logic (decrypt layer, forward, encrypt response)
│   │   └── test/relay.test.ts
│   ├── search-backend/          SearXNG wrapper
│   │   ├── src/index.ts         Query decryption, SearXNG proxy, result hashing
│   │   └── test/search.test.ts
│   ├── fileverse/               Encrypted document storage
│   │   ├── src/index.ts         Content-addressed store with AES encryption
│   │   └── test/storage.test.ts
│   └── dashboard/               Next.js frontend (relay map, network stats)
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
│       └── src/                 contracts, payment (BitGoWalletStatus, StealthAddress,
│                                BitGoDisbursementReceipt), relay, search, storage, zk
└── scripts/
    └── setup.ts                 Interactive setup & launcher (Step 5c: BitGo config)
```

**Build system:** pnpm workspaces + Turborepo. `pnpm build` builds all packages in dependency order. `pnpm turbo test` runs all 95+ tests.

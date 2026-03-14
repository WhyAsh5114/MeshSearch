# Prize Track Submissions

---

## Best Overall

MeshSearch is the only hackathon project that ships a **complete, trust-minimised search stack** — from ZK proof generation in the browser, through ENS-named onion routing, to on-chain micropayments and decentralised encrypted storage — all wired together as an MCP server any AI agent can use out of the box.

Every layer replaces a trusted intermediary with a cryptographic guarantee:

| What you'd normally trust | What MeshSearch does instead |
|---|---|
| Search provider not logging queries | ZK commitment before query leaves device |
| VPN provider not logging traffic | 3-hop onion routing through ENS-named relays |
| Payment processor not linking identity | x402 USDC micropayment — wallet signature only |
| Payment linked to relay operator | BitGo MPC fresh address per disbursement — stealth-address pattern |
| Cloud storage not reading your history | AES-256-GCM encrypted Fileverse dDocs — only your key decrypts |
| DNS / PKI not being compromised | ENS L1 resolution for all relay identities |

It's not a demo of one privacy primitive — it's a production-ready system where **six independent prize tracks' technologies work together as a coherent product**.

The browser UI surfaces every layer in real time: a live **BitGo MPC** status badge in the header, a payment card explaining the stealth-address disbursement before you sign, and a full visualisation of the USDC → Treasury → unique per-relay addresses after every successful search.

---

## ETHMumbai — Privacy

MeshSearch is private by construction — not by policy. Every layer of the stack replaces a trust assumption with a cryptographic guarantee, so no single party ever sees a user's plaintext query, traffic pattern, or search history.

**How it qualifies:**
- **ZK query commitment** — Every search is committed with a Semaphore v4 Groth16 proof before leaving the device. The relay network sees only the commitment, never the plaintext query.
- **Nullifier registry on-chain** — The `NullifierRegistry` contract on Base Sepolia prevents proof replay attacks, giving each search cryptographic uniqueness.
- **3-hop onion routing** — Traffic routes through ENS-named relay nodes; no single node knows both the origin and destination.
- **Encrypted history on Fileverse** — Search results are AES-256-GCM encrypted with the user's wallet key before storage. Not even the storage layer sees plaintext.
- **No accounts, no emails, no KYC** — A wallet signature is the only identity. x402 USDC micropayments settle on Base Sepolia without linking a user profile to a query.

---

## ETHMumbai — AI

MeshSearch ships as an **MCP server** — the native tool-calling protocol for AI agents. Any MCP-compatible agent (Claude, Cursor, etc.) can call `private_search` and get the full privacy stack automatically, with zero additional integration.

**How it qualifies:**
- **MCP server for AI agents** — Claude, Cursor, or any MCP-compatible agent can call `private_search` and get privacy guarantees that no existing search tool provides.
- **Agent-driven payment** — The AI agent's wallet signs a USDC EIP-3009 authorization; the x402 payment settles on Base Sepolia before the query executes. The agent handles the entire payment flow autonomously.
- **Streaming results with provenance** — Search results stream back to the agent with a `Routing:` field showing the ENS names of the relay operators and a Base Sepolia transaction hash — full auditability inside the chat context.
- **Encrypted research reports** — The `compile_report` MCP tool aggregates multiple search dDocs into a single encrypted research report stored on Fileverse, letting agents build long-running research workflows with persistent, private memory.
- **Core thesis** — When an AI agent searches the web on your behalf, it creates the same surveillance surface as you searching yourself — unless the protocol is private by construction. MeshSearch is that protocol.

---

## ENS — Best Creative Use

MeshSearch uses ENS as **infrastructure identity**, not user profiles. This is a genuinely novel application: relay nodes in a private routing network are named, discovered, and held accountable via ENS.

**How it qualifies:**
- `relay1.meshsearch.eth`, `relay2.meshsearch.eth`, `relay3.meshsearch.eth` are the canonical identifiers for the relay network — resolved on L1 at startup via `@ensdomains/ensjs` v4.
- Every search result includes a `Routing:` field showing the ENS names of the relay operators who handled the traffic — an **auditable privacy trail** anchored to ENS identity.
- The `NodeRegistry` contract maps ENS names to node public keys, ports, and reputation scores. Relay operators stake their ENS reputation on correct behaviour.
- x402 payment splits are distributed to relay operators identified by their ENS names — ENS becomes a payment routing identity, not just a username.

ENS here replaces DNS, certificate authorities, and operator registries simultaneously — all in a privacy-preserving routing network.

---

## ENS — Pool Prize

Direct ENS integration across the full stack:
- Real forward and reverse resolution via `@ensdomains/ensjs` v4 + viem `ensPublicActions`
- ENS names used in `NodeRegistry` contract for operator identity
- `checkENSSubscription` in the x402 middleware resolves ENS names on L1 to verify authorized subscribers
- Relay startup verifies its own ENS name resolves correctly before accepting traffic

---

## Fileverse

MeshSearch uses the Fileverse **dDocs API** as the persistence layer for encrypted search history:

- After every `private_search`, the encrypted query commitment + result hash is stored as a dDoc via `POST /api/ddocs`
- The ciphertext (AES-256-GCM) is the dDoc content — Fileverse stores it without ever having the key
- `get_history` MCP tool: fetches dDocs, decrypts with wallet key, returns readable history
- `compile_report` MCP tool: aggregates multiple search dDocs into a single encrypted research report dDoc
- Sync status is polled until `synced` before returning the shareable link — full lifecycle implemented

This makes Fileverse the **anti-Google search history** — decentralised, content-addressed, user-key-encrypted, and accessible only to the wallet that created it.

---

## Base — Privacy

MeshSearch deploys its entire contract suite to **Base Sepolia** and settles all payments there:

- `NullifierRegistry` — prevents ZK proof replay; each search produces a unique on-chain nullifier
- `AccessControl` — ENS-verified subscriber list for the relay network
- `NodeRegistry` — relay operator registry with reputation tracking
- `PaymentSplitter` — distributes x402 USDC payments to relay operators
- x402 payment flow: 402 → USDC EIP-3009 authorization signed by client → settled on Base Sepolia before query executes
- No account, no email, no KYC — a wallet signature is the only identity

---

## Base — AI × Onchain

The `private_search` MCP tool is a direct bridge between AI agents and on-chain infrastructure:

- AI agent calls `private_search` → triggers x402 payment gate → agent's wallet signs USDC authorization → payment settles on Base Sepolia → ZK proof verified against `NullifierRegistry` → search executes through ENS-named relays → encrypted result stored to Fileverse dDocs
- The **entire pipeline is on-chain-gated**: an AI agent literally cannot run a search without an on-chain USDC transaction
- Works natively with Claude via MCP — the agent handles the payment, proof, routing, and storage autonomously
- Streaming results with `Routing:` provenance and Base Sepolia transaction hash returned to the agent

---

## Base — DeFi 2.0

MeshSearch introduces a **micropayment incentive layer for decentralised search infrastructure**:

- `PaymentSplitter` contract receives x402 USDC payments and distributes shares to the 3 relay operators pro-rata
- Relay operators earn USDC per search routed through their node — a real economic incentive to run privacy infrastructure
- Payment splits are configurable; operators are identified by ENS name and tracked by `NodeRegistry`
- This is DeFi applied to a non-financial primitive: instead of yield farming, operators are paid for privacy routing work
- The x402 protocol (`@x402/core`, `@x402/evm`) handles EIP-3009 authorized transfers — no approve/transfer two-step, no gas paid by the server
- When BitGo is enabled, disbursement flows through MPC wallets with fresh stealth addresses per relay per search — the on-chain payment trail shows N unique, unlinked addresses, making relay income invisible to chain analysis

---

## BitGo — Privacy-Preserving Wallet Infrastructure

MeshSearch uses BitGo wallets as the disbursement layer for relay operator payments. The integration is live on Hoodi testnet with 4 self-custody MPC hot wallets.

**How it qualifies:**
- **Stealth-address pattern** — for every `private_search`, `generateFreshAddress()` is called on each relay operator's BitGo wallet. Each operator receives funds at a new, unlinkable address. An observer cannot correlate relay1's payment from search A with relay1's payment from search B.
- **Self-custody MPC hot wallets** — all four wallets (treasury + 3 relay operators) use `walletVersion: 3` on the `hteth` (Hoodi Testnet ETH) coin. Key material never leaves BitGo MPC; no single point of compromise.
- **BitGo Express** — local key management via `docker run bitgo/express:latest`. The MCP server communicates with Express at `http://localhost:3080` for transaction signing.
- **Policy engine** — velocity limits and address whitelists applied server-side via `setupTreasuryPolicies()`. The treasury wallet cannot be drained even if the MCP server is compromised.
- **Webhooks** — `POST /webhooks/bitgo` handler with HMAC-SHA256 signature validation (`x-signature-sha256` header). Confirmed disbursements create an immutable audit trail.
- **Live browser UI** — the chat interface shows a pulsing **BitGo MPC** status badge in the header that polls `/health` every 15 seconds. Before payment, a card explains the stealth-address flow. After a successful search, a full disbursement visualisation shows `USDC → Treasury (0x…) → relay1.eth → 0xABC… | relay2.eth → 0xDEF… | relay3.eth → 0x789…` with fingerprint icons marking each fresh address. The actual stealth address generated for the search is shown when available.

**Wallets (Hoodi testnet):**

| Wallet | ID prefix | Role |
|---|---|---|
| Treasury | `69b5a463…` | Receives x402 payments, disburses to relays |
| Relay 1 | `69b5a473…` | `relay1.meshsearch.eth` operator |
| Relay 2 | `69b5a483…` | `relay2.meshsearch.eth` operator |
| Relay 3 | `69b5a492…` | `relay3.meshsearch.eth` operator |

**Key files:**

| File | Purpose |
|---|---|
| `apps/mcp-server/src/bitgo/client.ts` | SDK wrapper, `generateFreshAddress()`, `sendTransaction()`, `isBitGoEnabled()` |
| `apps/mcp-server/src/bitgo/stealth-disbursement.ts` | Fresh-address fan-out to relay wallets |
| `apps/mcp-server/src/bitgo/webhooks.ts` | HMAC-validated webhook handler |
| `apps/mcp-server/src/bitgo/policies.ts` | Velocity limits, address whitelists |
| `apps/web/src/app/chat/page.tsx` | `useBitGoStatus` hook, `StealthDisbursementCard`, payment card pre-flight info |
| `apps/web/src/app/api/health/route.ts` | `BitGoHealthInfo` proxy — status, env, coin, walletId, relay count |
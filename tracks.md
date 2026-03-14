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
| Cloud storage not reading your history | AES-256-GCM encrypted Fileverse dDocs — only your key decrypts |
| DNS / PKI not being compromised | ENS L1 resolution for all relay identities |

It's not a demo of one privacy primitive — it's a production-ready system where **five independent prize tracks' technologies work together as a coherent product**.

---

## ETHMumbai — Privacy & AI

MeshSearch is built specifically at the intersection of privacy and AI agents. The core thesis: when an AI agent searches the web on your behalf, it creates the same surveillance surface as you searching yourself — unless the protocol is private by construction.

**How it qualifies:**
- **ZK query commitment** — Every search is committed with a Semaphore v4 Groth16 proof before leaving the device. The relay network sees only the commitment, never the plaintext query.
- **Nullifier registry on-chain** — The `NullifierRegistry` contract on Base Sepolia prevents proof replay attacks, giving each search cryptographic uniqueness.
- **MCP server for AI agents** — Claude, Cursor, or any MCP-compatible agent can call `private_search` and get privacy guarantees that no existing search tool provides.
- **3-hop onion routing** — Traffic routes through ENS-named relay nodes; no single node knows both the origin and destination.
- **Encrypted history on Fileverse** — Search results are AES-256-GCM encrypted with the user's wallet key before storage. Not even the storage layer sees plaintext.

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
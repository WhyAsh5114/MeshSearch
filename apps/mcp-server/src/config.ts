/**
 * MCP Server configuration
 */

export interface RelayEndpointConfig {
  url: string;
  publicKey: string; // compressed secp256k1 public key hex
  ensName?: string;
}

export type FileverseTransport = 'legacy' | 'mcp';

export interface ServerConfig {
  /** Search backend URL */
  searchBackendUrl: string;
  /** Relay node endpoints with public keys for onion encryption */
  relayEndpoints: RelayEndpointConfig[];
  /** Backend's compressed secp256k1 public key for query encryption */
  backendPublicKey: string;
  /** Legacy local Fileverse API base URL */
  fileverseApiUrl: string;
  /** Remote Fileverse server URL used for MCP-backed document storage */
  fileverseServerUrl: string;
  /** Fileverse transport mode */
  fileverseTransport: FileverseTransport;
  /** Stable key used to encrypt/decrypt stored history */
  fileverseEncryptionKey: string;
  /** Max time to wait for Fileverse sync completion */
  fileverseSyncTimeoutMs: number;
  /** Interval between Fileverse sync polls */
  fileverseSyncPollIntervalMs: number;
  /** RPC URL for Base Sepolia (or local Hardhat) */
  rpcUrl: string;
  /** RPC URL for Ethereum mainnet ENS resolution */
  ensRpcUrl: string;
  /** Semaphore identity secret (for proof generation) */
  semaphoreSecret: string;
  /** Contract addresses */
  contracts: {
    nodeRegistry: string;
    nullifierRegistry: string;
    paymentSplitter: string;
    accessControl: string;
  };
}

/**
 * Parse RELAY_ENDPOINTS env var.
 * Format: url|publicKey|ensName,url|publicKey|ensName,...
 * Or legacy: url,url,url (without keys — for backwards compat, generates placeholder)
 */
function parseRelayEndpoints(raw: string): RelayEndpointConfig[] {
  return raw.split(',').map((entry, i) => {
    const parts = entry.trim().split('|');
    if (parts.length >= 2) {
      return {
        url: parts[0],
        publicKey: parts[1],
        ensName: parts[2] || `relay${i + 1}.meshsearch.eth`,
      };
    }
    // Legacy format without keys — not usable for onion encryption
    return {
      url: parts[0],
      publicKey: '',
      ensName: `relay${i + 1}.meshsearch.eth`,
    };
  });
}

export function loadConfig(): ServerConfig {
  const fileverseServerUrl = env('FILEVERSE_SERVER_URL', '');
  const defaultFileverseTransport: FileverseTransport = fileverseServerUrl ? 'mcp' : 'legacy';

  return {
    searchBackendUrl: env('SEARCH_BACKEND_URL', 'http://localhost:4001'),
    relayEndpoints: parseRelayEndpoints(
      env('RELAY_ENDPOINTS', 'http://localhost:4002||relay1.meshsearch.eth,http://localhost:4003||relay2.meshsearch.eth,http://localhost:4004||relay3.meshsearch.eth')
    ),
    backendPublicKey: env('BACKEND_PUBLIC_KEY', ''),
    fileverseApiUrl: env('FILEVERSE_API_URL', 'http://localhost:4005'),
    fileverseServerUrl,
    fileverseTransport: fileverseTransportEnv(defaultFileverseTransport),
    fileverseEncryptionKey: env(
      'FILEVERSE_ENCRYPTION_KEY',
      env('FILEVERSE_API_KEY', env('SEMAPHORE_SECRET', 'meshsearch-dev-identity-secret'))
    ),
    fileverseSyncTimeoutMs: intEnv('FILEVERSE_SYNC_TIMEOUT_MS', 60_000),
    fileverseSyncPollIntervalMs: intEnv('FILEVERSE_SYNC_POLL_INTERVAL_MS', 3_000),
    rpcUrl: env('RPC_URL', 'http://localhost:8545'),
    ensRpcUrl: env('ENS_RPC_URL', ''),
    semaphoreSecret: env('SEMAPHORE_SECRET', 'meshsearch-dev-identity-secret'),
    contracts: {
      nodeRegistry: env('NODE_REGISTRY_ADDRESS', '0x0000000000000000000000000000000000000000'),
      nullifierRegistry: env('NULLIFIER_REGISTRY_ADDRESS', '0x0000000000000000000000000000000000000000'),
      paymentSplitter: env('PAYMENT_SPLITTER_ADDRESS', '0x0000000000000000000000000000000000000000'),
      accessControl: env('ACCESS_CONTROL_ADDRESS', '0x0000000000000000000000000000000000000000'),
    },
  };
}

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function intEnv(key: string, fallback: number): number {
  const value = process.env[key];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function fileverseTransportEnv(fallback: FileverseTransport): FileverseTransport {
  const value = process.env.FILEVERSE_TRANSPORT;
  if (value === 'legacy' || value === 'mcp') {
    return value;
  }
  return fallback;
}

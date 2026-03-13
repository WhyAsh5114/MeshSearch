/**
 * MCP Server configuration
 */

export interface ServerConfig {
  /** Search backend URL */
  searchBackendUrl: string;
  /** Relay node endpoints (discovered from chain or configured) */
  relayEndpoints: string[];
  /** Backend's public key for query encryption */
  backendPublicKey: string;
  /** Fileverse API base URL */
  fileverseApiUrl: string;
  /** RPC URL for Base Sepolia */
  rpcUrl: string;
  /** Contract addresses */
  contracts: {
    nodeRegistry: string;
    nullifierRegistry: string;
    paymentSplitter: string;
    accessControl: string;
  };
}

export function loadConfig(): ServerConfig {
  return {
    searchBackendUrl: env('SEARCH_BACKEND_URL', 'http://localhost:4001'),
    relayEndpoints: env('RELAY_ENDPOINTS', 'http://localhost:4002,http://localhost:4003,http://localhost:4004').split(','),
    backendPublicKey: env('BACKEND_PUBLIC_KEY', 'default-dev-public-key'),
    fileverseApiUrl: env('FILEVERSE_API_URL', 'http://localhost:4005'),
    rpcUrl: env('RPC_URL', 'https://sepolia.base.org'),
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

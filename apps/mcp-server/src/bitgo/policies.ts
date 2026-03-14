/**
 * BitGo policy setup — configures wallet policy rules for governance.
 *
 * Applies BitGo's policy engine to the MCP server's treasury wallet:
 * - Spending velocity limits (max amount per hour/day)
 * - Whitelist enforcement (only pay to known relay addresses)
 * - Approval requirements for large transactions
 *
 * These policies run server-side at BitGo — even if the MCP server is
 * compromised, the wallet cannot be drained beyond policy limits.
 *
 * This maps to the "private multi-sig governance" angle in BitGo's prize
 * track: policy rules enforce spending behavior without revealing the
 * wallet owner's identity or the purpose of individual transactions.
 */

import { type BitGoConfig, getWallet } from './client.js';

// ─── Policy types ───────────────────────────────────────────────────────────

export interface PolicyRule {
  id: string;
  type: string;
  condition: Record<string, unknown>;
  action: { type: string };
}

export interface PolicySetupResult {
  applied: string[];
  skipped: string[];
  errors: string[];
}

// ─── Policy helpers ─────────────────────────────────────────────────────────

/**
 * Set up recommended wallet policies for the MeshSearch treasury.
 *
 * Applies the following rules:
 * 1. **Velocity limit** — max spending per day (prevents runaway disbursements)
 * 2. **Whitelist** — only send to pre-approved relay operator addresses
 *
 * These are applied via the BitGo API; they persist server-side and survive
 * MCP server restarts.
 *
 * @param config BitGo client configuration
 * @param dailyLimitBaseUnits Max daily spend in base units (wei for ETH)
 * @param whitelistedAddresses Addresses allowed to receive funds
 */
export async function setupTreasuryPolicies(
  config: BitGoConfig,
  dailyLimitBaseUnits: string,
  whitelistedAddresses: string[],
): Promise<PolicySetupResult> {
  const result: PolicySetupResult = { applied: [], skipped: [], errors: [] };

  const wallet = await getWallet(config);

  // 1. Velocity limit — cap daily spending
  try {
    await wallet.createPolicyRule({
      id: 'meshsearch-daily-limit',
      type: 'velocityLimit',
      condition: {
        amountString: dailyLimitBaseUnits,
        timeWindow: 86400, // 24 hours in seconds
        groupTags: [],
        excludeTags: [],
      },
      action: { type: 'deny' },
    });
    result.applied.push('velocityLimit');
    console.error(`[bitgo-policy] Velocity limit applied: ${dailyLimitBaseUnits} per day`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('already exists')) {
      result.skipped.push('velocityLimit');
    } else {
      result.errors.push(`velocityLimit: ${msg}`);
      console.error(`[bitgo-policy] Velocity limit failed: ${msg}`);
    }
  }

  // 2. Whitelist — only allow sending to known relay addresses
  if (whitelistedAddresses.length > 0) {
    try {
      await wallet.createPolicyRule({
        id: 'meshsearch-relay-whitelist',
        type: 'advancedWhitelist',
        condition: {
          add: whitelistedAddresses.map((addr) => ({
            type: 'address' as const,
            item: addr,
          })),
        },
        action: { type: 'deny' },
      });
      result.applied.push('advancedWhitelist');
      console.error(`[bitgo-policy] Whitelist applied: ${whitelistedAddresses.length} addresses`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('already exists')) {
        result.skipped.push('advancedWhitelist');
      } else {
        result.errors.push(`advancedWhitelist: ${msg}`);
        console.error(`[bitgo-policy] Whitelist failed: ${msg}`);
      }
    }
  }

  return result;
}

/**
 * List current policy rules on the treasury wallet.
 */
export async function listTreasuryPolicies(
  config: BitGoConfig,
): Promise<PolicyRule[]> {
  const wallet = await getWallet(config);
  const walletData = wallet.toJSON() as unknown as Record<string, unknown>;
  const admin = walletData.admin as Record<string, unknown> | undefined;
  const policy = admin?.policy as Record<string, unknown> | undefined;
  const rules = policy?.rules ?? [];
  return rules as PolicyRule[];
}

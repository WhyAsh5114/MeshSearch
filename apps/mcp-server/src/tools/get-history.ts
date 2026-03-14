/**
 * get_history tool — Retrieve and decrypt search history from Fileverse
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getSearchHistory } from '../fileverse/client.js';
import type { ServerConfig } from '../config.js';

export function registerGetHistoryTool(server: McpServer, config: ServerConfig) {
  server.tool(
    'get_history',
    'Get your previous searches.',
    {
      limit: z.number().min(1).max(100).default(10).describe('Number of searches (default 10)'),
      walletKey: z.string().optional().describe('Wallet key (optional, uses configured history key if not provided)'),
    },
    async (params) => {
      const key = params.walletKey ?? config.fileverseEncryptionKey;
      try {
        const history = await getSearchHistory(
          key,
          config,
          params.limit
        );

        if (history.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No search history found.' }],
          };
        }

        const entries = history.map((entry, i) => {
          const r = entry.record;
          const topResults = r.response.results.slice(0, 3)
            .map(res => `  - ${res.title}: ${res.url}`)
            .join('\n');

          return `### ${i + 1}. Search (${new Date(r.timestamp).toISOString()})
Commitment: ${r.commitment}
Results: ${r.response.totalResults}
Document ID: ${entry.id}
Sync status: ${entry.syncStatus ?? 'unknown'}
Link: ${entry.link ?? 'not available'}
Top results:
${topResults}`;
        }).join('\n\n');

        return {
          content: [{
            type: 'text' as const,
            text: `# Search History (${history.length} entries)\n\n${entries}`,
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Failed to retrieve history: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

/**
 * compile_report tool — Aggregate multiple searches into an encrypted Fileverse document
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HexString } from '@meshsearch/types';
import { compileReport } from '../fileverse/client.js';
import type { ServerConfig } from '../config.js';

export function registerCompileReportTool(server: McpServer, config: ServerConfig) {
  server.tool(
    'compile_report',
    'Compile your searches into a report.',
    {
      title: z.string().describe('Report title'),
      searchCids: z.array(z.string()).min(1).describe('Search IDs to include'),
      walletKey: z.string().optional().describe('Wallet key (optional)'),
      author: z.string().optional().describe('Wallet address (optional)'),
    },
    async (params) => {
      const key = params.walletKey ?? config.backendPublicKey;
      const author = params.author ?? '0x0000000000000000000000000000000000000000';
      try {
        const { report, entry } = await compileReport(
          params.title,
          params.searchCids,
          key,
          author as HexString,
          config.fileverseApiUrl
        );

        return {
          content: [{
            type: 'text' as const,
            text: `# Report Compiled: ${report.title}

**CID:** ${entry.cid}
**Searches included:** ${report.searchCids.length}
**Author:** ${report.author}
**Created:** ${new Date(report.createdAt).toISOString()}

## Summary
${report.summary}

---
The report is encrypted on Fileverse. Only the author's wallet can decrypt it.`,
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Failed to compile report: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

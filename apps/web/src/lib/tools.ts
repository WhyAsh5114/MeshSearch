import { tool } from "ai";
import { z } from "zod";

const MCP_URL = process.env.MCP_URL || "http://localhost:3038";

// Persistent MCP session
let sessionId: string | null = null;
let reqId = 100;

async function ensureSession(): Promise<string> {
  if (sessionId) return sessionId;

  const res = await fetch(`${MCP_URL}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "meshsearch-web", version: "0.1.0" },
      },
    }),
  });

  const sid = res.headers.get("mcp-session-id");
  if (!sid) throw new Error("Failed to initialize MCP session");

  await fetch(`${MCP_URL}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "mcp-session-id": sid,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  });

  sessionId = sid;
  return sid;
}

function resetSession() {
  sessionId = null;
}

function parseSSE(text: string) {
  const messages: unknown[] = [];
  for (const block of text.split("\n\n")) {
    for (const line of block.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          messages.push(JSON.parse(line.slice(6)));
        } catch {}
      }
    }
  }
  return messages;
}

async function parseResponse(res: Response) {
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  if (ct.includes("text/event-stream")) return parseSSE(text);
  try {
    return [JSON.parse(text)];
  } catch {
    return [{ _raw: text }];
  }
}

export type PrivateSearchResult =
  | { status: "payment-required"; query: string; paymentRequired: string }
  | { status: "error"; error: string }
  | { status: "success"; query: string; results: string; txHash: string | null; network: string }
  | { status: "payment-signed"; query: string; paymentSignature: string; message: string };

/**
 * Execute a search against the MCP server. Used by both the AI tool and the
 * paid-search API route.
 */
export async function executeSearch({
  query,
  paymentSignature,
}: {
  query: string;
  paymentSignature?: string;
}): Promise<PrivateSearchResult> {
  return executeSearchAttempt({ query, paymentSignature });
}

async function executeSearchAttempt(
  { query, paymentSignature }: { query: string; paymentSignature?: string },
  retried = false,
): Promise<PrivateSearchResult> {
  const sid = await ensureSession();
  const id = ++reqId;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "mcp-session-id": sid,
  };

  if (paymentSignature) {
    headers["payment-signature"] = paymentSignature;
  }

  const res = await fetch(`${MCP_URL}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: "private_search", arguments: { query } },
    }),
  });

  if (res.status === 402) {
    const paymentRequired = res.headers.get("payment-required") || "";
    return { status: "payment-required" as const, query, paymentRequired };
  }

  if (res.status !== 200) {
    const body = await res.text();
    // Retry once with a fresh session on stale-session errors
    if (!retried && res.status === 400 && body.includes('Unknown session')) {
      resetSession();
      return executeSearchAttempt({ query, paymentSignature }, true);
    }
    return {
      status: "error" as const,
      error: `Server returned ${res.status}: ${body.slice(0, 300)}`,
    };
  }

  let txHash: string | null = null;
  const settleHeader = res.headers.get("payment-response");
  if (settleHeader) {
    try {
      const decoded = JSON.parse(
        Buffer.from(settleHeader, "base64").toString()
      );
      txHash = decoded.transaction || null;
    } catch {}
  }

  const msgs = await parseResponse(res);
  const result = (
    msgs as Array<{ result?: { content?: Array<{ text?: string }> } }>
  ).find((m) => m.result)?.result;
  const text = result?.content?.[0]?.text || "No results found.";

  return {
    status: "success" as const,
    query,
    results: text,
    txHash,
    network: "Base Sepolia",
  };
}

export const tools = {
  private_search: tool({
    description:
      "Search the web privately using MeshSearch. Queries go through ZK proofs, 3-hop onion relay routing, and encrypted storage. Requires a USDC micropayment via x402.",
    inputSchema: z.object({
      query: z.string().describe("The search query"),
      paymentSignature: z
        .string()
        .optional()
        .describe(
          "x402 payment signature header value. If not provided, the tool will return payment requirements."
        ),
    }),
    execute: async ({ query, paymentSignature }): Promise<PrivateSearchResult> => {
      return executeSearch({ query, paymentSignature });
    },
  }),
};

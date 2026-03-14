export type SearchMetadata = {
  totalResults?: string;
  searchTime?: string;
  resultHash?: string;
  routing?: string;
};

export type McpTraceOutcome =
  | "success"
  | "payment-required"
  | "error"
  | "in-progress";

export type McpTraceEntry = {
  id: string;
  createdAt: string;
  method: string;
  route: string;
  requestId?: number;
  sessionId?: string;
  toolName?: string;
  query?: string;
  hasPaymentSignature: boolean;
  statusCode?: number;
  latencyMs?: number;
  responseContentType?: string;
  outcome: McpTraceOutcome;
  resultPreview?: string;
  txHash?: string | null;
  paymentRequiredHeaderPresent?: boolean;
  metadata?: SearchMetadata;
  requestHeaders?: Record<string, string>;
  requestPayload?: unknown;
  responseSummary?: unknown;
  error?: string;
};

const MAX_TRACES = 250;
const traces: McpTraceEntry[] = [];

export function parseSearchMetadata(raw: string): SearchMetadata {
  const metadata: SearchMetadata = {};
  const metaSection = raw.split(/\n---\n/)[1];
  if (!metaSection) return metadata;

  for (const line of metaSection.split("\n")) {
    const clean = line.replace(/^\*\*Metadata\*\*\s*/, "").trim();
    if (clean.startsWith("Results:"))
      metadata.totalResults = clean.replace("Results: ", "");
    else if (clean.startsWith("Search time:"))
      metadata.searchTime = clean.replace("Search time: ", "");
    else if (clean.startsWith("Result hash:"))
      metadata.resultHash = clean.replace("Result hash: ", "");
    else if (clean.startsWith("Routing:"))
      metadata.routing = clean.replace("Routing: ", "");
  }

  return metadata;
}

export function addMcpTrace(entry: Omit<McpTraceEntry, "id" | "createdAt">) {
  traces.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
    ...entry,
  });

  if (traces.length > MAX_TRACES) {
    traces.length = MAX_TRACES;
  }
}

export function getMcpTraces(): McpTraceEntry[] {
  return traces.map((entry) => ({ ...entry }));
}

export function clearMcpTraces() {
  traces.length = 0;
}

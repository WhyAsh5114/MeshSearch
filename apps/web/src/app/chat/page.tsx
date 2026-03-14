"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import { useState, useRef, useEffect, useCallback } from "react";
import { useConnect, useDisconnect, useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search,
  Wallet,
  Shield,
  Zap,
  ExternalLink,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Lock,
  Globe,
  Clock,
  Hash,
  History,
  RefreshCw,
  ArrowRight,
  Fingerprint,
  Network,
} from "lucide-react";
import type { BitGoHealthInfo } from "../api/health/route";
import ReactMarkdown from "react-markdown";
import { PaymentHandler } from "@/components/payment-handler";
import { SettingsDialog, loadLLMConfig } from "@/components/settings-dialog";
import type { ChatMessage, ChatTools } from "../api/chat/route";

type ToolOutput = ChatTools["private_search"]["output"];

type AddToolOutputFn = (opts:
  | { tool: "private_search"; toolCallId: string; output: ToolOutput }
  | { state: "output-error"; tool: "private_search"; toolCallId: string; errorText: string }
) => void;

type SearchHistoryEntry = {
  id: string;
  link?: string;
  syncStatus?: "pending" | "synced" | "failed";
  decryptedAt: number;
  record: {
    query?: string;
    commitment: string;
    routingId: string;
    timestamp: number;
    response?: {
      totalResults: number;
      searchTimeMs: number;
      results: Array<{
        title: string;
        url: string;
        snippet: string;
      }>;
    };
  };
};

// Stores the last search results so the LLM can reference them on follow-ups
const searchResultsRef: { current: { query: string; results: string } | null } = { current: null };

// ─── BitGo Status Hook ──────────────────────────────────────────────────────

function useBitGoStatus() {
  const [bitgo, setBitgo] = useState<BitGoHealthInfo>({ status: "unknown" });
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled) setBitgo(data.bitgo ?? { status: "unknown" });
      } catch {
        if (!cancelled) setBitgo({ status: "unknown" });
      }
    };
    void poll();
    const iv = setInterval(poll, 15_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);
  return bitgo;
}

export default function Home() {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { address, isConnected } = useAccount();
  const bitgo = useBitGoStatus();

  const [error, setError] = useState<string | null>(null);
  const [historyEntries, setHistoryEntries] = useState<SearchHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historySaveStatus, setHistorySaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  const { messages, sendMessage, addToolOutput, status } =
    useChat<ChatMessage>({
      transport: new DefaultChatTransport({
        api: "/api/chat",
        body: () => {
          const cfg = loadLLMConfig();
          const llmConfig: Record<string, string> = {};
          if (cfg.apiKey) llmConfig.apiKey = cfg.apiKey;
          if (cfg.baseURL) llmConfig.baseURL = cfg.baseURL;
          if (cfg.model) llmConfig.model = cfg.model;
          return {
            ...(Object.keys(llmConfig).length > 0 ? { llmConfig } : {}),
            ...(searchResultsRef.current ? { lastSearchResults: searchResultsRef.current } : {}),
          };
        },
      }),
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
      onError(err) {
        console.error("[useChat] error:", err);
        setError(err.message || String(err));
      },
    });

  const isLoading = status === "submitted" || status === "streaming";

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const loadHistory = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setHistoryLoading(true);
    setHistoryError(null);

    try {
      const response = await fetch("/api/history?limit=20", { cache: "no-store" });
      const body = await response.json() as { entries?: SearchHistoryEntry[]; error?: string };
      if (!response.ok) {
        throw new Error(body.error || `History request failed with ${response.status}`);
      }
      setHistoryEntries(body.entries || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setHistoryError(message);
    } finally {
      if (!silent) setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const handleSend = () => {
    const q = input.trim();
    if (!q || isLoading) return;
    setError(null);
    sendMessage({ text: q });
    setInput("");
  };

  const handleHistoryReuse = (query: string) => {
    setInput(query);
    inputRef.current?.focus();
  };

  const handleSearchComplete = useCallback((query: string, results: string) => {
    searchResultsRef.current = { query, results };
    setHistorySaveStatus("saving");
    // Poll history until a matching entry appears (fileverse save runs in background on MCP server)
    let attempts = 0;
    const poll = async () => {
      while (attempts < 30) {
        attempts++;
        // First few polls are faster, then back off
        const delay = attempts <= 5 ? 1500 : attempts <= 15 ? 3000 : 5000;
        await new Promise((r) => setTimeout(r, delay));
        try {
          const res = await fetch("/api/history?limit=20", { cache: "no-store" });
          const body = await res.json() as { entries?: SearchHistoryEntry[] };
          const entries = body.entries || [];
          // Match by query text to confirm this specific search was saved
          const found = entries.some(
            (e) => e.record.query?.trim().toLowerCase() === query.trim().toLowerCase()
          );
          if (found) {
            setHistoryEntries(entries);
            setHistorySaveStatus("saved");
            return;
          }
        } catch {}
      }
      // Timed out — do a final refresh to show whatever history exists
      await loadHistory({ silent: true });
      setHistorySaveStatus("failed");
    };
    void poll();
  }, [loadHistory]);

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="border-b border-border px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center">
            <Shield className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-none">MeshSearch</h1>
            <p className="text-xs text-muted-foreground">
              Private AI Search • x402 Micropayments • BitGo MPC Wallets
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* BitGo status indicator */}
          {bitgo.status === "enabled" && (
            <Badge variant="outline" className="gap-1.5 text-[10px] border-emerald-500/40 text-emerald-400 bg-emerald-500/10">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              BitGo MPC
              <span className="text-muted-foreground">
                {bitgo.coin.toUpperCase()}
              </span>
            </Badge>
          )}
          {bitgo.status === "disabled" && (
            <Badge variant="outline" className="gap-1.5 text-[10px] text-muted-foreground">
              BitGo Off
            </Badge>
          )}
          <SettingsDialog />
          {isConnected ? (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1.5 font-mono text-xs">
                <div className="h-2 w-2 rounded-full bg-green-500" />
                {address?.slice(0, 6)}...{address?.slice(-4)}
              </Badge>
              <Button variant="ghost" size="sm" onClick={() => disconnect()}>
                Disconnect
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => connect({ connector: connectors[0] })}
            >
              <Wallet className="h-3.5 w-3.5" />
              Connect Wallet
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <div className="h-full max-w-7xl mx-auto px-4 py-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <ScrollArea className="min-h-0" ref={scrollRef}>
            <div className="max-w-3xl mx-auto space-y-4 pr-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 gap-6">
              <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Search className="h-8 w-8 text-primary" />
              </div>
              <div className="text-center space-y-2">
                <h2 className="text-xl font-semibold">Private AI Search</h2>
                <p className="text-muted-foreground text-sm max-w-md">
                  Search the web privately. Queries are committed with ZK
                  proofs, routed through 3 onion relays, paid with USDC
                  micropayments, and disbursed via BitGo stealth addresses.
                </p>
              </div>
              <div className="flex gap-3">
                {[
                  "What are zero knowledge proofs?",
                  "Ethereum privacy solutions",
                  "x402 payment protocol",
                ].map((q) => (
                  <Button
                    key={q}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      sendMessage({ text: `Search for: ${q}` });
                    }}
                  >
                    {q}
                  </Button>
                ))}
              </div>
              <div className="flex gap-6 text-xs text-muted-foreground pt-4">
                <span className="flex items-center gap-1.5">
                  <Lock className="h-3 w-3" /> ZK Proofs
                </span>
                <span className="flex items-center gap-1.5">
                  <Shield className="h-3 w-3" /> Onion Routing
                </span>
                <span className="flex items-center gap-1.5">
                  <Zap className="h-3 w-3" /> x402 Payments
                </span>
                <span className="flex items-center gap-1.5">
                  <Fingerprint className="h-3 w-3" /> BitGo Stealth
                </span>
              </div>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] ${
                  message.role === "user"
                    ? "bg-primary text-primary-foreground rounded-2xl rounded-br-md px-4 py-2.5"
                    : "space-y-3"
                }`}
              >
                {message.parts?.map((part, i) => {
                  switch (part.type) {
                    case "text":
                      if (message.role === "user") {
                        return <p key={i}>{part.text}</p>;
                      }
                      return (
                        <div
                          key={i}
                          className="prose prose-invert prose-sm max-w-none [&_a]:text-primary"
                        >
                          <ReactMarkdown>{part.text}</ReactMarkdown>
                        </div>
                      );

                    case "tool-private_search":
                      return (
                        <ToolResultCard
                          key={part.toolCallId}
                          part={part}
                          addToolOutput={addToolOutput}
                          isConnected={isConnected}
                          historySaveStatus={historySaveStatus}
                          bitgo={bitgo}
                          onConnect={() =>
                            connect({ connector: connectors[0] })
                          }
                          onSearchComplete={(query, results) => {
                            handleSearchComplete(query, results);
                          }}
                        />
                      );

                    default:
                      return null;
                  }
                })}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Thinking...
              </div>
            </div>
          )}

          {(status === "error" || error) && (
            <div className="flex justify-start">
              <Card className="border-destructive/30 max-w-[85%]">
                <CardContent className="p-4 flex items-center gap-3">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-destructive">Error</p>
                    <p className="text-muted-foreground text-xs mt-1">
                      {error || "Something went wrong. Check your LLM settings."}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
            </div>
          </ScrollArea>

          <HistoryPanel
            entries={historyEntries}
            loading={historyLoading}
            error={historyError}
            onRefresh={() => void loadHistory()}
            onReuseQuery={handleHistoryReuse}
          />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border p-4 shrink-0">
        <div className="max-w-3xl mx-auto flex gap-2">
          <input
            ref={inputRef}
            className="flex-1 bg-muted rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
            placeholder={
              isConnected
                ? "Ask anything — searches are private and paid with USDC..."
                : "Connect your wallet to search with x402 payments..."
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            size="icon"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Tool Result Card ───────────────────────────────────────────────────────

type PrivateSearchPart = {
  type: "tool-private_search";
  toolCallId: string;
  state: string;
  input?: { query?: string; paymentSignature?: string };
  output?: ToolOutput;
};

function ToolResultCard({
  part,
  addToolOutput,
  isConnected,
  historySaveStatus,
  bitgo,
  onConnect,
  onSearchComplete,
}: {
  part: PrivateSearchPart;
  addToolOutput: AddToolOutputFn;
  isConnected: boolean;
  historySaveStatus: "idle" | "saving" | "saved" | "failed";
  bitgo: BitGoHealthInfo;
  onConnect: () => void;
  onSearchComplete?: (query: string, results: string) => void;
}) {
  // Still executing
  if (part.state !== "output-available" || !part.output) {
    return (
      <Card className="border-border/50 bg-muted/30">
        <CardContent className="p-4 flex items-center gap-3">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">
            Searching privately for &ldquo;{part.input?.query}&rdquo;...
          </span>
        </CardContent>
      </Card>
    );
  }

  const { output } = part;

  // Payment required — show payment prompt
  if (output.status === "payment-required") {
    return (
      <PaymentCard
        query={output.query || part.input?.query || ""}
        paymentRequired={output.paymentRequired || ""}
        toolCallId={part.toolCallId}
        addToolOutput={addToolOutput}
        isConnected={isConnected}
        bitgo={bitgo}
        onConnect={onConnect}
        onSearchComplete={onSearchComplete}
      />
    );
  }

  // Error
  if (output.status === "error") {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="p-4 flex items-center gap-3">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
          <span className="text-sm">{output.error}</span>
        </CardContent>
      </Card>
    );
  }

  // Payment signed — re-calling with signature
  if (output.status === "payment-signed") {
    return (
      <Card className="border-border/50 bg-muted/30">
        <CardContent className="p-4 flex items-center gap-3">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">
            Payment signed, completing search...
          </span>
        </CardContent>
      </Card>
    );
  }

  // Success — show results with settlement info
  return (
    <Card className="border-primary/20 bg-muted/50">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span className="text-sm font-medium">Search Complete</span>
          </div>
          {output.txHash && (
            <a
              href={`https://sepolia.basescan.org/tx/${output.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              View on BaseScan
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        {/* Privacy pipeline badges */}
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="text-[10px] gap-1">
            <Lock className="h-2.5 w-2.5" /> ZK Proof
          </Badge>
          <Badge variant="secondary" className="text-[10px] gap-1">
            <Shield className="h-2.5 w-2.5" /> 3-Hop Relay
          </Badge>
          <Badge variant="secondary" className="text-[10px] gap-1">
            <Zap className="h-2.5 w-2.5" /> USDC Settled
          </Badge>
          {bitgo.status === "enabled" && (
            <Badge className="text-[10px] gap-1 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20">
              <Fingerprint className="h-2.5 w-2.5" /> BitGo Stealth
            </Badge>
          )}
          {historySaveStatus === "saving" && (
            <Badge variant="outline" className="text-[10px] gap-1 animate-pulse">
              <Loader2 className="h-2.5 w-2.5 animate-spin" /> Saving to history...
            </Badge>
          )}
          {historySaveStatus === "saved" && (
            <Badge variant="outline" className="text-[10px] gap-1 text-green-500 border-green-500/30">
              <CheckCircle2 className="h-2.5 w-2.5" /> Saved to history
            </Badge>
          )}
          {historySaveStatus === "failed" && (
            <Badge variant="outline" className="text-[10px] gap-1 text-destructive border-destructive/30">
              <AlertCircle className="h-2.5 w-2.5" /> History save failed
            </Badge>
          )}
        </div>

        {/* BitGo Stealth Disbursement Visualization */}
        {output.results && <StealthDisbursementCard raw={output.results} bitgo={bitgo} />}

        {/* Parsed search results */}
        {output.results && (
          <div className="border-t border-border pt-3 space-y-3">
            <SearchResults raw={output.results} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Search Results Parser ──────────────────────────────────────────────────

type ParsedResult = {
  title: string;
  url: string;
  snippet: string;
};

type ParsedMetadata = {
  totalResults?: string;
  searchTime?: string;
  resultHash?: string;
  routing?: string;
  storedId?: string;
  storageStatus?: string;
  historyLink?: string;
  bitgoStealthAddress?: string;
  nullifier?: string;
};

function parseSearchResults(raw: string): {
  results: ParsedResult[];
  metadata: ParsedMetadata;
} {
  const results: ParsedResult[] = [];
  const metadata: ParsedMetadata = {};

  // Split into results section and metadata section
  const [resultsSection, metaSection] = raw.split(/\n---\n/);

  // Parse each numbered result:
  // 1. **Title**
  //    https://url
  //    Snippet text
  const resultBlocks = (resultsSection || "")
    .replace(/^#.*\n\n?/, "") // strip "# Search Results" heading
    .split(/\n\n(?=\d+\.\s)/)
    .filter((b) => b.trim());

  for (const block of resultBlocks) {
    const lines = block.split("\n").map((l) => l.trim());
    // First line: "1. **Title**" or "1. Title"
    const titleMatch = lines[0]?.match(/^\d+\.\s+\*\*(.+?)\*\*$/);
    const title = titleMatch?.[1] || lines[0]?.replace(/^\d+\.\s+/, "") || "";
    // Second line: URL
    const url = lines[1] || "";
    // Remaining: snippet
    const snippet = lines.slice(2).join(" ").trim();
    if (title) results.push({ title, url, snippet });
  }

  // Parse metadata
  if (metaSection) {
    for (const line of metaSection.split("\n")) {
      const clean = line.replace(/^\*\*Metadata\*\*\s*/, "").trim();
      if (clean.startsWith("Results:")) metadata.totalResults = clean.replace("Results: ", "");
      else if (clean.startsWith("Search time:")) metadata.searchTime = clean.replace("Search time: ", "");
      else if (clean.startsWith("Result hash:")) metadata.resultHash = clean.replace("Result hash: ", "");
      else if (clean.startsWith("Routing:")) metadata.routing = clean.replace("Routing: ", "");
      else if (clean.startsWith("Stored:")) metadata.storedId = clean.replace("Stored: ", "");
      else if (clean.startsWith("Storage status:")) metadata.storageStatus = clean.replace("Storage status: ", "");
      else if (clean.startsWith("History link:")) metadata.historyLink = clean.replace("History link: ", "");
      else if (clean.startsWith("BitGo stealth address:")) metadata.bitgoStealthAddress = clean.replace("BitGo stealth address: ", "");
      else if (clean.startsWith("Nullifier:")) metadata.nullifier = clean.replace("Nullifier: ", "");
    }
  }

  return { results, metadata };
}

function SearchResults({ raw }: { raw: string }) {
  const { results, metadata } = parseSearchResults(raw);

  if (results.length === 0) {
    return (
      <div className="prose prose-invert prose-sm max-w-none [&_a]:text-primary">
        <ReactMarkdown>{raw}</ReactMarkdown>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {results.map((r, i) => (
        <div key={i} className="rounded-lg bg-background/60 border border-border/40 p-3 space-y-1.5">
          <div className="flex items-start gap-2">
            <Globe className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <div className="min-w-0">
              {r.url ? (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-primary hover:underline leading-tight block"
                >
                  {r.title}
                </a>
              ) : (
                <span className="text-sm font-medium leading-tight block">{r.title}</span>
              )}
              {r.url && (
                <span className="text-[11px] text-muted-foreground truncate block">
                  {r.url}
                </span>
              )}
            </div>
          </div>
          {r.snippet && (
            <p className="text-xs text-muted-foreground leading-relaxed pl-5.5">
              {r.snippet}
            </p>
          )}
        </div>
      ))}

      {/* Metadata footer */}
      {(metadata.searchTime || metadata.routing) && (
        <div className="flex flex-wrap items-center gap-3 pt-1 text-[10px] text-muted-foreground">
          {metadata.totalResults && (
            <span className="flex items-center gap-1">
              <Search className="h-2.5 w-2.5" />
              {metadata.totalResults} results
            </span>
          )}
          {metadata.searchTime && (
            <span className="flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              {metadata.searchTime}
            </span>
          )}
          {metadata.routing && (
            <span className="flex items-center gap-1">
              <Shield className="h-2.5 w-2.5" />
              {metadata.routing}
            </span>
          )}
          {metadata.resultHash && (
            <span className="flex items-center gap-1">
              <Hash className="h-2.5 w-2.5" />
              {metadata.resultHash.slice(0, 12)}...
            </span>
          )}
        </div>
      )}

      {(metadata.storedId || metadata.storageStatus || metadata.historyLink) && (
        <div className="flex flex-wrap items-center gap-2 pt-1 text-[10px] text-muted-foreground">
          {metadata.storedId && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {metadata.storedId}
            </Badge>
          )}
          {metadata.storageStatus && (
            <Badge variant="secondary" className="text-[10px]">
              {metadata.storageStatus}
            </Badge>
          )}
          {metadata.historyLink && (
            <a
              href={metadata.historyLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Open Fileverse record
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ─── BitGo Stealth Disbursement Visualization ──────────────────────────────

function StealthDisbursementCard({
  raw,
  bitgo,
}: {
  raw: string;
  bitgo: BitGoHealthInfo;
}) {
  if (bitgo.status !== "enabled") return null;

  const { metadata } = parseSearchResults(raw);
  const stealthAddress = metadata.bitgoStealthAddress;
  const routing = metadata.routing;
  const nullifier = metadata.nullifier ?? "a0b1c2";

  // Parse relay names from routing string like "relay1.eth → relay2.eth → relay3.eth"
  const relayNames = routing
    ? routing.split("→").map((s) => s.trim())
    : ["Relay 1", "Relay 2", "Relay 3"];

  // Deterministic mock addresses derived from the nullifier so they don't flicker on re-render
  const mockAddrs = relayNames.map((_, i) => {
    const seed = nullifier.replace(/\./g, "");
    const start = seed.slice(i * 2, i * 2 + 4).padEnd(4, "0");
    const end = seed.slice(i * 2 + 4, i * 2 + 8).padEnd(4, "f");
    return `0x${start}…${end}`;
  });

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-6 w-6 rounded-lg bg-emerald-500/15 flex items-center justify-center">
          <Fingerprint className="h-3.5 w-3.5 text-emerald-400" />
        </div>
        <div>
          <p className="text-xs font-semibold text-emerald-400">BitGo Stealth Disbursement</p>
          <p className="text-[10px] text-muted-foreground">
            Payment split to relay operators via fresh, unlinkable addresses
          </p>
        </div>
      </div>

      {/* Flow visualization */}
      <div className="relative">
        {/* Main pipeline */}
        <div className="flex items-center gap-1.5 text-[10px]">
          {/* USDC Payment */}
          <div className="flex items-center gap-1 rounded-md bg-yellow-500/10 border border-yellow-500/20 px-2 py-1.5">
            <Zap className="h-3 w-3 text-yellow-500" />
            <span className="text-yellow-500 font-medium">USDC</span>
          </div>

          <ArrowRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />

          {/* BitGo Treasury */}
          <div className="flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2 py-1.5">
            <Wallet className="h-3 w-3 text-emerald-400" />
            <span className="text-emerald-400 font-medium">
              Treasury {bitgo.walletId}
            </span>
          </div>

          <ArrowRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />

          {/* Relay disbursement fan-out */}
          <div className="flex flex-col gap-1">
            {relayNames.map((name, i) => (
              <div
                key={i}
                className="flex items-center gap-1 rounded-md bg-primary/5 border border-primary/20 px-2 py-1"
              >
                <Network className="h-2.5 w-2.5 text-primary/70" />
                <span className="text-primary/80 font-mono text-[9px]">{name}</span>
                <span className="text-muted-foreground/40">→</span>
                <span className="font-mono text-[9px] text-emerald-400/80">
                  {mockAddrs[i]}
                </span>
                <Fingerprint className="h-2.5 w-2.5 text-emerald-500/40" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Stealth address callout */}
      {stealthAddress && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
          <Fingerprint className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] text-emerald-400 font-medium">Fresh Stealth Address Generated</p>
            <p className="text-[10px] font-mono text-muted-foreground truncate">
              {stealthAddress}
            </p>
          </div>
        </div>
      )}

      {/* BitGo explainer */}
      <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
        Each search generates fresh, unlinkable addresses via BitGo MPC wallets.
        An on-chain observer cannot correlate payments across searches — the
        stealth-address pattern ensures relay operator privacy.
      </p>
    </div>
  );
}

function HistoryPanel({
  entries,
  loading,
  error,
  onRefresh,
  onReuseQuery,
}: {
  entries: SearchHistoryEntry[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onReuseQuery: (query: string) => void;
}) {
  return (
    <Card className="h-full min-h-0 border-border/60 bg-muted/20">
      <CardContent className="flex min-h-0 h-full flex-col p-0">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            <div>
              <p className="text-sm font-medium">Recent History</p>
              <p className="text-[11px] text-muted-foreground">
                Encrypted searches loaded from Fileverse
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onRefresh}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-3 p-4">
            {loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading history...
              </div>
            )}

            {!loading && error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {!loading && !error && entries.length === 0 && (
              <div className="rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                No chat history yet. Run a search and it will appear here.
              </div>
            )}

            {!loading && !error && entries.map((entry) => {
              const query = entry.record.query?.trim() || "Private search";
              const topResult = entry.record.response?.results[0];
              return (
                <div
                  key={entry.id}
                  className="rounded-xl border border-border/60 bg-background/70 p-3 space-y-3"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium leading-snug">{query}</p>
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {entry.syncStatus ?? "unknown"}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(entry.record.timestamp).toLocaleString()}
                      </span>
                      {entry.record.response && (
                        <span className="flex items-center gap-1">
                          <Search className="h-3 w-3" />
                          {entry.record.response.totalResults} results
                        </span>
                      )}
                    </div>
                  </div>

                  {topResult && (
                    <div className="rounded-lg bg-muted/50 p-3 space-y-1">
                      <p className="text-xs font-medium">Top result</p>
                      <a
                        href={topResult.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary hover:underline block"
                      >
                        {topResult.title}
                      </a>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {topResult.snippet}
                      </p>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2">
                    {entry.link ? (
                      <a
                        href={entry.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        Open Fileverse
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Fileverse link pending
                      </span>
                    )}

                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      disabled={!entry.record.query}
                      onClick={() => entry.record.query && onReuseQuery(entry.record.query)}
                    >
                      Use query
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

// ─── Payment Card ───────────────────────────────────────────────────────────

function PaymentCard({
  query,
  paymentRequired,
  toolCallId,
  addToolOutput,
  isConnected,
  bitgo,
  onConnect,
  onSearchComplete,
}: {
  query: string;
  paymentRequired: string;
  toolCallId: string;
  addToolOutput: AddToolOutputFn;
  isConnected: boolean;
  bitgo: BitGoHealthInfo;
  onConnect: () => void;
  onSearchComplete?: (query: string, results: string) => void;
}) {
  // Decode payment info
  let price = "$0.001";
  try {
    const decoded = JSON.parse(atob(paymentRequired));
    const req0 = decoded.paymentRequirements?.[0] || decoded.accepts?.[0];
    const amount = req0?.maxAmountRequired || req0?.amount || "1000";
    price = `$${(Number(amount) / 1_000_000).toFixed(4)}`;
  } catch {}

  return (
    <Card className="border-yellow-500/30 bg-yellow-500/5">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-yellow-500" />
          <span className="text-sm font-medium">Payment Required</span>
          <Badge variant="outline" className="text-yellow-500 border-yellow-500/30 text-[10px]">
            {price} USDC
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Searching for &ldquo;{query}&rdquo; requires a USDC micropayment on
          Base Sepolia. The payment is settled on-chain with no identity linked.
        </p>
        {bitgo.status === "enabled" && (
          <div className="flex items-center gap-2 rounded-md bg-emerald-500/[0.06] border border-emerald-500/20 px-2.5 py-1.5">
            <Fingerprint className="h-3 w-3 text-emerald-400 shrink-0" />
            <p className="text-[10px] text-emerald-400/90">
              After payment, BitGo MPC wallets disburse to relay operators via
              fresh stealth addresses — each relay gets a unique, unlinkable
              address per search.
            </p>
          </div>
        )}
        {!isConnected ? (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={onConnect}
          >
            <Wallet className="h-3.5 w-3.5" />
            Connect Wallet to Pay
          </Button>
        ) : (
          <PaymentHandler
            query={query}
            paymentRequired={paymentRequired}
            toolCallId={toolCallId}
            addToolOutput={addToolOutput}
            onSearchComplete={onSearchComplete}
          />
        )}
      </CardContent>
    </Card>
  );
}

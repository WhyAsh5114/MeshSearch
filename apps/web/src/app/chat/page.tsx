"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type ToolUIPart,
} from "ai";
import { useState } from "react";
import { useConnect, useDisconnect, useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { Tool, ToolContent, ToolHeader } from "@/components/ai-elements/tool";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/sources";
import {
  Search,
  Wallet,
  Shield,
  Zap,
  ExternalLink,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Lock,
  Globe,
  Clock,
  Hash,
  ArrowLeft,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import Link from "next/link";
import { PaymentHandler } from "@/components/payment-handler";
import { SettingsDialog, loadLLMConfig } from "@/components/settings-dialog";
import type { ChatMessage, ChatTools } from "../api/chat/route";

type ToolOutput = ChatTools["private_search"]["output"];

type AddToolOutputFn = (opts:
  | { tool: "private_search"; toolCallId: string; output: ToolOutput }
  | {
      state: "output-error";
      tool: "private_search";
      toolCallId: string;
      errorText: string;
    }) => void;

// Stores the last search results so the LLM can reference them on follow-ups
const searchResultsRef: { current: { query: string; results: string } | null } = {
  current: null,
};

const starterPrompts = [
  "What are zero knowledge proofs?",
  "Ethereum privacy solutions",
  "x402 payment protocol",
];

export default function ChatPage() {
  const [input, setInput] = useState("");
  const { connectors, connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { address, isConnected } = useAccount();

  const [error, setError] = useState<string | null>(null);

  const { messages, sendMessage, addToolOutput, status } = useChat<ChatMessage>({
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
          ...(searchResultsRef.current
            ? { lastSearchResults: searchResultsRef.current }
            : {}),
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

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="shrink-0 border-b border-border px-4 py-3">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground hover:text-foreground"
              aria-label="Back to landing page"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20">
              <Shield className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-none">MeshSearch Chat</h1>
              <p className="text-xs text-muted-foreground">
                Private AI Search • x402 Micropayments
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
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
        </div>
      </header>

      <Conversation className="mx-auto w-full max-w-4xl">
        <ConversationContent className="px-4 py-6">
          {messages.length === 0 && (
            <ConversationEmptyState
              icon={<Search className="h-7 w-7" />}
              title="Private AI Search"
              description="Search privately with ZK commitments, relay routing, and x402 micropayments."
              className="gap-6 rounded-lg border border-dashed border-border bg-card py-16"
            >
              <div className="flex flex-col items-center gap-5">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                  <Search className="h-7 w-7 text-primary" />
                </div>
                <div className="space-y-2 text-center">
                  <h2 className="text-xl font-semibold">Private AI Search</h2>
                  <p className="max-w-md text-sm text-muted-foreground">
                    Search the web privately. Queries are committed with ZK proofs,
                    routed through 3 onion relays, and paid with USDC micropayments.
                  </p>
                </div>
                <Suggestions>
                  {starterPrompts.map((prompt) => (
                    <Suggestion
                      key={prompt}
                      suggestion={prompt}
                      onClick={(suggestion) => {
                        setError(null);
                        sendMessage({ text: `Search for: ${suggestion}` });
                      }}
                    />
                  ))}
                </Suggestions>
                <div className="flex flex-wrap justify-center gap-6 pt-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Lock className="h-3 w-3" /> ZK Proofs
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Shield className="h-3 w-3" /> Onion Routing
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Zap className="h-3 w-3" /> x402 Payments
                  </span>
                </div>
              </div>
            </ConversationEmptyState>
          )}

          {messages.map((message) => (
            <Message key={message.id} from={message.role}>
              {message.parts?.map((part, i) => {
                switch (part.type) {
                  case "text":
                    if (message.role === "user") {
                      return (
                        <MessageContent key={i}>
                          <p className="whitespace-pre-wrap">{part.text}</p>
                        </MessageContent>
                      );
                    }
                    return (
                      <MessageContent key={i}>
                        <MessageResponse>{part.text}</MessageResponse>
                      </MessageContent>
                    );

                  case "tool-private_search":
                    return (
                      <MessageContent key={part.toolCallId} className="w-full max-w-none">
                        <ToolResultCard
                          part={part}
                          addToolOutput={addToolOutput}
                          isConnected={isConnected}
                          onConnect={() => connect({ connector: connectors[0] })}
                          onSearchComplete={(query, results) => {
                            searchResultsRef.current = { query, results };
                          }}
                        />
                      </MessageContent>
                    );

                  default:
                    return null;
                }
              })}
            </Message>
          ))}

          {isLoading && (
            <Message from="assistant">
              <MessageContent>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Thinking...
                </div>
              </MessageContent>
            </Message>
          )}

          {(status === "error" || error) && (
            <Message from="assistant">
              <MessageContent className="w-full max-w-none">
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                  <div className="flex items-center gap-3">
                    <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
                    <div className="text-sm">
                      <p className="font-medium text-destructive">Error</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {error || "Something went wrong. Check your LLM settings."}
                      </p>
                    </div>
                  </div>
                </div>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="shrink-0 border-t border-border px-4 py-4">
        <div className="mx-auto w-full max-w-4xl">
          <PromptInput
            onSubmit={({ text }) => {
              const q = text.trim();
              if (!q || isLoading) return;
              setError(null);
              sendMessage({ text: q });
              setInput("");
            }}
          >
            <PromptInputBody>
              <PromptInputTextarea
                placeholder={
                  isConnected
                    ? "Ask anything - searches are private and paid with USDC..."
                    : "Connect your wallet to search with x402 payments..."
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                <Badge variant="secondary" className="text-[10px]">
                  3-Hop Relay + x402
                </Badge>
              </PromptInputTools>
              <PromptInputSubmit
                status={status}
                disabled={!input.trim() || isLoading}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}

type PrivateSearchPart = {
  type: "tool-private_search";
  toolCallId: string;
  state: ToolUIPart["state"];
  input?: { query?: string; paymentSignature?: string };
  output?: ToolOutput;
};

function ToolResultCard({
  part,
  addToolOutput,
  isConnected,
  onConnect,
  onSearchComplete,
}: {
  part: PrivateSearchPart;
  addToolOutput: AddToolOutputFn;
  isConnected: boolean;
  onConnect: () => void;
  onSearchComplete?: (query: string, results: string) => void;
}) {
  if (part.state !== "output-available" || !part.output) {
    return (
      <Tool defaultOpen>
        <ToolHeader title="private_search" type={part.type} state={part.state} />
        <ToolContent>
          <div className="flex items-center gap-3">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">
            Searching privately for &ldquo;{part.input?.query}&rdquo;...
          </span>
          </div>
        </ToolContent>
      </Tool>
    );
  }

  const { output } = part;

  if (output.status === "payment-required") {
    return (
      <PaymentCard
        query={output.query || part.input?.query || ""}
        paymentRequired={output.paymentRequired || ""}
        toolCallId={part.toolCallId}
        addToolOutput={addToolOutput}
        isConnected={isConnected}
        onConnect={onConnect}
        onSearchComplete={onSearchComplete}
      />
    );
  }

  if (output.status === "error") {
    return (
      <Tool defaultOpen className="border-destructive/30">
        <ToolHeader title="private_search" type={part.type} state={part.state} />
        <ToolContent className="bg-destructive/5">
          <div className="flex items-center gap-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
          <span className="text-sm">{output.error}</span>
          </div>
        </ToolContent>
      </Tool>
    );
  }

  if (output.status === "payment-signed") {
    return (
      <Tool defaultOpen>
        <ToolHeader title="private_search" type={part.type} state={part.state} />
        <ToolContent>
          <div className="flex items-center gap-3">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">
            Payment signed, completing search...
          </span>
          </div>
        </ToolContent>
      </Tool>
    );
  }

  return (
    <Tool defaultOpen className="border-primary/20 bg-muted/50">
      <ToolHeader title="private_search" type={part.type} state={part.state} />
      <ToolContent className="space-y-3">
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

        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="gap-1 text-[10px]">
            <Lock className="h-2.5 w-2.5" /> ZK Proof
          </Badge>
          <Badge variant="secondary" className="gap-1 text-[10px]">
            <Shield className="h-2.5 w-2.5" /> 3-Hop Relay
          </Badge>
          <Badge variant="secondary" className="gap-1 text-[10px]">
            <Zap className="h-2.5 w-2.5" /> USDC Settled
          </Badge>
        </div>

        {output.results && (
          <div className="space-y-3 border-t border-border pt-3">
            <SearchResults raw={output.results} />
          </div>
        )}
      </ToolContent>
    </Tool>
  );
}

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
};

function parseSearchResults(raw: string): {
  results: ParsedResult[];
  metadata: ParsedMetadata;
} {
  const results: ParsedResult[] = [];
  const metadata: ParsedMetadata = {};

  const [resultsSection, metaSection] = raw.split(/\n---\n/);

  const resultBlocks = (resultsSection || "")
    .replace(/^#.*\n\n?/, "")
    .split(/\n\n(?=\d+\.\s)/)
    .filter((b) => b.trim());

  for (const block of resultBlocks) {
    const lines = block.split("\n").map((l) => l.trim());
    const titleMatch = lines[0]?.match(/^\d+\.\s+\*\*(.+?)\*\*$/);
    const title = titleMatch?.[1] || lines[0]?.replace(/^\d+\.\s+/, "") || "";
    const url = lines[1] || "";
    const snippet = lines.slice(2).join(" ").trim();
    if (title) results.push({ title, url, snippet });
  }

  if (metaSection) {
    for (const line of metaSection.split("\n")) {
      const clean = line.replace(/^\*\*Metadata\*\*\s*/, "").trim();
      if (clean.startsWith("Results:")) metadata.totalResults = clean.replace("Results: ", "");
      else if (clean.startsWith("Search time:")) metadata.searchTime = clean.replace("Search time: ", "");
      else if (clean.startsWith("Result hash:")) metadata.resultHash = clean.replace("Result hash: ", "");
      else if (clean.startsWith("Routing:")) metadata.routing = clean.replace("Routing: ", "");
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
      <Sources>
        <SourcesTrigger count={results.length} className="rounded-md border border-border/50 bg-background/60 px-3 py-2" />
        <SourcesContent className="w-full rounded-md border border-border/40 bg-background/60 p-3">
          {results.map((r, i) => (
            <div key={i} className="space-y-1.5 pb-2 last:pb-0">
              {r.url ? (
                <Source href={r.url} title={r.title} className="min-w-0 gap-2">
                  <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="block min-w-0 truncate text-sm font-medium leading-tight text-primary hover:underline">
                    {r.title}
                  </span>
                </Source>
              ) : (
                <div className="flex min-w-0 items-center gap-2">
                  <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="block min-w-0 truncate text-sm font-medium leading-tight">
                    {r.title}
                  </span>
                </div>
              )}
              {r.url && <span className="block truncate pl-5.5 text-[11px] text-muted-foreground">{r.url}</span>}
              {r.snippet && <p className="pl-5.5 text-xs leading-relaxed text-muted-foreground">{r.snippet}</p>}
            </div>
          ))}
        </SourcesContent>
      </Sources>

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
    </div>
  );
}

function PaymentCard({
  query,
  paymentRequired,
  toolCallId,
  addToolOutput,
  isConnected,
  onConnect,
  onSearchComplete,
}: {
  query: string;
  paymentRequired: string;
  toolCallId: string;
  addToolOutput: AddToolOutputFn;
  isConnected: boolean;
  onConnect: () => void;
  onSearchComplete?: (query: string, results: string) => void;
}) {
  let price = "$0.001";
  try {
    const decoded = JSON.parse(atob(paymentRequired));
    const req0 = decoded.paymentRequirements?.[0] || decoded.accepts?.[0];
    const amount = req0?.maxAmountRequired || req0?.amount || "1000";
    price = `$${(Number(amount) / 1_000_000).toFixed(4)}`;
  } catch {}

  return (
    <Tool defaultOpen className="border-yellow-500/30 bg-yellow-500/5">
      <ToolHeader title="private_search" type="tool-private_search" state="output-available" />
      <ToolContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-yellow-500" />
          <span className="text-sm font-medium">Payment Required</span>
          <Badge variant="outline" className="border-yellow-500/30 text-[10px] text-yellow-500">
            {price} USDC
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Searching for &ldquo;{query}&rdquo; requires a USDC micropayment on Base
          Sepolia. The payment is settled on-chain with no identity linked.
        </p>
        {!isConnected ? (
          <Button variant="outline" size="sm" className="gap-2" onClick={onConnect}>
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
      </ToolContent>
    </Tool>
  );
}

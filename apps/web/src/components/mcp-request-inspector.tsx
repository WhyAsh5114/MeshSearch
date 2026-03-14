"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CircleSlash,
  Clock3,
  RefreshCw,
  Route,
  Search,
  Server,
  Shield,
  Trash2,
  Wallet,
} from "lucide-react";
import type { McpTraceEntry } from "@/lib/mcp-trace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Switch } from "@/components/ui/switch";

const POLL_MS = 2500;

type ApiResponse = {
  traces: McpTraceEntry[];
  count: number;
};

function formatLatency(ms?: number) {
  if (ms === undefined) return "-";
  return `${ms} ms`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString();
}

function outcomeVariant(
  outcome: McpTraceEntry["outcome"]
): "default" | "secondary" | "destructive" | "outline" {
  if (outcome === "success") return "default";
  if (outcome === "payment-required") return "secondary";
  if (outcome === "error") return "destructive";
  return "outline";
}

function toPrettyJson(value: unknown) {
  if (!value) return "-";
  return JSON.stringify(value, null, 2);
}

export function McpRequestInspector() {
  const [traces, setTraces] = useState<McpTraceEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bitgoStatus, setBitgoStatus] = useState<"connected" | "error" | "disabled" | "unknown">("unknown");

  const fetchTraces = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setRefreshing(true);

    try {
      const res = await fetch("/api/mcp-requests", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Failed to load traces (${res.status})`);
      }

      const data = (await res.json()) as ApiResponse;
      setTraces(data.traces);
      setError(null);

      setSelectedId((prev) => {
        if (!data.traces.length) return null;
        if (prev && data.traces.some((entry) => entry.id === prev)) return prev;
        return data.traces[0].id;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      if (showSpinner) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchTraces(false);
  }, [fetchTraces]);

  // Poll MCP health for BitGo status
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const data = await res.json();
        const status = typeof data.bitgo === "object" ? data.bitgo?.status : data.bitgo;
        if (!cancelled) {
          if (status === "connected") setBitgoStatus("connected");
          else if (status === "error") setBitgoStatus("error");
          else if (status === "disabled") setBitgoStatus("disabled");
          else setBitgoStatus("unknown");
        }
      } catch {
        if (!cancelled) setBitgoStatus("unknown");
      }
    }
    void poll();
    const timer = window.setInterval(poll, 10_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      void fetchTraces(false);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh, fetchTraces]);

  const selected = useMemo(
    () => traces.find((entry) => entry.id === selectedId) ?? null,
    [selectedId, traces]
  );

  const stats = useMemo(() => {
    let success = 0;
    let paymentRequired = 0;
    let errors = 0;
    for (const trace of traces) {
      if (trace.outcome === "success") success += 1;
      else if (trace.outcome === "payment-required") paymentRequired += 1;
      else if (trace.outcome === "error") errors += 1;
    }
    return { success, paymentRequired, errors };
  }, [traces]);

  const onClear = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/mcp-requests", { method: "DELETE" });
      if (!res.ok) {
        throw new Error(`Failed to clear traces (${res.status})`);
      }
      setTraces([]);
      setSelectedId(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, []);

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <section className="border-b border-border bg-card/70">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground hover:text-foreground"
              aria-label="Back to landing page"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15">
              <Server className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">MCP Request Inspector</p>
              <p className="text-xs text-muted-foreground">
                Live trace of MCP metadata, routing, and response outcomes
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/chat">Open Chat</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 md:px-6">
        {/* Stats cards */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-xs text-muted-foreground">
                Total Requests
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <p className="text-2xl font-semibold">{traces.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-xs text-muted-foreground">
                Success
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <p className="text-2xl font-semibold text-emerald-400">
                {stats.success}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-xs text-muted-foreground">
                Payment Required
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <p className="text-2xl font-semibold text-amber-400">
                {stats.paymentRequired}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-xs text-muted-foreground">
                Errors
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <p className="text-2xl font-semibold text-red-400">
                {stats.errors}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Controls */}
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch
                checked={autoRefresh}
                onCheckedChange={setAutoRefresh}
              />
              Auto refresh every {POLL_MS / 1000}s
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void fetchTraces(true)}
                disabled={refreshing}
                className="gap-1.5"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void onClear()}
                className="gap-1.5"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Main split panel */}
        <div className="grid min-h-[58vh] gap-4 lg:grid-cols-[0.95fr_1.05fr]">
          {/* Request list */}
          <Card className="overflow-hidden">
            <CardHeader className="border-b border-border/60 p-4">
              <CardTitle className="text-sm">Recent Requests</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[58vh]">
                <div className="space-y-1 p-2">
                  {loading && (
                    <div className="rounded-lg border border-border bg-muted/40 px-3 py-4 text-xs text-muted-foreground">
                      Loading request traces...
                    </div>
                  )}

                  {!loading && traces.length === 0 && (
                    <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-8 text-center text-sm text-muted-foreground">
                      No MCP requests yet. Run a query in chat to populate this
                      inspector.
                    </div>
                  )}

                  {traces.map((trace) => {
                    const active = selectedId === trace.id;
                    return (
                      <button
                        key={trace.id}
                        type="button"
                        onClick={() => setSelectedId(trace.id)}
                        className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                          active
                            ? "border-primary/40 bg-primary/10"
                            : "border-border/70 bg-muted/20 hover:bg-muted/40"
                        }`}
                      >
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-xs text-primary">
                            {trace.method}
                          </span>
                          <Badge
                            variant={outcomeVariant(trace.outcome)}
                            className="text-[10px] uppercase"
                          >
                            {trace.outcome}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Clock3 className="h-3 w-3" />
                            {formatTime(trace.createdAt)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Route className="h-3 w-3" />
                            {trace.route}
                          </span>
                          {trace.latencyMs !== undefined && (
                            <span className="inline-flex items-center gap-1">
                              <CircleSlash className="h-3 w-3" />
                              {formatLatency(trace.latencyMs)}
                            </span>
                          )}
                        </div>
                        {trace.query && (
                          <p className="mt-2 truncate text-xs text-foreground/90">
                            {trace.query}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Detail panel */}
          <Card className="overflow-hidden">
            <CardHeader className="border-b border-border/60 p-4">
              <CardTitle className="text-sm">Request Detail</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              {!selected && (
                <div className="flex h-[52vh] items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 text-sm text-muted-foreground">
                  Select a request to inspect metadata and routing details.
                </div>
              )}

              {selected && (
                <Tabs defaultValue="overview" className="w-full">
                  <TabsList className="mb-2 grid w-full grid-cols-4">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="metadata">Metadata</TabsTrigger>
                    <TabsTrigger value="payload">Payload</TabsTrigger>
                    <TabsTrigger value="response">Response</TabsTrigger>
                  </TabsList>

                  <TabsContent value="overview" className="space-y-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <InfoRow label="Method" value={selected.method} />
                      <InfoRow label="Route" value={selected.route} />
                      <InfoRow
                        label="Status"
                        value={String(selected.statusCode ?? "-")}
                      />
                      <InfoRow
                        label="Latency"
                        value={formatLatency(selected.latencyMs)}
                      />
                      <InfoRow
                        label="Tool"
                        value={selected.toolName || "-"}
                      />
                      <InfoRow
                        label="Request Id"
                        value={String(selected.requestId ?? "-")}
                      />
                    </div>

                    <Accordion
                      type="multiple"
                      defaultValue={["routing"]}
                      className="rounded-lg border border-border/60 px-3"
                    >
                      <AccordionItem value="routing" className="border-b-0">
                        <AccordionTrigger className="py-3">
                          <span className="inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.08em] text-muted-foreground">
                            <Shield className="h-3.5 w-3.5" />
                            Routing Context
                          </span>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-2 pb-1 text-xs">
                            <InfoRow
                              label="Session"
                              value={selected.sessionId || "-"}
                            />
                            <InfoRow
                              label="Payment Signature"
                              value={
                                selected.hasPaymentSignature
                                  ? "present"
                                  : "absent"
                              }
                            />
                            <InfoRow
                              label="Query"
                              value={selected.query || "-"}
                            />
                            {selected.txHash && (
                              <InfoRow
                                label="Tx Hash"
                                value={selected.txHash}
                              />
                            )}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>

                    {selected.resultPreview && (
                      <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                        <p className="mb-1 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                          Result Preview
                        </p>
                        <p className="text-xs leading-relaxed text-foreground/90">
                          {selected.resultPreview}
                        </p>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="metadata" className="space-y-3">
                    {selected.metadata ? (
                      <div className="grid gap-2">
                        <InfoRow
                          label="Results"
                          value={selected.metadata.totalResults || "-"}
                        />
                        <InfoRow
                          label="Search Time"
                          value={selected.metadata.searchTime || "-"}
                        />
                        <InfoRow
                          label="Result Hash"
                          value={selected.metadata.resultHash || "-"}
                        />
                        <InfoRow
                          label="Routing"
                          value={selected.metadata.routing || "-"}
                        />
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-6 text-sm text-muted-foreground">
                        No metadata parsed for this request.
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="payload" className="space-y-3">
                    <JsonBlock
                      title="Request Headers"
                      value={selected.requestHeaders}
                    />
                    <JsonBlock
                      title="Request Payload"
                      value={selected.requestPayload}
                    />
                  </TabsContent>

                  <TabsContent value="response" className="space-y-3">
                    <JsonBlock
                      title="Response Summary"
                      value={selected.responseSummary}
                    />
                    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                      <p className="mb-1 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                        Error
                      </p>
                      <p className="text-xs">{selected.error || "-"}</p>
                    </div>
                  </TabsContent>
                </Tabs>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Error bar */}
        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* Footer badges */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="gap-1 text-[10px]">
            <Search className="h-3 w-3" /> tools/call
          </Badge>
          <Badge variant="outline" className="gap-1 text-[10px]">
            <Route className="h-3 w-3" /> routing metadata
          </Badge>
          <Badge variant="outline" className="gap-1 text-[10px]">
            <RefreshCw className="h-3 w-3" /> live polling
          </Badge>
          <Badge
            variant={bitgoStatus === "connected" ? "default" : "outline"}
            className={`gap-1 text-[10px] ${
              bitgoStatus === "connected"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                : bitgoStatus === "error"
                  ? "border-red-500/40 bg-red-500/10 text-red-400"
                  : bitgoStatus === "disabled"
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                    : ""
            }`}
          >
            <Wallet className="h-3 w-3" />
            BitGo {bitgoStatus}
          </Badge>
        </div>
      </section>
    </main>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <p className="mb-1 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </p>
      <pre className="overflow-x-auto text-[11px] leading-relaxed text-foreground/90">
        {toPrettyJson(value)}
      </pre>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 break-all font-mono text-xs text-foreground/90">
        {value}
      </p>
    </div>
  );
}

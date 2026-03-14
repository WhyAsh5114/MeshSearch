import Link from "next/link";
import {
  ArrowRight,
  Shield,
  Zap,
  Route,
  FileLock2,
  Server,
  CheckCircle2,
  Wallet,
  Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const features = [
  {
    icon: Shield,
    title: "ZK-Committed Queries",
    description:
      "Queries are committed client-side with zero-knowledge proofs before leaving your device.",
  },
  {
    icon: Route,
    title: "3-Hop Onion Routing",
    description:
      "Traffic flows through ENS-named relays to create an auditable privacy path for every search.",
  },
  {
    icon: Zap,
    title: "x402 Micropayments",
    description:
      "Per-search USDC payments settle on Base Sepolia with no account-based identity required.",
  },
  {
    icon: FileLock2,
    title: "Encrypted History",
    description:
      "Search history is encrypted and stored on Fileverse so only your wallet can decrypt it.",
  },
];

const toolRows = [
  {
    name: "private_search",
    description: "ZK-committed search with onion routing and x402 payment",
  },
  {
    name: "get_history",
    description: "Retrieve and decrypt search history from Fileverse",
  },
  {
    name: "compile_report",
    description: "Aggregate searches into an encrypted Fileverse document",
  },
];

const stack = [
  "MCP server for AI agents",
  "SearXNG search backend",
  "Base Sepolia smart contracts",
  "Fileverse encrypted storage",
  "Wallet-native web app",
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary">
              <Shield className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-none">MeshSearch</p>
              <p className="text-xs text-muted-foreground">
                Private Search Infrastructure for AI
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/chat">
                Open Chat
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 pb-12 pt-10 md:pb-16 md:pt-14">
        <div className="grid items-start gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-6">
            <Badge
              variant="secondary"
              className="rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.12em]"
            >
              Cryptographic Privacy, Not Promises
            </Badge>
            <h1 className="max-w-2xl text-4xl font-semibold leading-tight tracking-tight text-balance md:text-6xl md:leading-[1.05]">
              Private web search for AI agents and humans.
            </h1>
            <p className="max-w-2xl text-base text-muted-foreground md:text-lg">
              MeshSearch is an MCP-powered search layer where queries are
              protected with zero-knowledge commitments, routed through relay
              hops, paid with x402 USDC micropayments, and stored as encrypted
              history.
            </p>

            <div className="flex flex-wrap gap-3 pt-2">
              <Button asChild size="lg">
                <Link href="/chat">
                  Start Private Search
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="https://x402.org" target="_blank" rel="noreferrer">
                  Learn x402
                </Link>
              </Button>
            </div>

            <div className="grid gap-3 pt-3 sm:grid-cols-3">
              <Card>
                <CardContent className="flex items-center gap-3 p-4">
                  <Wallet className="h-4 w-4 text-primary" />
                  <div>
                    <p className="text-sm font-medium">Wallet Native</p>
                    <p className="text-xs text-muted-foreground">
                      Connect and pay per search
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex items-center gap-3 p-4">
                  <Bot className="h-4 w-4 text-primary" />
                  <div>
                    <p className="text-sm font-medium">MCP Tooling</p>
                    <p className="text-xs text-muted-foreground">
                      Works with AI agents
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex items-center gap-3 p-4">
                  <Server className="h-4 w-4 text-primary" />
                  <div>
                    <p className="text-sm font-medium">Self-Hostable</p>
                    <p className="text-xs text-muted-foreground">
                      Runs in your own stack
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">MCP Tools</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {toolRows.map((tool) => (
                <div
                  key={tool.name}
                  className="rounded-lg border border-border bg-muted p-3"
                >
                  <p className="font-mono text-xs text-primary">{tool.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {tool.description}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="border-y border-border bg-card">
        <div className="mx-auto w-full max-w-6xl px-6 py-12 md:py-14">
          <div className="mb-5 flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-primary" />
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Core Capabilities
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <Card key={feature.title}>
                  <CardContent className="p-5">
                    <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <h3 className="text-lg font-semibold">{feature.title}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {feature.description}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 py-12 md:py-16">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Deployment Stack Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {stack.map((item) => (
              <div
                key={item}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                <span>{item}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card p-5">
          <div>
            <p className="text-base font-semibold">
              Ready to run a private paid search?
            </p>
            <p className="text-sm text-muted-foreground">
              Open the chat app, connect your wallet, and execute your first
              x402-backed query.
            </p>
          </div>
          <Button asChild size="lg">
            <Link href="/chat">
              Go To Chat
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>
    </main>
  );
}

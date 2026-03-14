import { NextResponse } from "next/server";

const MCP_URL = process.env.MCP_URL || "http://localhost:3038";

export type BitGoHealthInfo =
  | {
      status: "connected";
      env: string;
      coin: string;
      walletId: string;
      walletLabel: string | null;
      balance: string | null;
      expressUrl: string | null;
      expressReachable: boolean | null;
      relayWallets: number;
      error: string | null;
    }
  | { status: "error"; error: string | null; [key: string]: unknown }
  | { status: "disabled" }
  | { status: "unknown" };

export type HealthResponse = {
  status: string;
  transport?: string;
  sessions?: number;
  bitgo: BitGoHealthInfo;
};

export async function GET() {
  try {
    const res = await fetch(`${MCP_URL}/health`, { cache: "no-store" });
    const data = (await res.json()) as HealthResponse;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { status: "unreachable", bitgo: { status: "unknown" } } satisfies HealthResponse,
      { status: 503 }
    );
  }
}

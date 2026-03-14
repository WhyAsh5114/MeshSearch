import { NextResponse } from "next/server";

const MCP_URL = process.env.MCP_URL || "http://localhost:3038";

export type BitGoHealthInfo =
  | { status: "enabled"; env: string; coin: string; walletId: string; expressUrl: string | null; relayWallets: number }
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

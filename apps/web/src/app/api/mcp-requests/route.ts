import { clearMcpTraces, getMcpTraces } from "@/lib/mcp-trace";

export async function GET() {
  const traces = getMcpTraces();
  return Response.json({ traces, count: traces.length });
}

export async function DELETE() {
  clearMcpTraces();
  return Response.json({ ok: true });
}

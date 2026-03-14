const MCP_URL = process.env.MCP_URL || "http://localhost:3038";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = url.searchParams.get("limit") || "20";

  const response = await fetch(`${MCP_URL}/history?limit=${encodeURIComponent(limit)}`, {
    method: "GET",
    cache: "no-store",
  });

  const body = await response.text();

  return new Response(body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
    },
  });
}

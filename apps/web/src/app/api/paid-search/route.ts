import { executeSearch } from "@/lib/tools";

export async function POST(req: Request) {
  const { query, paymentSignature } = (await req.json()) as {
    query: string;
    paymentSignature: string;
  };

  if (!query || !paymentSignature) {
    return Response.json(
      { status: "error", error: "Missing query or paymentSignature" },
      { status: 400 }
    );
  }

  const result = await executeSearch({ query, paymentSignature });
  return Response.json(result);
}

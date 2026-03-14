import {
  streamText,
  UIMessage,
  convertToModelMessages,
  InferUITools,
  UIDataTypes,
  stepCountIs,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { tools } from "@/lib/tools";

export const maxDuration = 60;

// Export typed message for client consumption
export type ChatTools = InferUITools<typeof tools>;
export type ChatMessage = UIMessage<never, UIDataTypes, ChatTools>;

export async function POST(req: Request) {
  const body = (await req.json()) as {
    messages: ChatMessage[];
    llmConfig?: { apiKey?: string; baseURL?: string; model?: string };
    lastSearchResults?: { query: string; results: string };
  };
  const { messages, llmConfig, lastSearchResults } = body;

  // Runtime config from request body, with env-var fallbacks
  const apiKey =
    llmConfig?.apiKey ||
    process.env.LLM_API_KEY ||
    process.env.OPENAI_API_KEY ||
    "no-key";
  const baseURL = llmConfig?.baseURL || process.env.LLM_BASE_URL || undefined;
  const modelId = llmConfig?.model || process.env.LLM_MODEL || "gpt-4o-mini";

  const provider = createOpenAI({
    apiKey,
    baseURL,
    name: "llm", // Avoid OpenAI-specific validation for compatible endpoints
  });

  console.log(`[chat] Using model=${modelId} baseURL=${baseURL ?? "(default)"} messages=${messages.length}`);

  try {
    const searchContext = lastSearchResults
      ? `\n\nPREVIOUS SEARCH CONTEXT — The user already paid for and received these results (do NOT ask them to search or pay again):\nQuery: "${lastSearchResults.query}"\nResults:\n${lastSearchResults.results}`
      : "";

    const result = streamText({
      model: provider.chat(modelId),
      system: `You are MeshSearch, a privacy-preserving AI search assistant.

When the user asks you to search for something, use the private_search tool.

IMPORTANT tool behavior:
- If the tool returns status "payment-required", tell the user a USDC micropayment is needed and they should approve it in the UI. Do NOT call the tool again until the user provides a payment signature.
- If the tool returns status "payment-signed", the user has approved payment. Immediately re-call private_search with the same query AND the paymentSignature from the output.
- If the tool returns status "success", present the search results clearly with the transaction hash if available.
- If the tool returns status "error", explain the error to the user.

Keep responses concise and helpful. Format search results nicely using markdown.${searchContext}`,
      messages: await convertToModelMessages(messages),
      tools,
      stopWhen: stepCountIs(5),
      onError({ error }) {
        console.error("[chat] streamText error:", error);
      },
    });

    return result.toUIMessageStreamResponse({
      onError(error) {
        console.error("[chat] stream error:", error);
        return error instanceof Error ? error.message : String(error);
      },
    });
  } catch (err) {
    console.error("[chat] route error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

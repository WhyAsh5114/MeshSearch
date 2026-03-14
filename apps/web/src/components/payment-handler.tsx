"use client";

import { useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { Button } from "@/components/ui/button";
import { Loader2, Zap } from "lucide-react";
import type { PrivateSearchResult } from "@/lib/tools";

type AddToolOutputFn = (opts:
  | { tool: "private_search"; toolCallId: string; output: PrivateSearchResult }
  | { state: "output-error"; tool: "private_search"; toolCallId: string; errorText: string }
) => void;

/**
 * Handles x402 payment signing using the connected wallet.
 */
export function PaymentHandler({
  query,
  paymentRequired,
  toolCallId,
  addToolOutput,
  onSearchComplete,
}: {
  query: string;
  paymentRequired: string;
  toolCallId: string;
  addToolOutput: AddToolOutputFn;
  onSearchComplete?: (query: string, results: string) => void;
}) {
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: walletClient } = useWalletClient();

  const handlePay = async () => {
    if (!walletClient) {
      setError("Wallet not connected");
      return;
    }

    setSigning(true);
    setError(null);

    try {
      // Dynamically import x402 modules (they're heavy, no need to load at startup)
      const { x402Client, x402HTTPClient } = await import(
        "@x402/core/client"
      );
      const { registerExactEvmScheme } = await import(
        "@x402/evm/exact/client"
      );
      const { toClientEvmSigner } = await import("@x402/evm");
      const { createPublicClient, http } = await import("viem");
      const { baseSepolia } = await import("viem/chains");
      const { decodePaymentRequiredHeader } = await import("@x402/core/http");

      // Create x402 signer from the wagmi wallet
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(),
      });

      // Adapt wagmi wallet client to x402's expected signer shape.
      // useWalletClient() returns a full WalletClient with signTypedData.
      // toClientEvmSigner expects top-level address + signTypedData + readContract.
      const account = walletClient.account;
      if (!account) {
        throw new Error("Wallet account not available — please reconnect");
      }
      const signer = toClientEvmSigner(
        {
          address: account.address,
          signTypedData: (args) => walletClient.signTypedData(args as Parameters<typeof walletClient.signTypedData>[0]),
        },
        publicClient,
      );

      const coreClient = new x402Client();
      registerExactEvmScheme(coreClient, { signer });
      const httpClient = new x402HTTPClient(coreClient);

      // Decode payment requirements from header
      const paymentReqs = decodePaymentRequiredHeader(paymentRequired);

      // Create and sign payment
      const paymentPayload = await httpClient.createPaymentPayload(paymentReqs);
      const paymentHeaders =
        httpClient.encodePaymentSignatureHeader(paymentPayload);
      const sig =
        paymentHeaders["payment-signature"] ||
        paymentHeaders["PAYMENT-SIGNATURE"] ||
        Object.values(paymentHeaders)[0];

      if (!sig) {
        throw new Error("Failed to generate payment signature");
      }

      // Actually execute the paid search by sending the signature to the MCP
      // server. The previous tool call only returned payment-required; we
      // now complete the round-trip so the payment settles on-chain.
      const searchRes = await fetch("/api/paid-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, paymentSignature: sig }),
      });
      const searchResult = await searchRes.json();

      if (searchResult.status === "error") {
        throw new Error(searchResult.error || "Search failed after payment");
      }

      // Provide the final search results back to the chat UI
      addToolOutput({
        tool: "private_search",
        toolCallId,
        output: searchResult,
      });

      // Notify parent so it can send a follow-up message to the LLM
      // with the results in context (addToolOutput alone doesn't update
      // the LLM's view of the conversation)
      if (onSearchComplete && searchResult.results) {
        onSearchComplete(query, searchResult.results);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setSigning(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        size="sm"
        className="gap-2"
        onClick={handlePay}
        disabled={signing}
      >
        {signing ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Signing Payment...
          </>
        ) : (
          <>
            <Zap className="h-3.5 w-3.5" />
            Pay & Search
          </>
        )}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

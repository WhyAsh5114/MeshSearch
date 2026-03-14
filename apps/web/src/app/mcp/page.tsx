import type { Metadata } from "next";
import { McpRequestInspector } from "@/components/mcp-request-inspector";

export const metadata: Metadata = {
  title: "MCP Inspector | MeshSearch",
  description: "Inspect live MCP request metadata and routing for MeshSearch",
};

export default function McpInspectorPage() {
  return <McpRequestInspector />;
}

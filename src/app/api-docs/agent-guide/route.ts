import { leadApiAgentGuide } from "../../../lib/lead-api-documentation.ts";

export const dynamic = "force-static";

export function GET() {
  return new Response(leadApiAgentGuide, {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-cache" },
  });
}

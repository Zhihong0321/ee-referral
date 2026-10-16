import { leadApiOpenApi } from "../../../lib/lead-api-openapi.ts";

export const dynamic = "force-static";

export function GET() {
  return Response.json(leadApiOpenApi, { headers: { "Cache-Control": "no-cache" } });
}

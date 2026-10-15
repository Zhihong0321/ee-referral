import { createListSourcesApiHandler } from "@/lib/lead-api";
import { listApiSources } from "@/lib/lead-intake";
import { runWhatsappAgentSql } from "@/lib/agent/whatsapp-data";

export const runtime = "nodejs";

export const GET = createListSourcesApiHandler({
  getApiKey: () => process.env.LEADS_API_KEY,
  listSources: () => listApiSources(runWhatsappAgentSql),
});

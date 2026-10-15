import { createListAgentsApiHandler } from "@/lib/lead-api";
import { listApiAgents } from "@/lib/lead-intake";
import { runWhatsappAgentSql } from "@/lib/agent/whatsapp-data";

export const runtime = "nodejs";

export const GET = createListAgentsApiHandler({
  getApiKey: () => process.env.LEADS_API_KEY,
  listAgents: () => listApiAgents(runWhatsappAgentSql),
});

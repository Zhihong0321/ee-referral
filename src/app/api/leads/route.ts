import { createLeadApiHandler } from "@/lib/lead-api";
import { createApiLead } from "@/lib/lead-intake";
import { runWhatsappAgentSql } from "@/lib/agent/whatsapp-data";

export const runtime = "nodejs";

export const POST = createLeadApiHandler({
  getApiKey: () => process.env.LEADS_API_KEY,
  createLead: (input) => createApiLead(input, runWhatsappAgentSql),
});

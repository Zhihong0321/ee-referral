import { createLeadApiHandler, createListLeadsApiHandler } from "@/lib/lead-api";
import { createApiLead, listApiLeads } from "@/lib/lead-intake";
import { runWhatsappAgentSql } from "@/lib/agent/whatsapp-data";

export const runtime = "nodejs";

export const GET = createListLeadsApiHandler({
  getApiKey: () => process.env.LEADS_API_KEY,
  listLeads: (query) => listApiLeads(query, runWhatsappAgentSql),
});

export const POST = createLeadApiHandler({
  getApiKey: () => process.env.LEADS_API_KEY,
  createLead: (input) => createApiLead(input, runWhatsappAgentSql),
});

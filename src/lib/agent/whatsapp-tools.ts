/**
 * WhatsApp Agent Tools - LLM-First Architecture
 *
 * Each tool wraps a real, validated function from whatsapp-data.ts. The LLM
 * calls tools to read context and perform writes. Tools validate inputs and
 * return structured success/error results so the LLM can recover from mistakes.
 *
 * IMPORTANT: The underlying data layer only supports lead name, mobile number,
 * and area (state). It does NOT store lead email or a separate city, and there
 * is no delete/cancel-lead operation. Tools below reflect that reality exactly.
 */

import {
  createWhatsappReferral,
  updateWhatsappReferral,
  listWhatsappReferrals,
  listWhatsappAgents,
  searchReferrersByPhonePartial,
  searchReferrerByPhone,
  createReferrerOnBehalf,
  saveReferrerProfile,
  type WhatsappReferrerAccount,
  type WhatsappAgentOption,
} from "./whatsapp-data";
import { toCanonicalMalaysiaPhone } from "@/lib/phone-normalization";
import { matchAgentName } from "./whatsapp-intent";
import type { ReferralRow } from "@/lib/referrals";

// ============================================================================
// Tool Definitions for MiniMax-M3 (Anthropic-compatible tool schema)
// ============================================================================

export const REGULAR_USER_TOOLS = [
  {
    name: "get_my_profile",
    description: "Get the current referrer's profile (name, bank account, lead count).",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_my_leads",
    description: "List all leads created by this referrer, numbered newest first, with status and assigned agent.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "search_agents",
    description: "Search available sales agents by name. Use before assigning an agent to confirm the exact match.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Agent name or partial name to search for." },
      },
      required: ["query"],
    },
  },
  {
    name: "save_my_profile",
    description: "Save the referrer's name and bank account for commission payouts. Both are required to register.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Referrer's full name." },
        bankAccount: { type: "string", description: "Bank account number for commission payments." },
      },
      required: ["name", "bankAccount"],
    },
  },
  {
    name: "create_lead",
    description: "Create a new referral lead. Requires a mobile phone number. Optionally include name, area, and a preferred agent.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Lead's name." },
        phone: { type: "string", description: "Lead's mobile phone number (Malaysia format). Required." },
        area: { type: "string", description: "Lead's area or state (e.g. Selangor)." },
        preferredAgentName: { type: "string", description: "Name of the preferred sales agent to assign." },
      },
      required: ["phone"],
    },
  },
  {
    name: "update_lead",
    description: "Update one field of an existing lead by its number from get_my_leads. Call once per field to change.",
    input_schema: {
      type: "object",
      properties: {
        leadNumber: { type: "number", description: "The lead number (1, 2, 3...) from get_my_leads." },
        field: {
          type: "string",
          enum: ["name", "phone", "area", "preferredAgent"],
          description: "Which field to update.",
        },
        value: { type: "string", description: "New value. For preferredAgent, pass the agent's name." },
      },
      required: ["leadNumber", "field", "value"],
    },
  },
];

export const ADMIN_TOOLS = [
  {
    name: "admin_lookup",
    description: "Look up a referrer by phone number OR account name (fuzzy) and get their existing leads in one call. Returns every matching referrer, each with their numbered leads (and the agent assigned to each). Use this first for any admin task — searching, then adding/assigning uses the same query string.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Phone number, partial phone, or referrer name." },
      },
      required: ["query"],
    },
  },
  {
    name: "admin_create_referrer",
    description: "Create a new referrer account. Requires name and phone number.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Referrer's full name." },
        phone: { type: "string", description: "Referrer's phone number (Malaysia format)." },
      },
      required: ["name", "phone"],
    },
  },
  {
    name: "admin_add_lead",
    description: "Add a NEW lead for a referrer (identified by phone OR name). Optionally assign a sales agent at the same time. If the referrer query matches more than one account, you will be told to pick one.",
    input_schema: {
      type: "object",
      properties: {
        referrer: { type: "string", description: "The referrer's phone number or account name." },
        name: { type: "string", description: "Lead's name." },
        phone: { type: "string", description: "Lead's mobile phone number. Required." },
        area: { type: "string", description: "Lead's area or state." },
        preferredAgentName: { type: "string", description: "Sales agent name to assign to this new lead." },
      },
      required: ["referrer", "phone"],
    },
  },
  {
    name: "admin_assign_agent",
    description: "Assign a sales agent to one of a referrer's EXISTING leads. Use admin_lookup first to get the lead number. Referrer by phone or name, lead by number, agent by name.",
    input_schema: {
      type: "object",
      properties: {
        referrer: { type: "string", description: "The referrer's phone number or account name." },
        leadNumber: { type: "number", description: "The lead number from admin_lookup." },
        agentName: { type: "string", description: "The sales agent's name to assign." },
      },
      required: ["referrer", "leadNumber", "agentName"],
    },
  },
];

// ============================================================================
// Tool Result Types
// ============================================================================

type ToolSuccess<T = unknown> = { success: true; data: T; message?: string };
type ToolError = { success: false; error: string; hint?: string };
type ToolResult<T = unknown> = ToolSuccess<T> | ToolError;

/**
 * Per-turn state shared across every tool call in a single agent turn.
 * Used to enforce "look before you leap": update_lead cannot run until the
 * model has actually listed the current leads this turn (prevents the model
 * from inventing lead numbers, which corrupted the wrong lead in testing).
 */
export type TurnContext = {
  /** Lead ids returned by get_my_leads this turn; null until it is called. */
  listedLeadIds: number[] | null;
};

export function createTurnContext(): TurnContext {
  return { listedLeadIds: null };
}

// ============================================================================
// Dispatchers
// ============================================================================

export async function executeRegularTool(
  toolName: string,
  input: Record<string, unknown>,
  referrer: WhatsappReferrerAccount,
  leads: ReferralRow[],
  agents: WhatsappAgentOption[],
  ctx: TurnContext,
): Promise<ToolResult> {
  switch (toolName) {
    case "get_my_profile":
      return getMyProfile(referrer, leads);
    case "get_my_leads":
      // Record which lead ids the model has now actually seen this turn.
      ctx.listedLeadIds = leads.map((lead) => lead.id);
      return getMyLeads(leads);
    case "search_agents":
      return searchAgents(input, agents);
    case "save_my_profile":
      return saveMyProfile(input, referrer);
    case "create_lead":
      return createLead(input, referrer, leads, agents);
    case "update_lead":
      return updateLead(input, referrer, leads, agents, ctx);
    default:
      return { success: false, error: `Unknown tool: ${toolName}` };
  }
}

export async function executeAdminTool(
  toolName: string,
  input: Record<string, unknown>,
  adminPhone: string,
): Promise<ToolResult> {
  switch (toolName) {
    case "admin_lookup":
      return adminLookup(input);
    case "admin_create_referrer":
      return adminCreateReferrer(input, adminPhone);
    case "admin_add_lead":
      return adminAddLead(input);
    case "admin_assign_agent":
      return adminAssignAgent(input);
    default:
      return { success: false, error: `Unknown admin tool: ${toolName}` };
  }
}

// ============================================================================
// Shared helpers
// ============================================================================

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Resolve a preferred-agent name to a single agent id, or return a tool error
 * describing why it could not be resolved (missing / none / ambiguous).
 */
function resolveAgentId(name: string, agents: WhatsappAgentOption[]): ToolResult<string> {
  const match = matchAgentName(name, agents);
  if (match.status === "matched") {
    return { success: true, data: match.matches[0].id };
  }
  if (match.status === "ambiguous") {
    return {
      success: false,
      error: `"${name}" matches multiple agents: ${match.matches.map((a) => a.name).join(", ")}.`,
      hint: "Ask the user which one they mean.",
    };
  }
  return {
    success: false,
    error: `No agent found matching "${name}".`,
    hint: "Use search_agents to list valid agents, or ask the user to confirm the name.",
  };
}

/**
 * Resolve a referrer from a phone number OR an account name (fuzzy).
 * - Exact phone match wins immediately.
 * - Otherwise search by phone fragment / name; exactly one match resolves,
 *   multiple matches return an error listing them so the model can disambiguate.
 */
async function resolveReferrer(query: string): Promise<ToolResult<WhatsappReferrerAccount>> {
  // Try an exact phone match first when the query looks like a number.
  const normalizedPhone = toCanonicalMalaysiaPhone(query);
  if (normalizedPhone) {
    const byPhone = await searchReferrerByPhone(normalizedPhone);
    if (byPhone) return { success: true, data: byPhone };
  }

  // Fall back to fuzzy phone/name search.
  const matches = await searchReferrersByPhonePartial(query, 10);
  if (matches.length === 0) {
    return {
      success: false,
      error: `Referrer not found: "${query}".`,
      hint: "Use admin_create_referrer to create them, or try a different phone/name.",
    };
  }
  if (matches.length > 1) {
    const list = matches.map((m) => `${m.name || "(no name)"} — ${m.phone || "no phone"}`).join("; ");
    return {
      success: false,
      error: `"${query}" matches multiple referrers: ${list}.`,
      hint: "Ask the user which referrer (by phone) before adding the lead.",
    };
  }

  const only = matches[0];
  return {
    success: true,
    data: {
      customerId: only.customerId,
      name: only.name || "Referral",
      phone: only.phone || "",
      bankAccount: "",
      registered: false,
    },
  };
}

// ============================================================================
// Regular User Tools
// ============================================================================

function getMyProfile(referrer: WhatsappReferrerAccount, leads: ReferralRow[]): ToolResult {
  return {
    success: true,
    data: {
      name: referrer.name || "(not set)",
      phone: referrer.phone,
      bankAccount: referrer.bankAccount || "(not set)",
      registered: referrer.registered,
      totalLeads: leads.length,
    },
  };
}

function getMyLeads(leads: ReferralRow[]): ToolResult {
  const formatted = leads.map((lead, idx) => ({
    number: idx + 1,
    id: lead.id,
    name: lead.leadName || "(no name)",
    phone: lead.leadMobile || "(no phone)",
    area: [lead.leadState, lead.leadCity].filter(Boolean).join(", ") || "(not provided)",
    preferredAgent: lead.preferredAgentName || "(not assigned)",
    status: lead.status || "Pending",
    createdAt: lead.createdAt,
  }));

  return { success: true, data: { leads: formatted, total: formatted.length } };
}

function searchAgents(input: Record<string, unknown>, agents: WhatsappAgentOption[]): ToolResult {
  const query = str(input.query);
  if (!query) {
    return { success: false, error: "Query is required for agent search." };
  }

  const match = matchAgentName(query, agents);
  if (match.matches.length === 0) {
    return {
      success: false,
      error: `No agents found matching "${query}".`,
      hint: "Try a different spelling.",
    };
  }

  return {
    success: true,
    data: {
      query,
      status: match.status,
      matches: match.matches.map((a) => ({ id: a.id, name: a.name })),
    },
  };
}

async function saveMyProfile(
  input: Record<string, unknown>,
  referrer: WhatsappReferrerAccount,
): Promise<ToolResult> {
  const name = str(input.name);
  const bankAccount = str(input.bankAccount);

  if (!name || !bankAccount) {
    return {
      success: false,
      error: "Both name and bank account are required to save the profile.",
      hint: name ? "Ask for the bank account number." : "Ask for the referrer's full name.",
    };
  }
  if (name.length < 2) {
    return { success: false, error: "Name must be at least 2 characters." };
  }
  if (bankAccount.length < 5) {
    return { success: false, error: "Bank account looks too short. Confirm the number." };
  }

  const updated = await saveReferrerProfile(referrer, { name, bankAccount });

  return {
    success: true,
    data: { name: updated.name, bankAccount: updated.bankAccount, registered: updated.registered },
    message: "Profile saved.",
  };
}

async function createLead(
  input: Record<string, unknown>,
  referrer: WhatsappReferrerAccount,
  leads: ReferralRow[],
  agents: WhatsappAgentOption[],
): Promise<ToolResult> {
  const name = str(input.name);
  const phone = str(input.phone);
  const area = str(input.area) || "";
  const preferredAgentName = str(input.preferredAgentName);

  if (!phone) {
    return {
      success: false,
      error: "A lead needs a mobile phone number.",
      hint: "Ask the user for the lead's phone number.",
    };
  }

  const normalizedPhone = toCanonicalMalaysiaPhone(phone);
  if (!normalizedPhone) {
    return {
      success: false,
      error: `Invalid phone format: ${phone}`,
      hint: "Use Malaysia format like 0123456789 or 60123456789.",
    };
  }

  // Bug C guard: if a lead with this phone already exists, do NOT silently
  // create a duplicate or let the model "update" an unrelated lead. Surface
  // the existing lead and let the model decide (confirm duplicate vs update).
  const existing = leads.find(
    (lead) => lead.leadMobile && toCanonicalMalaysiaPhone(lead.leadMobile) === normalizedPhone,
  );
  if (existing) {
    const existingNumber = leads.indexOf(existing) + 1;
    return {
      success: false,
      error: `A lead with phone ${normalizedPhone} already exists (lead #${existingNumber}: ${existing.leadName || "no name"}).`,
      hint: "This is the SAME phone. Do not create a duplicate and do not overwrite a different lead. Ask the user whether to update lead #" + existingNumber + " or if this is genuinely a new person.",
    };
  }

  let preferredAgentId: string | undefined;
  if (preferredAgentName) {
    const resolved = resolveAgentId(preferredAgentName, agents);
    if (!resolved.success) return resolved;
    preferredAgentId = resolved.data;
  }

  const result = await createWhatsappReferral(
    referrer,
    { leadName: name || "", leadMobileNumber: normalizedPhone, area },
    { preferredAgentId },
  );

  return {
    success: true,
    data: {
      referralId: result.referralId,
      name: name || "(no name)",
      phone: normalizedPhone,
      agentNotified: result.preferredAgentNotification?.sent ?? false,
    },
    message: preferredAgentId
      ? "Lead created and preferred agent notified."
      : "Lead created.",
  };
}

async function updateLead(
  input: Record<string, unknown>,
  referrer: WhatsappReferrerAccount,
  leads: ReferralRow[],
  agents: WhatsappAgentOption[],
  ctx: TurnContext,
): Promise<ToolResult> {
  // Bug A guard: the model must have actually listed the leads this turn
  // before it can update one by number. Otherwise it invents numbers and
  // mutates the wrong lead. Force a get_my_leads first.
  if (ctx.listedLeadIds === null) {
    return {
      success: false,
      error: "You must call get_my_leads in this turn before updating a lead.",
      hint: "Call get_my_leads first, then use the exact number shown to the user.",
    };
  }

  const leadNumber = typeof input.leadNumber === "number" ? input.leadNumber : undefined;
  if (!leadNumber || leadNumber < 1 || leadNumber > leads.length) {
    return {
      success: false,
      error: `Invalid lead number: ${leadNumber ?? "(none)"}`,
      hint: leads.length
        ? `Use a number between 1 and ${leads.length}.`
        : "This referrer has no leads yet.",
    };
  }

  const field = str(input.field);
  const value = str(input.value);
  if (!field || !value) {
    return { success: false, error: "Both field and value are required." };
  }

  const lead = leads[leadNumber - 1];

  // Bug A guard, part 2: the lead at this position must match the id the model
  // actually saw via get_my_leads. If the list shifted (e.g. a create happened
  // mid-turn), refuse rather than mutate a now-different lead.
  if (!ctx.listedLeadIds.includes(lead.id)) {
    return {
      success: false,
      error: `Lead #${leadNumber} no longer matches what you listed (the list changed this turn).`,
      hint: "Call get_my_leads again to get fresh numbers before updating.",
    };
  }

  // Map the friendly field name to the data layer's update field + value.
  let updateField: "leadName" | "leadMobileNumber" | "area" | "preferredAgent";
  let updateValue = value;

  switch (field) {
    case "name":
      updateField = "leadName";
      break;
    case "phone": {
      updateField = "leadMobileNumber";
      const normalized = toCanonicalMalaysiaPhone(value);
      if (!normalized) {
        return { success: false, error: `Invalid phone format: ${value}` };
      }
      updateValue = normalized;
      break;
    }
    case "area":
      updateField = "area";
      break;
    case "preferredAgent": {
      updateField = "preferredAgent";
      const resolved = resolveAgentId(value, agents);
      if (!resolved.success) return resolved;
      updateValue = resolved.data;
      break;
    }
    default:
      return {
        success: false,
        error: `Unsupported field: ${field}`,
        hint: "Supported fields: name, phone, area, preferredAgent.",
      };
  }

  await updateWhatsappReferral(referrer, {
    referralId: lead.id,
    field: updateField,
    value: updateValue,
  });

  return {
    success: true,
    data: { leadNumber, field, leadId: lead.id },
    message: `Lead #${leadNumber} ${field} updated.`,
  };
}

// ============================================================================
// Admin Tools
// ============================================================================

// Combined search: find referrer(s) by phone or name AND return each one's
// leads in a single call, so the model never has to chain search -> get-leads.
async function adminLookup(input: Record<string, unknown>): Promise<ToolResult> {
  const query = str(input.query);
  if (!query) {
    return { success: false, error: "A phone number or referrer name is required." };
  }

  // Gather candidate referrers: exact phone match first, then fuzzy phone/name.
  const found = new Map<string, { customerId: string; name: string | null; phone: string | null }>();
  const normalizedPhone = toCanonicalMalaysiaPhone(query);
  if (normalizedPhone) {
    const exact = await searchReferrerByPhone(normalizedPhone);
    if (exact) found.set(exact.customerId, { customerId: exact.customerId, name: exact.name, phone: exact.phone });
  }
  for (const r of await searchReferrersByPhonePartial(query, 10)) {
    if (!found.has(r.customerId)) found.set(r.customerId, r);
  }

  if (found.size === 0) {
    return {
      success: false,
      error: `No referrer found for "${query}".`,
      hint: "Use admin_create_referrer to create one, or try a different name/phone.",
    };
  }

  // For each referrer, attach their numbered leads.
  const referrers = [];
  for (const r of found.values()) {
    const leads = await listWhatsappReferrals(r.customerId);
    referrers.push({
      referrerName: r.name || "(no name)",
      referrerPhone: r.phone || "(no phone)",
      leadCount: leads.length,
      leads: leads.map((lead, idx) => ({
        number: idx + 1,
        name: lead.leadName || "(no name)",
        phone: lead.leadMobile || "(no phone)",
        agent: lead.preferredAgentName || "none",
        status: lead.status || "Pending",
      })),
    });
  }

  return {
    success: true,
    data: { query, matchCount: referrers.length, referrers },
  };
}

async function adminCreateReferrer(
  input: Record<string, unknown>,
  adminPhone: string,
): Promise<ToolResult> {
  const name = str(input.name);
  const phone = str(input.phone);
  if (!name || !phone) {
    return { success: false, error: "Name and phone are required." };
  }

  const normalizedPhone = toCanonicalMalaysiaPhone(phone);
  if (!normalizedPhone) {
    return { success: false, error: `Invalid phone format: ${phone}` };
  }

  const referrer = await createReferrerOnBehalf({ name, phone: normalizedPhone, createdBy: adminPhone });

  return {
    success: true,
    data: { id: referrer.customerId, name: referrer.name, phone: referrer.phone },
    message: `Referrer created: ${referrer.name} (${referrer.phone})`,
  };
}

async function adminAddLead(input: Record<string, unknown>): Promise<ToolResult> {
  // Accept either the new `referrer` field (phone OR name) or the legacy
  // `referrerPhone` field for backward compatibility.
  const referrerQuery = str(input.referrer) || str(input.referrerPhone);
  if (!referrerQuery) {
    return {
      success: false,
      error: "Referrer phone or name is required.",
      hint: "Use admin_lookup first to find the referrer.",
    };
  }

  const referrerResult = await resolveReferrer(referrerQuery);
  if (!referrerResult.success) return referrerResult;
  const referrer = referrerResult.data;

  const name = str(input.name);
  const phone = str(input.phone);
  const area = str(input.area) || "";
  const preferredAgentName = str(input.preferredAgentName);

  if (!phone) {
    return { success: false, error: "A lead needs a mobile phone number." };
  }

  const normalizedPhone = toCanonicalMalaysiaPhone(phone);
  if (!normalizedPhone) {
    return { success: false, error: `Invalid lead phone format: ${phone}` };
  }

  let preferredAgentId: string | undefined;
  let assignedAgentName = "none";
  if (preferredAgentName) {
    const agents = await listWhatsappAgents();
    const resolved = resolveAgentId(preferredAgentName, agents);
    if (!resolved.success) return resolved;
    preferredAgentId = resolved.data;
    assignedAgentName = agents.find((a) => a.id === resolved.data)?.name || preferredAgentName;
  }

  const result = await createWhatsappReferral(
    referrer,
    { leadName: name || "", leadMobileNumber: normalizedPhone, area },
    { preferredAgentId },
  );

  // Structured result so the reply can clearly state lead / referrer / agent.
  return {
    success: true,
    data: {
      lead: name || "(no name)",
      leadPhone: normalizedPhone,
      referrer: referrer.name,
      assignedAgent: assignedAgentName,
      agentNotified: result.preferredAgentNotification?.sent ?? false,
    },
    message: `Lead added. Lead: ${name || "(no name)"} | Referrer: ${referrer.name} | Agent: ${assignedAgentName}`,
  };
}

async function adminAssignAgent(input: Record<string, unknown>): Promise<ToolResult> {
  const referrerQuery = str(input.referrer);
  const leadNumber = typeof input.leadNumber === "number" ? input.leadNumber : undefined;
  const agentName = str(input.agentName);

  if (!referrerQuery) return { success: false, error: "Referrer phone or name is required." };
  if (!agentName) return { success: false, error: "Agent name is required." };

  const resolved = await resolveReferrer(referrerQuery);
  if (!resolved.success) return resolved;
  const referrer = resolved.data;

  const leads = await listWhatsappReferrals(referrer.customerId);
  if (!leadNumber || leadNumber < 1 || leadNumber > leads.length) {
    return {
      success: false,
      error: `Invalid lead number: ${leadNumber ?? "(none)"}`,
      hint: leads.length
        ? `${referrer.name} has ${leads.length} leads. Call admin_lookup to see the numbers.`
        : `${referrer.name} has no leads.`,
    };
  }

  const agents = await listWhatsappAgents();
  const agent = resolveAgentId(agentName, agents);
  if (!agent.success) return agent;
  const resolvedAgentName = agents.find((a) => a.id === agent.data)?.name || agentName;

  const lead = leads[leadNumber - 1];
  await updateWhatsappReferral(referrer, {
    referralId: lead.id,
    field: "preferredAgent",
    value: agent.data,
  });

  // Structured result so the reply can clearly state lead / referrer / agent.
  return {
    success: true,
    data: {
      lead: lead.leadName || "(no name)",
      leadPhone: lead.leadMobile || "(no phone)",
      referrer: referrer.name,
      assignedAgent: resolvedAgentName,
    },
    message: `Agent assigned. Lead: ${lead.leadName || "(no name)"} | Referrer: ${referrer.name} | Agent: ${resolvedAgentName}`,
  };
}

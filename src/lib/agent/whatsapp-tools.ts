/**
 * WhatsApp Agent Tools - LLM-First Architecture
 *
 * Each tool wraps a real, validated function from whatsapp-data.ts. The LLM
 * calls tools to read context and perform writes. Tools validate inputs and
 * return structured success/error results so the LLM can recover from mistakes.
 *
 * IMPORTANT: The underlying data layer only supports lead name, mobile number,
 * area (state), and a free-text remark. It does NOT store lead email or a
 * separate city, and there is no delete/cancel-lead operation. Tools below
 * reflect that reality exactly.
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
import { matchAgentName, normalizeComparableText } from "./whatsapp-intent";
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
    description: "Create a new referral lead. Requires a mobile phone number. Optionally include the lead's name, area, a free-text remark/note, and the sales agent who should handle it.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The LEAD's name (the person being referred) — never the referrer's or a sales agent's name." },
        phone: { type: "string", description: "Lead's mobile phone number (Malaysia format). Required." },
        area: { type: "string", description: "Lead's area or state (e.g. Selangor)." },
        remark: { type: "string", description: "Optional free-text note about the lead — e.g. best time to call, what they're interested in, how they were referred. Use when the user volunteers extra context beyond name/phone/area." },
        salesAgentName: { type: "string", description: "Name of the SALES AGENT who should handle this lead (company staff, not the lead)." },
      },
      required: ["phone"],
    },
  },
  {
    name: "update_lead",
    description: "Update one field of an existing lead by its number from THEIR LEADS / get_my_leads. Call once per field to change.",
    input_schema: {
      type: "object",
      properties: {
        leadNumber: { type: "number", description: "The lead number (1, 2, 3...) as shown in THEIR LEADS or get_my_leads." },
        field: {
          type: "string",
          enum: ["name", "phone", "area", "salesAgent", "remark"],
          description: "Which field to update. 'salesAgent' changes who HANDLES the lead. 'remark' replaces the lead's free-text note.",
        },
        value: { type: "string", description: "New value. For salesAgent, pass the sales agent's name." },
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
        remark: { type: "string", description: "Optional free-text note about the lead." },
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
    case "create_lead": {
      const result = await createLead(input, referrer, leads, agents);
      // A new lead lands at #1 (newest first), shifting every number the model
      // was shown. Invalidate the listed ids so update_lead forces a re-list.
      if (result.success) ctx.listedLeadIds = null;
      return result;
    }
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
      return adminLookup(input, adminPhone);
    case "admin_create_referrer":
      return adminCreateReferrer(input, adminPhone);
    case "admin_add_lead":
      return adminAddLead(input, adminPhone);
    case "admin_assign_agent":
      return adminAssignAgent(input, adminPhone);
    default:
      return { success: false, error: `Unknown admin tool: ${toolName}` };
  }
}

/**
 * Admin mode works on OTHER referrers' accounts only. The admin's own account
 * must be managed as a normal user (reply 'exit' first) — this keeps the two
 * modes structurally different and makes "which account does this write hit?"
 * impossible to get wrong.
 */
function isOwnAccount(referrerPhone: string | null | undefined, adminPhone: string): boolean {
  const target = toCanonicalMalaysiaPhone(referrerPhone || "");
  const admin = toCanonicalMalaysiaPhone(adminPhone || "");
  return Boolean(target) && target === admin;
}

const OWN_ACCOUNT_ERROR: ToolError = {
  success: false,
  error: "That is the admin's OWN referral account. Admin mode only works on other referrers' accounts.",
  hint: "Tell the admin to reply 'exit' to leave admin mode, then manage their own leads as a normal user.",
};

// ============================================================================
// Shared helpers
// ============================================================================

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function tokenNGrams(tokens: string[], n: number): string[] {
  const grams: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) grams.push(tokens.slice(i, i + n).join(" "));
  return grams;
}

/**
 * Two normalized name strings "collide" if they share a distinctive core —
 * a contiguous 2+ token phrase, or a single token of 4+ characters when
 * either side is single-token. Deliberately NOT "every token must match" or
 * plain substring containment: real names carry titles/prefixes/suffixes
 * that don't overlap ("Uncle Eu Jin" vs "Au Yong Eu Jin" still collide on
 * "eu jin"; a query already resolved to the full canonical name, e.g.
 * "Au Yong Eu Jin", must still collide with a lead named just "Eu Jin" even
 * though neither string contains the other outright).
 */
function namesShareIdentity(a: string, b: string): boolean {
  const tokensA = a.split(" ").filter(Boolean);
  const tokensB = b.split(" ").filter(Boolean);
  if (!tokensA.length || !tokensB.length) return false;
  if (a === b) return true;
  const gramsA = new Set(tokenNGrams(tokensA, 2));
  if (tokenNGrams(tokensB, 2).some((g) => gramsA.has(g))) return true;
  if (tokensA.length === 1 || tokensB.length === 1) {
    return tokensA.some((t) => t.length >= 4 && tokensB.includes(t));
  }
  return false;
}

/**
 * Resolve a sales-agent name to a single agent id, or return a tool error
 * describing why it could not be resolved (missing / none / ambiguous).
 *
 * When `leads` is provided (regular-user tools), a match that ALSO matches
 * one of this referrer's lead names is refused: the same name in two roles
 * is exactly the confusion that corrupted leads in production. This check
 * runs regardless of whether the agent name matched exactly — the model can
 * reach an "exact" value either because the user typed the full unambiguous
 * name, or because it called search_agents on an ambiguous fragment first
 * and passed back the resolved full name. This tool has no way to tell those
 * two cases apart from the string alone, so it can't afford to trust either
 * one differently.
 *
 * The collision check compares against BOTH the raw query and the resolved
 * agent's canonical name — comparing only the query missed the case where
 * the model already resolved "Eu Jin" to "Au Yong Eu Jin" before calling
 * this, since the full name no longer substring-matches a lead named just
 * "Eu Jin". namesShareIdentity() catches that via shared-phrase overlap
 * instead of requiring one string to literally contain the other.
 */
function resolveAgentId(
  name: string,
  agents: WhatsappAgentOption[],
  leads?: ReferralRow[],
): ToolResult<string> {
  const match = matchAgentName(name, agents);
  if (match.status === "matched") {
    const agentName = match.matches[0].name;
    const query = normalizeComparableText(name);
    const normalizedAgentName = normalizeComparableText(agentName);

    if (leads?.length) {
      const collidingLead = leads.find((lead) => {
        const leadName = normalizeComparableText(lead.leadName || "");
        return Boolean(leadName) && (namesShareIdentity(leadName, query) || namesShareIdentity(leadName, normalizedAgentName));
      });
      if (collidingLead) {
        return {
          success: false,
          error: `"${name}" could be the sales agent ${agentName} OR the lead "${collidingLead.leadName}".`,
          hint: `Ask the user which they mean, naming both: sales agent ${agentName}, or their lead ${collidingLead.leadName}. This referrer has both — confirm before calling again.`,
        };
      }
    }

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
      referrerName: referrer.name || "(not set)",
      referrerPhone: referrer.phone,
      bankAccount: referrer.bankAccount || "(not set)",
      registered: referrer.registered,
      totalLeads: leads.length,
    },
  };
}

function getMyLeads(leads: ReferralRow[]): ToolResult {
  const formatted = leads.map((lead, idx) => ({
    number: idx + 1,
    leadName: lead.leadName || "(no name)",
    leadPhone: lead.leadMobile || "(no phone)",
    area: [lead.leadState, lead.leadCity].filter(Boolean).join(", ") || "(not provided)",
    remark: lead.remark || "(none)",
    salesAgentName: lead.preferredAgentName || "(not assigned)",
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
      agents: match.matches.map((a) => ({ role: "sales_agent", agentName: a.name })),
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
  const remark = str(input.remark) || "";
  // salesAgentName is the current key; preferredAgentName kept one release for compatibility.
  const salesAgentName = str(input.salesAgentName) || str(input.preferredAgentName);

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
  if (salesAgentName) {
    const resolved = resolveAgentId(salesAgentName, agents, leads);
    if (!resolved.success) return resolved;
    preferredAgentId = resolved.data;
  }
  const assignedAgentName = preferredAgentId
    ? agents.find((a) => a.id === preferredAgentId)?.name || salesAgentName || "none"
    : "none";

  const result = await createWhatsappReferral(
    referrer,
    { leadName: name || "", leadMobileNumber: normalizedPhone, area, remark },
    { preferredAgentId },
  );

  return {
    success: true,
    data: {
      referralId: result.referralId,
      leadName: name || "(no name)",
      leadPhone: normalizedPhone,
      remark: remark || "(none)",
      salesAgentName: assignedAgentName,
      agentNotified: result.preferredAgentNotification?.sent ?? false,
    },
    message: preferredAgentId
      ? "Lead created and the sales agent was notified."
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

  const rawField = str(input.field);
  // "salesAgent" is the current name; "preferredAgent" kept one release for compatibility.
  const field = rawField === "preferredAgent" ? "salesAgent" : rawField;
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
  let updateField: "leadName" | "leadMobileNumber" | "area" | "preferredAgent" | "remark";
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
    case "remark":
      updateField = "remark";
      break;
    case "salesAgent": {
      updateField = "preferredAgent";
      // Exclude the lead being reassigned from the collision check: assigning
      // an agent TO lead "Ali" legitimately references that lead's own name.
      const otherLeads = leads.filter((other) => other.id !== lead.id);
      const resolved = resolveAgentId(value, agents, otherLeads);
      if (!resolved.success) return resolved;
      updateValue = resolved.data;
      break;
    }
    default:
      return {
        success: false,
        error: `Unsupported field: ${field}`,
        hint: "Supported fields: name, phone, area, salesAgent, remark.",
      };
  }

  await updateWhatsappReferral(referrer, {
    referralId: lead.id,
    field: updateField,
    value: updateValue,
  });

  return {
    success: true,
    data: {
      leadNumber,
      field,
      referralId: lead.id,
      leadName: field === "name" ? value : lead.leadName || "(no name)",
      leadPhone: field === "phone" ? updateValue : lead.leadMobile || "",
      salesAgentName: field === "salesAgent" ? agents.find((a) => a.id === updateValue)?.name || value : undefined,
    },
    message: `Lead #${leadNumber} ${field} updated.`,
  };
}

// ============================================================================
// Admin Tools
// ============================================================================

// Combined search: find referrer(s) by phone or name AND return each one's
// leads in a single call, so the model never has to chain search -> get-leads.
async function adminLookup(input: Record<string, unknown>, adminPhone: string): Promise<ToolResult> {
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

  // The admin's own account is off-limits in admin mode.
  const matchedOwnAccount = [...found.values()].some((r) => isOwnAccount(r.phone, adminPhone));
  for (const [key, r] of found) {
    if (isOwnAccount(r.phone, adminPhone)) found.delete(key);
  }
  if (found.size === 0 && matchedOwnAccount) {
    return OWN_ACCOUNT_ERROR;
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
        remark: lead.remark || "(none)",
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

  if (isOwnAccount(normalizedPhone, adminPhone)) {
    return OWN_ACCOUNT_ERROR;
  }

  const referrer = await createReferrerOnBehalf({ name, phone: normalizedPhone, createdBy: adminPhone });

  return {
    success: true,
    data: { id: referrer.customerId, name: referrer.name, phone: referrer.phone },
    message: `Referrer created: ${referrer.name} (${referrer.phone})`,
  };
}

async function adminAddLead(input: Record<string, unknown>, adminPhone: string): Promise<ToolResult> {
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

  if (isOwnAccount(referrer.phone, adminPhone)) {
    return OWN_ACCOUNT_ERROR;
  }

  const name = str(input.name);
  const phone = str(input.phone);
  const area = str(input.area) || "";
  const remark = str(input.remark) || "";
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
    { leadName: name || "", leadMobileNumber: normalizedPhone, area, remark },
    { preferredAgentId },
  );

  // Structured result so the reply can clearly state lead / referrer / agent.
  return {
    success: true,
    data: {
      lead: name || "(no name)",
      leadPhone: normalizedPhone,
      remark: remark || "(none)",
      referrer: referrer.name,
      assignedAgent: assignedAgentName,
      agentNotified: result.preferredAgentNotification?.sent ?? false,
    },
    message: `Lead added. Lead: ${name || "(no name)"} | Referrer: ${referrer.name} | Agent: ${assignedAgentName}`,
  };
}

async function adminAssignAgent(input: Record<string, unknown>, adminPhone: string): Promise<ToolResult> {
  const referrerQuery = str(input.referrer);
  const leadNumber = typeof input.leadNumber === "number" ? input.leadNumber : undefined;
  const agentName = str(input.agentName);

  if (!referrerQuery) return { success: false, error: "Referrer phone or name is required." };
  if (!agentName) return { success: false, error: "Agent name is required." };

  const resolved = await resolveReferrer(referrerQuery);
  if (!resolved.success) return resolved;
  const referrer = resolved.data;

  if (isOwnAccount(referrer.phone, adminPhone)) {
    return OWN_ACCOUNT_ERROR;
  }

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

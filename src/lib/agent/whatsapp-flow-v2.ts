/**
 * WhatsApp Agent Flow - LLM-First Architecture
 *
 * Simplified design: LLM is always the brain, tools handle all operations.
 * No separate deterministic workflow layer.
 */

import { COMPANY_LEGAL_NAME, REFERRAL_TERMS } from "@/lib/terms";
import {
  appendAgentDebugLog,
  listWhatsappAgents,
  listWhatsappReferrals,
  loadConversation,
  loadAgentState,
  saveAgentState,
  resolveOrCreateReferrerByWhatsappPhone,
  EMPTY_WHATSAPP_AGENT_STATE,
  type WhatsappEntityLedger,
  type WhatsappReferrerAccount,
} from "@/lib/agent/whatsapp-data";
import { isAdminModeTrigger, isAdminModeExit, isCancelMessage, parseLeadCandidate } from "@/lib/agent/whatsapp-intent";
import type { ReferralRow } from "@/lib/referrals";
import {
  REGULAR_USER_TOOLS,
  ADMIN_TOOLS,
  executeRegularTool,
  executeAdminTool,
  createTurnContext,
  type TurnContext,
} from "./whatsapp-tools";
import {
  cleanMessages,
  formatAgentTimestamp,
  formatLeadStateLines,
  type ModelContentBlock,
  type ModelMessage,
} from "./whatsapp-history";

const PORTAL_URL = process.env.WHATSAPP_AGENT_PORTAL_URL || "https://referral.atap.solar/";
const LLM_BASE_URL = (process.env.WHATSAPP_AGENT_LLM_BASE_URL || "https://api.minimax.io").replace(/\/$/, "");
const LLM_MODEL = process.env.WHATSAPP_AGENT_LLM_MODEL || "MiniMax-M3";
const LLM_API_KEY = process.env.WHATSAPP_AGENT_LLM_API_KEY || process.env.MINIMAX_API_KEY || "";

const PROGRAM_KNOWLEDGE = REFERRAL_TERMS.map(
  (section) => `${section.title}:\n${section.items.map((item) => `- ${item}`).join("\n")}`,
).join("\n\n");

type ToolTrace = { name: string; status: string; input: Record<string, unknown>; result?: unknown };

const ENTITY_LEDGER_TTL_MS = 60 * 60 * 1000;

function freshEntityLedger(ledger: WhatsappEntityLedger | undefined): WhatsappEntityLedger | undefined {
  if (!ledger?.updatedAt) return undefined;
  const age = Date.now() - new Date(ledger.updatedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age <= ENTITY_LEDGER_TTL_MS ? ledger : undefined;
}

// Admin mode has no "THEIR LEADS" list to ground a vague "this lead" against
// (the target referrer varies per request), so a pending lead capture must
// expire fast — long enough to survive the immediate clarification
// back-and-forth after one image, short enough that "yesterday's lead" can
// never resurface as if it were just sent. This is what was missing when a
// day-old image extraction got presented as the current one in production.
const ADMIN_PENDING_LEAD_TTL_MS = 15 * 60 * 1000;

type AdminPendingLeadCapture = {
  leadName: string;
  leadMobileNumber: string;
  area: string;
  preferredAgentText: string;
  capturedAt: string;
};

function freshPendingLeadCapture(capture: AdminPendingLeadCapture | undefined): AdminPendingLeadCapture | undefined {
  if (!capture?.capturedAt) return undefined;
  const age = Date.now() - new Date(capture.capturedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age <= ADMIN_PENDING_LEAD_TTL_MS ? capture : undefined;
}

/**
 * Update the entity ledger from this turn's successful writes. Deterministic
 * application code only — the LLM never writes memory, so a hallucinated
 * claim can never become the recorded truth.
 */
function deriveEntityLedger(
  toolTrace: ToolTrace[],
  previous: WhatsappEntityLedger | undefined,
): WhatsappEntityLedger | undefined {
  let ledger = previous;

  for (const trace of toolTrace) {
    if (trace.status !== "success") continue;
    const result = trace.result as { success?: boolean; data?: Record<string, unknown> } | undefined;
    const data = result?.data;
    if (!result?.success || !data) continue;

    if (trace.name === "create_lead") {
      const leadName = String(data.leadName || "");
      const agentName = typeof data.salesAgentName === "string" && data.salesAgentName !== "none" ? data.salesAgentName : "";
      ledger = {
        activeLead: {
          referralId: Number(data.referralId) || 0,
          leadName,
          leadPhone: String(data.leadPhone || ""),
        },
        lastAgentDiscussed: agentName ? { agentName } : ledger?.lastAgentDiscussed,
        lastAction: `created lead "${leadName || data.leadPhone}"${agentName ? ` handled by sales agent ${agentName}` : ""}`,
        updatedAt: new Date().toISOString(),
      };
    } else if (trace.name === "update_lead") {
      const leadName = String(data.leadName || "");
      const agentName = typeof data.salesAgentName === "string" ? data.salesAgentName : "";
      ledger = {
        activeLead: {
          referralId: Number(data.referralId) || 0,
          leadName,
          leadPhone: String(data.leadPhone || ""),
        },
        lastAgentDiscussed: agentName ? { agentName } : ledger?.lastAgentDiscussed,
        lastAction:
          data.field === "salesAgent"
            ? `assigned sales agent ${agentName || "(unknown)"} to lead "${leadName}"`
            : `updated ${String(data.field)} of lead "${leadName}"`,
        updatedAt: new Date().toISOString(),
      };
    }
  }

  return ledger;
}

// ============================================================================
// Main Entry Point
// ============================================================================

export async function runWhatsappAgentTurnV2(input: {
  senderPhone: string;
  text: string;
  dryRun?: boolean;
}): Promise<{ reply: string; toolTrace: ToolTrace[] }> {
  const startedAt = Date.now();

  if (!LLM_API_KEY) {
    throw new Error("WHATSAPP_AGENT_LLM_API_KEY (or MINIMAX_API_KEY) is not set.");
  }

  // Admin mode is a stateful session anyone can enter by sending "ee-admin"
  // and leave with "exit". The flag is persisted in agent state so it survives
  // across turns, exactly like the original deterministic flow.
  const state = await loadAgentState(input.senderPhone);
  const inAdminSession = state.mode.startsWith("admin_");
  const text = input.text.trim();

  if (isAdminModeTrigger(text)) {
    // Enter (or re-acknowledge if already in) admin mode. Always responds so the
    // keyword never falls through to the LLM as an unknown message.
    if (!inAdminSession) {
      await saveAgentState(input.senderPhone, {
        ...EMPTY_WHATSAPP_AGENT_STATE,
        mode: "admin_idle",
        adminContext: { adminPhone: input.senderPhone },
      });
    }
    const reply = "[ADMIN MODE]\nAdmin mode activated. Tell me what to do — e.g. 'search referrer 0112...', 'create referrer <name> <phone>', or 'add lead for <phone>'. Note: your OWN referral account can't be managed here — reply 'exit' for that. Reply 'exit' to leave.";
    await recordTurn({ phone: input.senderPhone, registered: false, inbound: input.text, reply, toolTrace: [], startedAt });
    return { reply, toolTrace: [] };
  }

  if (isAdminModeExit(text) && inAdminSession) {
    await saveAgentState(input.senderPhone, { ...EMPTY_WHATSAPP_AGENT_STATE });
    const reply = "[ADMIN MODE]\nExited admin mode.";
    await recordTurn({ phone: input.senderPhone, registered: false, inbound: input.text, reply, toolTrace: [], startedAt });
    return { reply, toolTrace: [] };
  }

  // Load context. In admin mode the sender's own referral account is
  // off-limits, so their own leads are never loaded or shown.
  const isAdmin = inAdminSession;
  const referrer = await resolveOrCreateReferrerByWhatsappPhone(input.senderPhone);
  const leads = isAdmin ? [] : await listWhatsappReferrals(referrer.customerId);
  const history = await loadConversation(input.senderPhone);

  // Admin-mode pending-lead capture: deterministic, derived from the RAW
  // inbound text (image OCR, contact card, explicit text), not from a tool
  // result — this is what lets the CURRENT turn's image data ground a
  // following "add this lead" without the model reaching into old history.
  // A cancel/reset message clears it explicitly; otherwise it carries
  // forward from state, subject to the freshness check below.
  let pendingLeadCapture = state.adminContext?.pendingLeadCapture;
  if (isAdmin) {
    const parsed = parseLeadCandidate(input.text);
    // A media turn is any image/video/contact-card delivery, whether OCR
    // succeeded, failed, or found no lead details — recognized by the
    // wrapper prepareWhatsappInboundForAgent always attaches. Receiving one
    // is itself a signal the admin's attention has moved to a NEW item, even
    // when it yields no lead fields, so it must not leave an older, unrelated
    // capture sitting there to be misattributed to whatever this new item
    // turns out to be. Without this, a follow-up image with no lead data
    // (e.g. a forwarded Maps screenshot) silently left the previous lead
    // capture intact, and the next "add this lead" pulled in that stale,
    // unrelated lead instead of failing loudly.
    const isMediaTurn = /\[System:\s*User sent an? (?:image|video)\b/i.test(input.text) || /WhatsApp contact card/i.test(input.text);
    if (parsed?.leadMobileNumber) {
      pendingLeadCapture = {
        leadName: parsed.leadName,
        leadMobileNumber: parsed.leadMobileNumber,
        area: parsed.area,
        preferredAgentText: parsed.preferredAgentText,
        capturedAt: new Date().toISOString(),
      };
    } else if (isCancelMessage(text) || isMediaTurn) {
      pendingLeadCapture = undefined;
    }
  }
  const freshPendingLead = isAdmin ? freshPendingLeadCapture(pendingLeadCapture) : undefined;

  // Build system prompt (with the still-fresh entity ledger, if any)
  const ledger = freshEntityLedger(state.entityLedger);
  const systemPrompt = buildSystemPrompt(referrer, leads, isAdmin, ledger, freshPendingLead);

  // Build messages. Admin mode redacts reusable lead fields out of PAST
  // media turns (see distillHistoryTurnText) so the model can't reach into
  // history for lead data instead of the current turn or PENDING LEAD DATA.
  const messages = cleanMessages(history, input.text, { redactLeadFields: isAdmin });

  // One TurnContext per turn enforces "look before you leap" across tool calls.
  // The system prompt already lists this turn's leads (same order/numbering as
  // get_my_leads), so seed the guard with those ids — update_lead can act on
  // the numbers the model was shown without a redundant get_my_leads call.
  const ctx = createTurnContext();
  ctx.listedLeadIds = leads.map((lead) => lead.id);

  // Call LLM (with tools). Admin mode is admin tools ONLY: every write must
  // name its target referrer, so a lead can never silently land under the
  // admin's own account.
  const tools = isAdmin ? ADMIN_TOOLS : REGULAR_USER_TOOLS;
  const { reply: rawReply, toolTrace } = await callAgentModel(
    systemPrompt,
    messages,
    tools,
    referrer,
    isAdmin,
    ctx,
    input.senderPhone,
  );

  const reply = rawReply;

  // A successful admin_add_lead consumed the pending capture — clear it so a
  // later "add this lead" can't reuse an already-added one.
  if (isAdmin && toolTrace.some((t) => t.name === "admin_add_lead" && t.status === "success")) {
    pendingLeadCapture = undefined;
  }

  // Persist the updated entity ledger (deterministic, from tool results
  // only) and the admin pending-lead capture (deterministic, from raw
  // inbound text) in one write so neither clobbers the other.
  const updatedLedger = deriveEntityLedger(toolTrace, ledger);
  const ledgerChanged = updatedLedger && updatedLedger !== ledger;
  const pendingChanged = isAdmin && pendingLeadCapture !== state.adminContext?.pendingLeadCapture;
  if (ledgerChanged || pendingChanged) {
    try {
      await saveAgentState(input.senderPhone, {
        ...state,
        entityLedger: updatedLedger,
        adminContext: isAdmin ? { ...state.adminContext, adminPhone: input.senderPhone, pendingLeadCapture } : state.adminContext,
      });
    } catch (err) {
      console.error("Failed to save entity ledger / pending lead capture:", err);
    }
  }

  // Record turn
  await recordTurn({
    phone: input.senderPhone,
    registered: referrer.registered || false,
    inbound: input.text,
    reply,
    toolTrace,
    startedAt,
  });

  return { reply, toolTrace };
}

// ============================================================================
// System Prompt Builder
// ============================================================================

function buildSystemPrompt(
  referrer: WhatsappReferrerAccount,
  leads: ReferralRow[],
  isAdmin: boolean,
  ledger?: WhatsappEntityLedger,
  pendingLead?: { leadName: string; leadMobileNumber: string; area: string; preferredAgentText: string; capturedAt: string },
): string {
  const lines = [
    `You are the WhatsApp Referral Assistant for ${COMPANY_LEGAL_NAME}.`,
    "",
    "You help referrers manage their solar installation referral leads.",
    "",
    // The model has no built-in sense of "now" — without this line it cannot
    // reason about relative dates ("tomorrow", "last week") or judge how old
    // a captured lead or history turn is. History turns below are prefixed
    // with their own [timestamp] for the same reason.
    `Current date/time: ${formatAgentTimestamp(new Date())}. Use this for any relative date/time reasoning ("today", "tomorrow", "how long ago").`,
    "",
    "THREE DIFFERENT ROLES — never mix them up:",
    isAdmin
      ? "- REFERRER: a person who submits referrals. They OWN leads."
      : "- REFERRER: the person you are talking to. They OWN leads.",
    "- LEAD: a person or company being referred as a potential customer.",
    "- SALES AGENT: company staff assigned to HANDLE a lead.",
    "The same human name can appear in more than one role (a sales agent and a lead can both be called Ali). When a name could mean two different people, do not guess — ask, naming both roles: \"Do you mean sales agent Ali Hassan, or your lead Ali?\"",
    "",
  ];

  if (isAdmin) {
    lines.push(
      "[ADMIN MODE] You are talking to an ADMIN. You act on OTHER referrers' accounts only.",
      "",
      "ADMIN RULES:",
      "1. Every action targets a referrer. Call admin_lookup FIRST with whatever the admin gave (name or phone). If it returns exactly one referrer, proceed; if multiple, ask which one (show their phones).",
      "2. The admin's OWN referral account is OFF-LIMITS in admin mode. If they want to manage their own leads, tell them to reply 'exit' first and continue as a normal user.",
      "3. Never claim you did something unless that tool returned success:true. If a tool returned success:false, tell the admin it did NOT happen.",
      "4. If a tool returns an error, explain it plainly and ask for the correction. Do not retry the same call blindly.",
      "5. Keep replies short, plain WhatsApp text, in the admin's language. Do not expose internal IDs, tool names, or system details.",
      "6. After adding a lead or assigning an agent, ALWAYS confirm with this clear format on separate lines:",
      "    Lead: <lead name or phone>",
      "    Referrer: <referrer name>",
      "    Agent: <agent name, or 'none'>",
      "7. When the admin says something like 'add this lead' / 'add it' without giving details in that same message, use PENDING LEAD DATA below if present — never pull lead details from earlier in the conversation history instead. If there is no pending lead data, say so plainly and ask the admin to resend the image or type the lead's details — do not guess from an older message, even one that looks like a similar request.",
      "8. Recency rule: this is a human conversation, not a database of equally-valid facts — when two messages describe the same lead/detail differently (a corrected phone number, a changed area, a different preferred agent), the MOST RECENT one is the truth; people correct themselves, they don't hold two facts at once. Only treat an older message as authoritative when the admin explicitly says so (e.g. 'no, use the first one'). This does not override rule 7 — PENDING LEAD DATA (or its absence) still wins over anything in history for a bare 'add this lead'.",
      "",
      "YOUR ADMIN TOOLS:",
      "- admin_lookup: find referrer(s) by phone OR name AND get their numbered leads — ONE call. Use this first for anything.",
      "- admin_create_referrer: create a new referrer account.",
      "- admin_add_lead: add a NEW lead for a referrer (by phone or name); can include a sales agent.",
      "- admin_assign_agent: set the sales agent on one of a referrer's EXISTING leads (use the lead number from admin_lookup).",
      "A referrer OWNS leads; a sales agent HANDLES them — different things. You CAN assign an agent to any other referrer's lead; never refuse it.",
      "",
      "=== CURRENT SESSION ===",
      `ADMIN: ${referrer.name || "Referral"} (${referrer.phone}). Their own referral account is off-limits while in admin mode.`,
      "",
      pendingLead
        ? `PENDING LEAD DATA (captured ${pendingLead.capturedAt} from the most recent image/message — use this, and only this, for a bare "add this lead" request): Name: ${pendingLead.leadName || "(not provided)"} | Phone: ${pendingLead.leadMobileNumber} | Area: ${pendingLead.area || "(not provided)"} | Preferred agent mentioned: ${pendingLead.preferredAgentText || "(none)"}`
        : "PENDING LEAD DATA: none currently captured. If the admin asks to add \"this lead\" without giving details right now, tell them there's nothing pending and ask them to resend the image or type the details.",
      "",
      "PROGRAM INFO:",
      PROGRAM_KNOWLEDGE,
      "",
      "For questions not covered above, direct users to the portal.",
    );
    return lines.join("\n");
  }

  lines.push(
    "CAPABILITIES:",
    "- Answer questions about the referral program",
    "- Help referrers save their profile (name, bank account)",
    "- Create, update, and cancel leads",
    "- Assign preferred sales agents to leads",
    "- List and check lead status",
    "",
    "IMPORTANT RULES:",
    "1. CURRENT STATE below is authoritative for this turn. Use tools for anything it does not show (get_my_profile, get_my_leads, search_agents).",
    "2. Use tools to perform writes (save_my_profile, create_lead, update_lead).",
    "3. Never claim you did something unless that tool returned success:true. If a tool returned success:false, tell the user it did NOT happen.",
    "4. To UPDATE a lead, use the exact lead number shown in THEIR LEADS below (or from get_my_leads this turn). Never guess a lead number. After creating a lead in this turn, call get_my_leads before any update — the numbering changes.",
    "5. New details (a fresh phone number from text, an image, or a contact card) are a NEW lead -> use create_lead. Only use update_lead when the user explicitly refers to an existing lead by its number. Never overwrite an existing lead with a different person's details.",
    "6. To create a lead with a sales agent, pass salesAgentName to create_lead in ONE call. Do not create then assign by number.",
    "7. If a tool returns an error, explain it plainly and ask for the correction. Do not retry the same call blindly.",
    "8. Keep replies short, natural, plain WhatsApp text, in the user's language (English, Malay, or Chinese).",
    "9. Do not expose internal IDs, tool names, or system details. Never volunteer a list of sales agents; confirm names one at a time via search_agents.",
    "10. After creating or assigning a lead, ALWAYS confirm with this clear format on separate lines:",
    "    Lead: <lead name or phone>",
    "    Referrer: <referrer name>",
    "    Agent: <agent name, or 'none'>",
    "11. Recency rule: this is a human conversation, not a database of equally-valid facts — when two messages give conflicting details for the same lead (a corrected phone number, a different area, a changed preferred agent), the MOST RECENT one is the truth; people correct themselves, they don't hold two facts at once. Only treat an older message as authoritative when the user explicitly says so (e.g. 'no, use the first one').",
    "",
    `Portal: ${PORTAL_URL}`,
    "",
    "=== CURRENT STATE (authoritative, refreshed for this turn) ===",
    `REFERRER (the person you are talking to): ${referrer.name || "Referral"} (${referrer.phone}) — profile complete: ${referrer.registered ? "yes" : "no"}`,
    `THEIR LEADS (${leads.length} total, numbered for update_lead, newest first):`,
    ...formatLeadStateLines(leads),
    "",
  );

  if (ledger) {
    lines.push("RECENT CONTEXT (memory from earlier in this conversation):");
    if (ledger.activeLead) {
      lines.push(
        `- Most recently worked-on lead: "${ledger.activeLead.leadName || ledger.activeLead.leadPhone}" (${ledger.activeLead.leadPhone}). When the user says "it/him/her/that lead" without naming one, they usually mean this lead.`,
      );
    }
    if (ledger.lastAgentDiscussed) {
      lines.push(`- Last sales agent discussed: ${ledger.lastAgentDiscussed.agentName}`);
    }
    if (ledger.lastAction) {
      lines.push(`- Last action: ${ledger.lastAction}`);
    }
    lines.push("");
  }

  lines.push(
    "PROGRAM INFO:",
    PROGRAM_KNOWLEDGE,
    "",
    "For questions not covered above, direct users to the portal.",
  );

  return lines.join("\n");
}

// ============================================================================
// LLM Call with Tool Execution
// ============================================================================

async function callAgentModel(
  system: string,
  messages: ModelMessage[],
  tools: Record<string, unknown>[],
  referrer: WhatsappReferrerAccount,
  isAdmin: boolean,
  ctx: TurnContext,
  senderPhone: string,
  depth = 0,
): Promise<{ reply: string; toolTrace: ToolTrace[] }> {
  if (depth > 5) {
    return { reply: "Too many tool calls. Please simplify your request.", toolTrace: [] };
  }

  // Call MiniMax-M3
  const body = {
    model: LLM_MODEL,
    max_tokens: 800,
    system,
    messages,
    tools: tools.length > 0 ? tools : undefined,
  };

  const response = await fetch(`${LLM_BASE_URL}/anthropic/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": LLM_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`LLM HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  const payload = JSON.parse(text) as {
    content?: ModelContentBlock[];
    stop_reason?: string;
    base_resp?: { status_code?: number; status_msg?: string };
  };

  if (payload.base_resp?.status_code) {
    throw new Error(`LLM error: ${payload.base_resp.status_msg || payload.base_resp.status_code}`);
  }

  const blocks = payload.content || [];
  const textBlock = blocks.find((b) => b.type === "text") as { text: string } | undefined;
  const replyText = textBlock?.text?.trim() || "";

  // Check for tool use
  const toolUseBlocks = blocks.filter((b) => b.type === "tool_use") as Array<{
    type: "tool_use";
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;

  if (toolUseBlocks.length === 0) {
    // No tools called, return reply
    return { reply: replyText, toolTrace: [] };
  }

  // Execute tools
  messages.push({ role: "assistant", content: blocks });

  const toolResults: ModelContentBlock[] = [];
  const toolTrace: ToolTrace[] = [];

  for (const toolBlock of toolUseBlocks) {
    let result;
    let status = "success";

    try {
      // Check if admin tool
      if (toolBlock.name.startsWith("admin_")) {
        if (!isAdmin) {
          result = { success: false, error: "Admin tools are not available." };
          status = "unauthorized";
        } else {
          result = await executeAdminTool(toolBlock.name, toolBlock.input, senderPhone);
        }
      } else if (isAdmin) {
        // Self-service tools are not offered in admin mode, but guard against
        // the model calling one anyway — it would write to the ADMIN's own
        // account instead of the target referrer's.
        result = {
          success: false,
          error: "Self-service tools are disabled in admin mode. Use the admin_* tools with an explicit referrer, or reply 'exit' to manage your own account.",
        };
        status = "unauthorized";
      } else {
        // Refresh leads/agents in case previous tools modified them this turn.
        const freshLeads = await listWhatsappReferrals(referrer.customerId);
        const freshAgents = await listWhatsappAgents();
        result = await executeRegularTool(toolBlock.name, toolBlock.input, referrer, freshLeads, freshAgents, ctx);
      }

      if (typeof result === "object" && result !== null && "success" in result && !result.success) {
        status = "error";
      }
    } catch (error) {
      result = { success: false, error: error instanceof Error ? error.message : String(error) };
      status = "error";
    }

    toolResults.push({
      type: "tool_result",
      tool_use_id: toolBlock.id,
      content: JSON.stringify(result),
    });

    toolTrace.push({
      name: toolBlock.name,
      status,
      input: toolBlock.input,
      result,
    });
  }

  // Send tool results back to LLM
  messages.push({ role: "user", content: toolResults });

  const nextCall = await callAgentModel(
    system,
    messages,
    tools,
    referrer,
    isAdmin,
    ctx,
    senderPhone,
    depth + 1,
  );

  return {
    reply: (replyText ? replyText + "\n\n" + nextCall.reply : nextCall.reply).trim(),
    toolTrace: [...toolTrace, ...nextCall.toolTrace],
  };
}

// ============================================================================
// Record Turn for Debugging
// ============================================================================

async function recordTurn(input: {
  phone: string;
  registered: boolean;
  inbound: string;
  reply: string;
  toolTrace: ToolTrace[];
  startedAt: number;
}) {
  try {
    await appendAgentDebugLog({
      at: new Date().toISOString(),
      phone: input.phone,
      registered: input.registered,
      inbound: input.inbound.slice(0, 500),
      reply: input.reply.slice(0, 800),
      toolCalls: input.toolTrace,
      wrote: input.toolTrace.some((t) => t.status === "success" && !t.name.includes("get_") && !t.name.includes("search_")),
      guardTrips: 0,
      fallbackUsed: false,
      rounds: 1,
      ms: Date.now() - input.startedAt,
    });
  } catch (err) {
    console.error("Failed to record turn:", err);
  }
}

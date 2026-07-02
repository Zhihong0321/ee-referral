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
  type WhatsappReferrerAccount,
} from "@/lib/agent/whatsapp-data";
import { isAdminModeTrigger, isAdminModeExit } from "@/lib/agent/whatsapp-intent";
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
    const reply = "[ADMIN MODE]\nAdmin mode activated. Tell me what to do — e.g. 'search referrer 0112...', 'create referrer <name> <phone>', or 'add lead for <phone>'. Reply 'exit' to leave.";
    await recordTurn({ phone: input.senderPhone, registered: false, inbound: input.text, reply, toolTrace: [], startedAt });
    return { reply, toolTrace: [] };
  }

  if (isAdminModeExit(text) && inAdminSession) {
    await saveAgentState(input.senderPhone, { ...EMPTY_WHATSAPP_AGENT_STATE });
    const reply = "[ADMIN MODE]\nExited admin mode.";
    await recordTurn({ phone: input.senderPhone, registered: false, inbound: input.text, reply, toolTrace: [], startedAt });
    return { reply, toolTrace: [] };
  }

  // Load context
  const referrer = await resolveOrCreateReferrerByWhatsappPhone(input.senderPhone);
  const leads = await listWhatsappReferrals(referrer.customerId);
  const history = await loadConversation(input.senderPhone);
  // Admin tools are available while the sender is in an admin session.
  const isAdmin = inAdminSession;

  // Build system prompt
  const systemPrompt = buildSystemPrompt(referrer, leads, isAdmin);

  // Build messages
  const messages = cleanMessages(history, input.text);

  // One TurnContext per turn enforces "look before you leap" across tool calls.
  // The system prompt already lists this turn's leads (same order/numbering as
  // get_my_leads), so seed the guard with those ids — update_lead can act on
  // the numbers the model was shown without a redundant get_my_leads call.
  const ctx = createTurnContext();
  ctx.listedLeadIds = leads.map((lead) => lead.id);

  // Call LLM (with tools)
  const tools = isAdmin ? [...REGULAR_USER_TOOLS, ...ADMIN_TOOLS] : REGULAR_USER_TOOLS;
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
): string {
  const lines = [
    `You are the WhatsApp Referral Assistant for ${COMPANY_LEGAL_NAME}.`,
    "",
    "You help referrers manage their solar installation referral leads.",
    "",
    "THREE DIFFERENT ROLES — never mix them up:",
    "- REFERRER: the person you are talking to. They OWN leads.",
    "- LEAD: a person or company being referred as a potential customer.",
    "- SALES AGENT: company staff assigned to HANDLE a lead.",
    "The same human name can appear in more than one role (a sales agent and a lead can both be called Ali). When a name could mean two different people, do not guess — ask, naming both roles: \"Do you mean sales agent Ali Hassan, or your lead Ali?\"",
    "",
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
    "",
    `Portal: ${PORTAL_URL}`,
    "",
    "=== CURRENT STATE (authoritative, refreshed for this turn) ===",
    `REFERRER (the person you are talking to): ${referrer.name || "Referral"} (${referrer.phone}) — profile complete: ${referrer.registered ? "yes" : "no"}`,
    `THEIR LEADS (${leads.length} total, numbered for update_lead, newest first):`,
    ...formatLeadStateLines(leads),
    "",
  ];

  if (isAdmin) {
    lines.push(
      "[ADMIN MODE] You act on behalf of any referrer. Your admin tools:",
      "- admin_lookup: find referrer(s) by phone OR name AND get their leads — ONE call. Use this first for anything.",
      "- admin_create_referrer: create a new referrer account.",
      "- admin_add_lead: add a NEW lead for a referrer (by phone or name); can include a sales agent.",
      "- admin_assign_agent: set the sales agent on one of a referrer's EXISTING leads (use the lead number from admin_lookup).",
      "A referrer OWNS leads; a sales agent HANDLES them — different things. You CAN assign an agent to any referrer's lead; never refuse it.",
      "Flow: call admin_lookup with whatever the admin gave (name or phone). If it returns exactly one referrer, proceed. If multiple, ask which (show their phones). Then add_lead or assign_agent using the same referrer query.",
      "",
    );
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

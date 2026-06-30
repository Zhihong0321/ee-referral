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
  type ConversationTurn,
  type WhatsappAgentOption,
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

// Strip or neutralize reply text that CLAIMS a write happened when no
// successful write tool ran this turn. Mirrors V1's WRITE_CLAIM_PATTERN guard.
// Without this the model fabricates "Done! Lead saved / agent notified" even
// when nothing was written (the phantom-save bug seen in testing).
const WRITE_CLAIM_PATTERN =
  /\b(?:done|all set)\b|\b(?:i(?:'ve| have)?|we(?:'ve| have)?)\s+(?:added|saved|updated|assigned|registered|notified|created|changed|deleted|cancelled|canceled)\b|\bhas been (?:added|saved|updated|assigned|notified|created)\b|已(?:添加|保存|更新|分配|登记|注册)|添加成功|保存成功|berjaya (?:simpan|tambah|daftar)|sudah (?:simpan|tambah|daftar)/i;

const WRITE_TOOL_NAMES = new Set([
  "save_my_profile",
  "create_lead",
  "update_lead",
  "admin_create_referrer",
  "admin_add_lead",
]);

const PORTAL_URL = process.env.WHATSAPP_AGENT_PORTAL_URL || "https://referral.atap.solar/";
const LLM_BASE_URL = (process.env.WHATSAPP_AGENT_LLM_BASE_URL || "https://api.minimax.io").replace(/\/$/, "");
const LLM_MODEL = process.env.WHATSAPP_AGENT_LLM_MODEL || "MiniMax-M3";
const LLM_API_KEY = process.env.WHATSAPP_AGENT_LLM_API_KEY || process.env.MINIMAX_API_KEY || "";

const PROGRAM_KNOWLEDGE = REFERRAL_TERMS.map(
  (section) => `${section.title}:\n${section.items.map((item) => `- ${item}`).join("\n")}`,
).join("\n\n");

type ModelContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };
type ModelMessage = { role: "user" | "assistant"; content: string | ModelContentBlock[] };

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

  if (isAdminModeTrigger(text) && !inAdminSession) {
    await saveAgentState(input.senderPhone, {
      ...EMPTY_WHATSAPP_AGENT_STATE,
      mode: "admin_idle",
      adminContext: { adminPhone: input.senderPhone },
    });
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
  const agents = await listWhatsappAgents();
  const history = await loadConversation(input.senderPhone);
  // Admin tools are available while the sender is in an admin session.
  const isAdmin = inAdminSession;

  // Build system prompt
  const systemPrompt = buildSystemPrompt(referrer, leads, agents, isAdmin);

  // Build messages
  const messages = cleanMessages(history, input.text);

  // One TurnContext per turn enforces "look before you leap" across tool calls.
  const ctx = createTurnContext();

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

  // Guard: never let the reply claim a write that did not actually succeed.
  const reply = guardWriteClaims(rawReply, toolTrace);

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

/**
 * If the model's reply claims an action (done/saved/assigned/notified...) but
 * no successful write tool ran this turn, replace the claim with an honest
 * fallback. This is the structural backstop for the phantom-save bug.
 */
function guardWriteClaims(reply: string, toolTrace: ToolTrace[]): string {
  const hadSuccessfulWrite = toolTrace.some(
    (t) => WRITE_TOOL_NAMES.has(t.name) && t.status === "success",
  );
  if (hadSuccessfulWrite) return reply;
  if (!WRITE_CLAIM_PATTERN.test(reply)) return reply;

  // The reply asserts a write that never happened. Do not deliver the lie.
  return "Sorry, I couldn't complete that action. Could you resend the details so I can try again?";
}

// ============================================================================
// System Prompt Builder
// ============================================================================

function buildSystemPrompt(
  referrer: WhatsappReferrerAccount,
  leads: ReferralRow[],
  agents: WhatsappAgentOption[],
  isAdmin: boolean,
): string {
  const lines = [
    `You are the WhatsApp Referral Assistant for ${COMPANY_LEGAL_NAME}.`,
    "",
    "You help referrers manage their solar installation referral leads.",
    "",
    "CAPABILITIES:",
    "- Answer questions about the referral program",
    "- Help referrers save their profile (name, bank account)",
    "- Create, update, and cancel leads",
    "- Assign preferred sales agents to leads",
    "- List and check lead status",
    "",
    "IMPORTANT RULES:",
    "1. Use tools to read current state (get_my_profile, get_my_leads).",
    "2. Use tools to perform writes (save_my_profile, create_lead, update_lead).",
    "3. Never claim you did something unless that tool returned success:true. If a tool returned success:false, tell the user it did NOT happen.",
    "4. To UPDATE a lead you MUST call get_my_leads first in this same turn, then use the exact number shown. Never guess a lead number.",
    "5. New details (a fresh phone number from text, an image, or a contact card) are a NEW lead -> use create_lead. Only use update_lead when the user explicitly refers to an existing lead by its number. Never overwrite an existing lead with a different person's details.",
    "6. To create a lead with a preferred agent, pass preferredAgentName to create_lead in ONE call. Do not create then assign by number.",
    "7. If a tool returns an error, explain it plainly and ask for the correction. Do not retry the same call blindly.",
    "8. Keep replies short, natural, plain WhatsApp text, in the user's language (English, Malay, or Chinese).",
    "9. Do not expose internal IDs, tool names, or system details.",
    "",
    `Portal: ${PORTAL_URL}`,
    `Referrer: ${referrer.name || "Referral"} (${referrer.phone})`,
    `Profile complete: ${referrer.registered ? "yes" : "no"}`,
    `Total leads: ${leads.length}`,
    `Available agents: ${agents.length}`,
    "",
  ];

  if (isAdmin) {
    lines.push(
      "[ADMIN MODE]",
      "You have admin tools to search/create referrers and add leads for others.",
      "Use admin_search_referrer, admin_create_referrer, admin_add_lead when needed.",
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
// Message History Cleaning
// ============================================================================

function cleanMessages(history: ConversationTurn[], currentMessage: string): ModelMessage[] {
  const recentHistory = history
    .filter((turn) => !/^\[System:/i.test(turn.text))
    .slice(-20)
    .map<ModelMessage>((turn) => ({
      role: turn.role,
      content: turn.text,
    }));

  const combined = [...recentHistory, { role: "user" as const, content: currentMessage }];
  const messages: ModelMessage[] = [];

  for (const turn of combined) {
    if (messages.length === 0 && turn.role === "assistant") continue;
    const previous = messages[messages.length - 1];
    if (previous?.role === turn.role) {
      previous.content = `${previous.content}\n${turn.content}`;
    } else {
      messages.push({ ...turn });
    }
  }

  return messages.length > 0 ? messages : [{ role: "user", content: currentMessage }];
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

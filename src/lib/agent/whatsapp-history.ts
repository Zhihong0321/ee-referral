/**
 * Pure helpers for assembling the V2 agent's conversation history and the
 * CURRENT STATE prompt block.
 *
 * IMPORTANT: this module must stay free of runtime imports (type-only imports
 * are fine). The node:test runner loads it directly and cannot resolve the
 * "@/" path alias, so any runtime dependency would break `npm test`.
 */

export type ConversationTurnLike = { role: "user" | "assistant"; text: string; time?: string };

export type ModelContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };
export type ModelMessage = { role: "user" | "assistant"; content: string | ModelContentBlock[] };

const SYSTEM_TURN_PATTERN = /^\[System:/i;

/**
 * Media inbound (image OCR, voice transcript, contact card failure notices) is
 * stored in history with a "[System: ...]" header. These turns used to be
 * dropped entirely from the history sent to the model — which deleted the very
 * turn that introduced a lead, and then cascaded into dropping the assistant
 * confirmation after it (leading-assistant turns are pruned). A conversation
 * that STARTED with an image lead reached turn 2 with empty history.
 *
 * Instead, distill them: keep the extracted entity details as a compact user
 * line, strip only the "[System: ...]" header and bot-facing instructions.
 */
export function distillHistoryTurnText(text: string): string {
  if (!SYSTEM_TURN_PATTERN.test(text)) return text;

  if (/(failed|No transcript is available)/i.test(text)) {
    return "(sent media that could not be read)";
  }

  const mediaKind = text.match(/^\[System:\s*User sent (an? [a-z ]+?)[.\]]/i)?.[1] || "media";
  const body = text
    .split("\n")
    .filter((line) => !SYSTEM_TURN_PATTERN.test(line) && !/Instruct the AI Agent/i.test(line))
    .join("\n")
    .trim();

  return body ? `(sent ${mediaKind}) ${body}` : `(sent ${mediaKind})`;
}

export function cleanMessages(history: ConversationTurnLike[], currentMessage: string): ModelMessage[] {
  const recentHistory = history
    .slice(-20)
    .map<ModelMessage>((turn) => ({
      role: turn.role,
      content: distillHistoryTurnText(turn.text),
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

export type LeadStateLike = {
  leadName: string | null;
  leadMobile: string | null;
  leadState: string | null;
  leadCity: string | null;
  preferredAgentName: string | null;
  status: string | null;
};

/**
 * The numbered lead list injected into the system prompt each turn. Numbers
 * here are the same numbers update_lead accepts (newest first, matching
 * listWhatsappReferrals order), so the model never has to guess and never has
 * to burn a tool round-trip just to learn what already exists.
 */
export function formatLeadStateLines(leads: LeadStateLike[], cap = 20): string[] {
  if (leads.length === 0) return ["  (no leads yet)"];

  const lines = leads.slice(0, cap).map((lead, idx) => {
    const area = [lead.leadState, lead.leadCity].map((value) => value?.trim()).filter(Boolean).join(", ");
    return `  ${idx + 1}. Lead "${lead.leadName || "(no name)"}" — ${lead.leadMobile || "no phone"}${area ? ` — ${area}` : ""} — sales agent: ${lead.preferredAgentName || "none"} — ${lead.status || "Pending"}`;
  });

  if (leads.length > cap) {
    lines.push(`  ...and ${leads.length - cap} more (use get_my_leads to see all).`);
  }

  return lines;
}

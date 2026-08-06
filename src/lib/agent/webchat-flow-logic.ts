/**
 * Pure, dependency-free step logic for the deterministic webchat menu flow
 * (src/lib/agent/webchat-flow.ts). No LLM calls, no database calls.
 *
 * IMPORTANT: this module must stay free of runtime imports (type-only
 * imports are fine) — the node:test runner loads it directly and cannot
 * resolve the "@/" path alias, so any runtime dependency would break
 * `npm test`. Mirrors the same rule already enforced in whatsapp-history.ts.
 */
import type { WebchatMenuState, WhatsappUpdateField } from "@/lib/agent/whatsapp-data";

export const MENU_TEXT = ["What would you like to do?", "1. Add Lead", "2. Edit Lead", "3. Check Lead"].join("\n");

export const GLOBAL_RESET_COMMANDS = new Set(["menu", "cancel", "0"]);

export const EDIT_FIELD_OPTIONS: Array<{ field: WhatsappUpdateField; label: string }> = [
  { field: "leadName", label: "Name" },
  { field: "leadMobileNumber", label: "Phone" },
  { field: "area", label: "Area" },
  { field: "preferredAgent", label: "Preferred Agent" },
  { field: "remark", label: "Remark" },
];

export function isPlausibleMalaysiaMobile(canonicalPhone: string) {
  return /^60\d{9,11}$/.test(canonicalPhone);
}

export function isSkip(normalized: string) {
  return normalized === "skip" || normalized === "";
}

export function isYes(normalized: string) {
  return normalized === "yes" || normalized === "y" || normalized === "confirm";
}

export function isNo(normalized: string) {
  return normalized === "no" || normalized === "n";
}

export function parseNumber(trimmed: string): number | null {
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number.parseInt(trimmed, 10);
  return Number.isFinite(value) ? value : null;
}

export function parseMenuSelection(normalized: string): "add" | "edit" | "check" | null {
  if (normalized === "1" || normalized.startsWith("add")) return "add";
  if (normalized === "2" || normalized.startsWith("edit")) return "edit";
  if (normalized === "3" || normalized.startsWith("check")) return "check";
  return null;
}

export function formatAgentList(agents: Array<{ id: string; name: string }>) {
  return agents.map((agent, idx) => `  ${idx + 1}. ${agent.name}`).join("\n");
}

export type StepResult = { reply: string; nextState: WebchatMenuState };

export function handleAddPhone(trimmed: string, canonicalize: (value: string) => string): StepResult {
  const canonical = canonicalize(trimmed);

  if (!isPlausibleMalaysiaMobile(canonical)) {
    return {
      reply: "That doesn't look like a valid phone number. Please enter it again (e.g. 012-3456789).",
      nextState: { step: "add_phone" },
    };
  }

  return {
    reply: "Got it. What's the lead's name? (Type 'skip' if you don't have it.)",
    nextState: { step: "add_name", draft: { leadMobileNumber: canonical } },
  };
}

export function handleAddName(state: Extract<WebchatMenuState, { step: "add_name" }>, trimmed: string, normalized: string): StepResult {
  const leadName = isSkip(normalized) ? "" : trimmed.slice(0, 200);

  return {
    reply: "Which area or state is the lead from? (Type 'skip' to leave blank.)",
    nextState: { step: "add_area", draft: { ...state.draft, leadName } },
  };
}

export function buildAddConfirm(draft: {
  leadMobileNumber: string;
  leadName: string;
  area: string;
  preferredAgentId: string | null;
  preferredAgentName: string | null;
}): StepResult {
  const summary = [
    `Phone: ${draft.leadMobileNumber}`,
    `Name: ${draft.leadName || "(none)"}`,
    `Area: ${draft.area || "(none)"}`,
    `Preferred agent: ${draft.preferredAgentName || "(none)"}`,
  ].join("\n");

  return {
    reply: `Please confirm this new lead:\n${summary}\n\nReply 'yes' to save, or 'cancel' to discard.`,
    nextState: { step: "add_confirm", draft },
  };
}

export function handleAddAgent(state: Extract<WebchatMenuState, { step: "add_agent" }>, trimmed: string, normalized: string): StepResult {
  if (isSkip(normalized)) {
    return buildAddConfirm({ ...state.draft, preferredAgentId: null, preferredAgentName: null });
  }

  const n = parseNumber(trimmed);
  if (!n || n < 1 || n > state.agents.length) {
    return {
      reply: `Please reply with a number between 1 and ${state.agents.length}, or type 'skip'.\n${formatAgentList(state.agents)}`,
      nextState: state,
    };
  }

  const agent = state.agents[n - 1];
  return buildAddConfirm({ ...state.draft, preferredAgentId: agent.id, preferredAgentName: agent.name });
}

export function handleEditPickLead(state: Extract<WebchatMenuState, { step: "edit_pick_lead" }>, trimmed: string): StepResult {
  const n = parseNumber(trimmed);
  if (!n || n < 1 || n > state.leads.length) {
    return { reply: `Please reply with a lead number between 1 and ${state.leads.length}.`, nextState: state };
  }

  const picked = state.leads[n - 1];
  const fieldLines = EDIT_FIELD_OPTIONS.map((opt, idx) => `${idx + 1}. ${opt.label}`).join("\n");

  return {
    reply: `Editing lead "${picked.label}". What would you like to change?\n${fieldLines}`,
    nextState: { step: "edit_pick_field", referralId: picked.referralId, leadLabel: picked.label },
  };
}

export function buildEditConfirm(
  state: { referralId: number; leadLabel: string; field?: WhatsappUpdateField },
  value: string,
  valueLabel: string,
): StepResult {
  const field = state.field as WhatsappUpdateField;
  const label = EDIT_FIELD_OPTIONS.find((opt) => opt.field === field)?.label || field;

  return {
    reply: `Change ${label} of "${state.leadLabel}" to "${valueLabel}"? Reply 'yes' to confirm, or 'cancel' to discard.`,
    nextState: { step: "edit_confirm", referralId: state.referralId, leadLabel: state.leadLabel, field, value, valueLabel },
  };
}

export function handleEditValue(
  state: Extract<WebchatMenuState, { step: "edit_value" }>,
  trimmed: string,
  normalized: string,
  canonicalize: (value: string) => string,
): StepResult {
  if (state.field === "leadMobileNumber") {
    const canonical = canonicalize(trimmed);
    if (!isPlausibleMalaysiaMobile(canonical)) {
      return {
        reply: "That doesn't look like a valid phone number. Please enter it again (e.g. 012-3456789).",
        nextState: state,
      };
    }
    return buildEditConfirm(state, canonical, canonical);
  }

  if (state.field === "remark" && isSkip(normalized)) {
    return buildEditConfirm(state, "", "(empty)");
  }

  const value = trimmed.slice(0, 500);
  return buildEditConfirm(state, value, value);
}

export function handleEditAgentPick(
  state: Extract<WebchatMenuState, { step: "edit_agent_pick" }>,
  trimmed: string,
  normalized: string,
): StepResult {
  if (isSkip(normalized)) {
    return buildEditConfirm(state, "", "(none)");
  }

  const n = parseNumber(trimmed);
  if (!n || n < 1 || n > state.agents.length) {
    return {
      reply: `Please reply with a number between 1 and ${state.agents.length}, or type 'skip' to clear it.\n${formatAgentList(state.agents)}`,
      nextState: state,
    };
  }

  const agent = state.agents[n - 1];
  return buildEditConfirm({ ...state, field: "preferredAgent" }, agent.id, agent.name);
}

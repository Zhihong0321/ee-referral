/**
 * Deterministic, menu-driven turn handler for the webchat referral assistant.
 *
 * No LLM is ever called from here. Every reply is a fixed prompt chosen by
 * plain string/number parsing against the caller's current step (pure logic
 * lives in webchat-flow-logic.ts, testable without a database), and every
 * write goes through the same validated functions the old agent used
 * (whatsapp-data.ts). Per-referrer step state is persisted via
 * loadAgentState/saveAgentState so a multi-turn flow (e.g. Add Lead) survives
 * across separate HTTP requests.
 */
import {
  EMPTY_WEBCHAT_MENU_STATE,
  createWhatsappReferral,
  listWhatsappAgents,
  listWhatsappReferralsByReferrerPhone,
  loadAgentState,
  resolveOrCreateReferrerByWhatsappPhone,
  saveAgentState,
  updateWhatsappReferral,
  type WebchatMenuState,
} from "@/lib/agent/whatsapp-data";
import { formatLeadStateLines } from "@/lib/agent/whatsapp-history";
import { toCanonicalMalaysiaPhone } from "@/lib/phone-normalization";
import {
  EDIT_FIELD_OPTIONS,
  GLOBAL_RESET_COMMANDS,
  MENU_TEXT,
  buildAddConfirm,
  formatAgentList,
  handleAddAgent,
  handleAddName,
  handleAddPhone,
  handleEditAgentPick,
  handleEditPickLead,
  handleEditValue,
  isNo,
  isYes,
  parseMenuSelection,
  parseNumber,
  type StepResult,
} from "@/lib/agent/webchat-flow-logic";

async function handleCheckLead(canonicalPhone: string): Promise<StepResult> {
  const leads = await listWhatsappReferralsByReferrerPhone(canonicalPhone);
  const lines = formatLeadStateLines(leads);
  const reply = `Here are your leads:\n${lines.join("\n")}\n\n${MENU_TEXT}`;
  return { reply, nextState: EMPTY_WEBCHAT_MENU_STATE };
}

async function beginEditLead(canonicalPhone: string): Promise<StepResult> {
  const leads = await listWhatsappReferralsByReferrerPhone(canonicalPhone);

  if (leads.length === 0) {
    return {
      reply: `You have no leads yet.\n\n${MENU_TEXT}`,
      nextState: EMPTY_WEBCHAT_MENU_STATE,
    };
  }

  const lines = formatLeadStateLines(leads);
  const pickList = leads.map((lead) => ({ referralId: lead.id, label: lead.leadName || `Lead #${lead.id}` }));

  return {
    reply: `Which lead would you like to edit?\n${lines.join("\n")}\n\nReply with the lead number.`,
    nextState: { step: "edit_pick_lead", leads: pickList },
  };
}

async function handleMenuStep(trimmed: string, normalized: string, canonicalPhone: string): Promise<StepResult> {
  const selection = parseMenuSelection(normalized);

  if (selection === "add") {
    return { reply: "Let's add a new lead. What's the lead's phone number?", nextState: { step: "add_phone" } };
  }

  if (selection === "edit") {
    return beginEditLead(canonicalPhone);
  }

  if (selection === "check") {
    return handleCheckLead(canonicalPhone);
  }

  return { reply: MENU_TEXT, nextState: EMPTY_WEBCHAT_MENU_STATE };
}

async function handleAddArea(state: Extract<WebchatMenuState, { step: "add_area" }>, trimmed: string, normalized: string): Promise<StepResult> {
  const isSkipArea = normalized === "skip" || normalized === "";
  const area = isSkipArea ? "" : trimmed.slice(0, 200);
  const draft = { ...state.draft, area };
  const agents = await listWhatsappAgents();

  if (agents.length === 0) {
    return buildAddConfirm({ ...draft, preferredAgentId: null, preferredAgentName: null });
  }

  return {
    reply: `Who's the preferred agent for this lead? (Reply with a number, or type 'skip'.)\n${formatAgentList(agents)}`,
    nextState: { step: "add_agent", draft, agents },
  };
}

async function handleAddConfirm(
  state: Extract<WebchatMenuState, { step: "add_confirm" }>,
  senderPhone: string,
  normalized: string,
): Promise<StepResult> {
  if (isNo(normalized)) {
    return { reply: `Discarded.\n\n${MENU_TEXT}`, nextState: EMPTY_WEBCHAT_MENU_STATE };
  }

  if (!isYes(normalized)) {
    return { reply: "Reply 'yes' to save this lead, or 'cancel' to discard.", nextState: state };
  }

  const referrer = await resolveOrCreateReferrerByWhatsappPhone(senderPhone);
  const { referralId } = await createWhatsappReferral(
    referrer,
    { leadName: state.draft.leadName, leadMobileNumber: state.draft.leadMobileNumber, area: state.draft.area },
    { preferredAgentId: state.draft.preferredAgentId },
  );

  return {
    reply: `Lead saved (#${referralId}).\n\n${MENU_TEXT}`,
    nextState: EMPTY_WEBCHAT_MENU_STATE,
  };
}

async function handleEditPickField(
  state: Extract<WebchatMenuState, { step: "edit_pick_field" }>,
  trimmed: string,
): Promise<StepResult> {
  const n = parseNumber(trimmed);
  if (!n || n < 1 || n > EDIT_FIELD_OPTIONS.length) {
    const fieldLines = EDIT_FIELD_OPTIONS.map((opt, idx) => `${idx + 1}. ${opt.label}`).join("\n");
    return { reply: `Please reply with a number between 1 and ${EDIT_FIELD_OPTIONS.length}.\n${fieldLines}`, nextState: state };
  }

  const chosen = EDIT_FIELD_OPTIONS[n - 1];

  if (chosen.field === "preferredAgent") {
    const agents = await listWhatsappAgents();
    if (agents.length === 0) {
      return { reply: `No agents are configured yet.\n\n${MENU_TEXT}`, nextState: EMPTY_WEBCHAT_MENU_STATE };
    }
    return {
      reply: `Who's the new preferred agent? (Reply with a number, or type 'skip' to clear it.)\n${formatAgentList(agents)}`,
      nextState: { step: "edit_agent_pick", referralId: state.referralId, leadLabel: state.leadLabel, agents },
    };
  }

  return {
    reply: `What should the new ${chosen.label.toLowerCase()} be?${chosen.field === "remark" ? " (Type 'skip' to clear it.)" : ""}`,
    nextState: { step: "edit_value", referralId: state.referralId, leadLabel: state.leadLabel, field: chosen.field },
  };
}

async function handleEditConfirm(
  state: Extract<WebchatMenuState, { step: "edit_confirm" }>,
  senderPhone: string,
  normalized: string,
): Promise<StepResult> {
  if (isNo(normalized)) {
    return { reply: `Discarded.\n\n${MENU_TEXT}`, nextState: EMPTY_WEBCHAT_MENU_STATE };
  }

  if (!isYes(normalized)) {
    return { reply: "Reply 'yes' to save this change, or 'cancel' to discard.", nextState: state };
  }

  const referrer = await resolveOrCreateReferrerByWhatsappPhone(senderPhone);
  await updateWhatsappReferral(referrer, { referralId: state.referralId, field: state.field, value: state.value });

  return {
    reply: `Lead "${state.leadLabel}" updated.\n\n${MENU_TEXT}`,
    nextState: EMPTY_WEBCHAT_MENU_STATE,
  };
}

async function dispatch(
  state: WebchatMenuState,
  senderPhone: string,
  canonicalPhone: string,
  trimmed: string,
  normalized: string,
): Promise<StepResult> {
  switch (state.step) {
    case "menu":
      return handleMenuStep(trimmed, normalized, canonicalPhone);
    case "add_phone":
      return handleAddPhone(trimmed, toCanonicalMalaysiaPhone);
    case "add_name":
      return handleAddName(state, trimmed, normalized);
    case "add_area":
      return handleAddArea(state, trimmed, normalized);
    case "add_agent":
      return handleAddAgent(state, trimmed, normalized);
    case "add_confirm":
      return handleAddConfirm(state, senderPhone, normalized);
    case "edit_pick_lead":
      return handleEditPickLead(state, trimmed);
    case "edit_pick_field":
      return handleEditPickField(state, trimmed);
    case "edit_value":
      return handleEditValue(state, trimmed, normalized, toCanonicalMalaysiaPhone);
    case "edit_agent_pick":
      return handleEditAgentPick(state, trimmed, normalized);
    case "edit_confirm":
      return handleEditConfirm(state, senderPhone, normalized);
    default:
      return { reply: MENU_TEXT, nextState: EMPTY_WEBCHAT_MENU_STATE };
  }
}

export async function runWebchatMenuTurn(params: { senderPhone: string; text: string }): Promise<{ reply: string }> {
  const canonicalPhone = toCanonicalMalaysiaPhone(params.senderPhone);
  const trimmed = (params.text || "").trim();
  const normalized = trimmed.toLowerCase();

  if (GLOBAL_RESET_COMMANDS.has(normalized)) {
    await saveAgentState(canonicalPhone, EMPTY_WEBCHAT_MENU_STATE);
    return { reply: MENU_TEXT };
  }

  const state = await loadAgentState(canonicalPhone);
  const { reply, nextState } = await dispatch(state, params.senderPhone, canonicalPhone, trimmed, normalized);
  await saveAgentState(canonicalPhone, nextState);

  return { reply };
}

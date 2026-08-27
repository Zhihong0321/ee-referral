/**
 * Deterministic, menu-driven turn handler for the webchat referral assistant.
 *
 * No LLM is ever called from here. Every reply is a fixed prompt chosen by
 * plain string/number parsing against the caller's current step (pure logic
 * lives in webchat-flow-logic.ts, testable without a database), and every
 * write goes through the same validated functions the old agent used
 * (whatsapp-data.ts). Per-referrer step state is persisted via
 * loadAgentState/saveAgentState so a multi-turn flow survives across separate
 * HTTP requests.
 *
 * Adding a lead and updating your own details are NOT multi-turn here: each is
 * a single form the browser renders and submits in one shot to
 * /api/web-chat/form. This module only opens those forms; the route saves them.
 */
import {
  EMPTY_WEBCHAT_MENU_STATE,
  REFERRAL_ACCOUNT_NAME,
  listWhatsappAgents,
  listWhatsappReferralsByReferrerPhone,
  loadAgentState,
  resolveOrCreateReferrerByWhatsappPhone,
  saveAgentState,
  updateWhatsappReferral,
  type WebchatMenuState,
} from "@/lib/agent/whatsapp-data";
import type { WebchatForm } from "@/lib/agent/webchat-forms";
import { formatLeadStateLines } from "@/lib/agent/whatsapp-history";
import { toCanonicalMalaysiaPhone } from "@/lib/phone-normalization";
import {
  EDIT_FIELD_OPTIONS,
  GLOBAL_RESET_COMMANDS,
  MENU_TEXT,
  formatAgentList,
  handleEditAgentPick,
  handleEditPickLead,
  handleEditValue,
  isNo,
  isYes,
  parseMenuSelection,
  parseNumber,
  type StepResult,
} from "@/lib/agent/webchat-flow-logic";

/**
 * Builds the "Add Lead" form. Field 2 (the referrer) is filled from the phone
 * the caller logged in with — it is displayed, never typed.
 */
export async function buildAddLeadForm(canonicalPhone: string): Promise<StepResult> {
  const [referrer, agents] = await Promise.all([
    resolveOrCreateReferrerByWhatsappPhone(canonicalPhone),
    listWhatsappAgents(),
  ]);

  const form: WebchatForm = {
    kind: "add_lead",
    referrer: { name: referrer.name, phone: referrer.phone || canonicalPhone },
    agents,
  };

  return {
    reply: "Fill in the lead's details below and tap Submit.",
    nextState: { step: "add_form" },
    form,
  };
}

export async function buildProfileForm(canonicalPhone: string): Promise<StepResult> {
  const referrer = await resolveOrCreateReferrerByWhatsappPhone(canonicalPhone);

  const form: WebchatForm = {
    kind: "profile",
    phone: referrer.phone || canonicalPhone,
    values: {
      // A referrer with no name yet carries the generic placeholder account
      // name; show it as blank so they type their real name instead of editing
      // boilerplate. Anyone who already has a real name keeps it prefilled,
      // whether or not their bank details are on file yet.
      name: referrer.name === REFERRAL_ACCOUNT_NAME ? "" : referrer.name,
      bankAccount: referrer.bankAccount,
      icNumber: referrer.icNumber,
    },
  };

  return {
    reply: "Update your referrer details below and tap Save.",
    nextState: { step: "profile_form" },
    form,
  };
}

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

async function handleMenuStep(normalized: string, canonicalPhone: string): Promise<StepResult> {
  const selection = parseMenuSelection(normalized);

  if (selection === "add") {
    return buildAddLeadForm(canonicalPhone);
  }

  if (selection === "edit") {
    return beginEditLead(canonicalPhone);
  }

  if (selection === "check") {
    return handleCheckLead(canonicalPhone);
  }

  if (selection === "profile") {
    return buildProfileForm(canonicalPhone);
  }

  return { reply: MENU_TEXT, nextState: EMPTY_WEBCHAT_MENU_STATE };
}

/**
 * While a form is on screen, typing is not how you fill it in. A different menu
 * choice still switches away; anything else re-sends the same form so a reload
 * or a stray message cannot strand the user.
 */
async function handleFormStep(
  step: "add_form" | "profile_form",
  normalized: string,
  canonicalPhone: string,
): Promise<StepResult> {
  const selection = parseMenuSelection(normalized);

  if (selection) {
    return handleMenuStep(normalized, canonicalPhone);
  }

  const reopened = step === "add_form" ? await buildAddLeadForm(canonicalPhone) : await buildProfileForm(canonicalPhone);
  return { ...reopened, reply: `${reopened.reply}\n\n(Type 'menu' to go back.)` };
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
      return handleMenuStep(normalized, canonicalPhone);
    case "add_form":
    case "profile_form":
      return handleFormStep(state.step, normalized, canonicalPhone);
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
      // Also the landing spot for states persisted by an older build of the
      // flow (the retired step-by-step "Add Lead" questions).
      return { reply: MENU_TEXT, nextState: EMPTY_WEBCHAT_MENU_STATE };
  }
}

export async function runWebchatMenuTurn(params: {
  senderPhone: string;
  text: string;
}): Promise<{ reply: string; form?: WebchatForm }> {
  const canonicalPhone = toCanonicalMalaysiaPhone(params.senderPhone);
  const trimmed = (params.text || "").trim();
  const normalized = trimmed.toLowerCase();

  if (GLOBAL_RESET_COMMANDS.has(normalized)) {
    await saveAgentState(canonicalPhone, EMPTY_WEBCHAT_MENU_STATE);
    return { reply: MENU_TEXT };
  }

  const state = await loadAgentState(canonicalPhone);
  const { reply, nextState, form } = await dispatch(state, params.senderPhone, canonicalPhone, trimmed, normalized);
  await saveAgentState(canonicalPhone, nextState);

  return { reply, form };
}

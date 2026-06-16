import { PROJECT_TYPE_OPTIONS, RELATIONSHIP_OPTIONS } from "@/lib/referrals";
import { toCanonicalMalaysiaPhone } from "@/lib/phone-normalization";
import {
  createWhatsappReferral,
  EMPTY_WHATSAPP_AGENT_STATE,
  isAllowedProjectType,
  isAllowedRelationship,
  isWhatsappSuperAdminPhone,
  listAllWhatsappReferrals,
  listWhatsappReferrals,
  listWhatsappReferralsByReferrerPhone,
  resolveOrCreateReferrerByWhatsappPhone,
  saveAgentState,
  updateWhatsappReferral,
  type WhatsappAgentState,
  type WhatsappAdminReferralRow,
  type WhatsappLeadDraft,
  type WhatsappLeadField,
  type WhatsappReferrerAccount,
  type WhatsappUpdateField,
} from "@/lib/agent/whatsapp-data";
import { classifyWhatsappIntent, polishWhatsappReply } from "@/lib/agent/whatsapp-llm";

const FIELD_SEQUENCE: WhatsappLeadField[] = [
  "leadName",
  "leadMobileNumber",
  "leadState",
  "leadCity",
  "leadAddress",
  "relationship",
  "projectType",
  "remark",
];
const OPTIONAL_FIELDS = new Set<WhatsappLeadField>(["leadCity", "leadAddress", "remark"]);

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function isAdminReferralRow(value: unknown): value is WhatsappAdminReferralRow {
  return Boolean(value && typeof value === "object" && "referrerCustomerId" in value);
}

function isSkip(value: string) {
  return ["skip", "none", "na", "n/a", "-"].includes(normalizeText(value));
}

function isCancel(value: string) {
  return ["cancel", "stop", "abort"].includes(normalizeText(value));
}

function isConfirm(value: string) {
  return ["confirm", "yes", "save", "ok", "okay"].includes(normalizeText(value));
}

function wantsAddLead(message: string) {
  const text = normalizeText(message);
  return text.includes("new lead") || text.includes("add lead") || text.includes("create lead") || text.includes("refer someone");
}

function wantsLeadList(message: string) {
  const text = normalizeText(message);
  return text.includes("my leads") || text.includes("my referrals") || text.includes("show all leads") || text === "leads" || text.includes("manage lead");
}

function wantsAdminLeadList(message: string) {
  const text = normalizeText(message);
  return (
    text.includes("all leads") ||
    text.includes("all referral") ||
    text.includes("all submitted") ||
    text.includes("other referral") ||
    text.includes("everyone") ||
    text.includes("company leads")
  );
}

function extractPhoneFromMessage(message: string) {
  const matches = message.match(/(?:\+?6?0?1[0-9][\s-]?[0-9\s-]{6,}|60[0-9]{8,}|0[0-9]{8,})/g) || [];
  const candidate = matches
    .map((value) => value.replace(/\D/g, ""))
    .find((value) => value.length >= 9);

  return candidate || "";
}

function wantsLeadDetail(message: string) {
  const text = normalizeText(message);
  return text.includes("show lead") || text.includes("lead detail") || text.includes("status of") || text.includes("open lead");
}

function wantsUpdateLead(message: string) {
  const text = normalizeText(message);
  return text.includes("update lead") || text.includes("edit lead") || text.includes("change lead") || text.includes("change the") || text.includes("update the");
}

function wantsHelp(message: string) {
  const text = normalizeText(message);
  return text === "hi" || text === "hello" || text === "help" || text === "menu" || text === "start";
}

function getNextField(draft: Partial<WhatsappLeadDraft>) {
  for (const field of FIELD_SEQUENCE) {
    const value = draft[field];

    if (OPTIONAL_FIELDS.has(field)) {
      if (typeof value !== "string") return field;
      continue;
    }

    if (typeof value !== "string" || !value.trim()) {
      return field;
    }
  }

  return null;
}

function describeField(field: WhatsappLeadField) {
  switch (field) {
    case "leadName":
      return "What is the lead name?";
    case "leadMobileNumber":
      return "What is the lead mobile number?";
    case "leadState":
      return "Which state is the lead in?";
    case "leadCity":
      return 'Which city is the lead in? Reply "skip" if not needed.';
    case "leadAddress":
      return 'What is the lead address? Reply "skip" if not needed.';
    case "relationship":
      return `What is your relationship to the lead?\nOptions: ${RELATIONSHIP_OPTIONS.join(", ")}`;
    case "projectType":
      return `What is the project type?\nOptions: ${PROJECT_TYPE_OPTIONS.join(", ")}`;
    case "remark":
      return 'Any remark for this lead? Reply "skip" if none.';
  }
}

function describeUpdateField(field: WhatsappUpdateField) {
  switch (field) {
    case "leadName":
      return "lead name";
    case "leadMobileNumber":
      return "lead mobile number";
    case "leadState":
      return "state";
    case "leadCity":
      return "city";
    case "leadAddress":
      return "address";
    case "relationship":
      return "relationship";
    case "projectType":
      return "project type";
    case "remark":
      return "remark";
  }
}

function parseUpdateField(message: string): WhatsappUpdateField | null {
  const text = normalizeText(message);

  if (text.includes("phone") || text.includes("mobile") || text.includes("number")) return "leadMobileNumber";
  if (text.includes("name")) return "leadName";
  if (text.includes("state")) return "leadState";
  if (text.includes("city")) return "leadCity";
  if (text.includes("address") || text.includes("location")) return "leadAddress";
  if (text.includes("relationship")) return "relationship";
  if (text.includes("project")) return "projectType";
  if (text.includes("remark") || text.includes("note")) return "remark";

  const direct = FIELD_SEQUENCE.find((field) => normalizeText(describeUpdateField(field)) === text);
  return direct || null;
}

function validateField(field: WhatsappLeadField, rawValue: string) {
  const value = rawValue.trim();

  switch (field) {
    case "leadName":
      return value.length >= 2 ? { ok: true as const, value } : { ok: false as const, error: "Lead name must be at least 2 characters." };
    case "leadMobileNumber": {
      const canonical = toCanonicalMalaysiaPhone(value);
      return canonical.length >= 8 ? { ok: true as const, value: canonical } : { ok: false as const, error: "Lead mobile number looks too short." };
    }
    case "leadState":
      return value.length >= 2 ? { ok: true as const, value } : { ok: false as const, error: "Lead state is required." };
    case "leadCity":
    case "leadAddress":
    case "remark":
      return { ok: true as const, value: isSkip(value) ? "" : value };
    case "relationship": {
      const match = RELATIONSHIP_OPTIONS.find((option) => normalizeText(option) === normalizeText(value));
      return match && isAllowedRelationship(match) ? { ok: true as const, value: match } : { ok: false as const, error: `Use one of: ${RELATIONSHIP_OPTIONS.join(", ")}` };
    }
    case "projectType": {
      const match = PROJECT_TYPE_OPTIONS.find((option) => normalizeText(option) === normalizeText(value));
      return match && isAllowedProjectType(match) ? { ok: true as const, value: match } : { ok: false as const, error: `Use one of: ${PROJECT_TYPE_OPTIONS.join(", ")}` };
    }
  }
}

function draftSummary(draft: Partial<WhatsappLeadDraft>) {
  return [
    `Lead name: ${draft.leadName || "-"}`,
    `Mobile: ${draft.leadMobileNumber || "-"}`,
    `State: ${draft.leadState || "-"}`,
    `City: ${draft.leadCity || "-"}`,
    `Address: ${draft.leadAddress || "-"}`,
    `Relationship: ${draft.relationship || "-"}`,
    `Project type: ${draft.projectType || "-"}`,
    `Remark: ${draft.remark || "-"}`,
  ].join("\n");
}

async function buildLeadListReply(referrer: WhatsappReferrerAccount, senderPhone: string) {
  const referrals = await listWhatsappReferrals(referrer.customerId);
  const listState = referrals.slice(0, 20).map((lead, index) => ({
    index: index + 1,
    referralId: lead.id,
    leadName: lead.leadName,
  }));

  await saveAgentState(senderPhone, {
    ...EMPTY_WHATSAPP_AGENT_STATE,
    lastLeadList: listState,
  });

  if (referrals.length === 0) {
    return 'Tool result: No referral leads found under this WhatsApp number. Next action: user can reply "add lead" to create one.';
  }

  const lines = referrals.slice(0, 10).map((lead, index) => `${index + 1}. ${lead.leadName} | ${lead.leadMobile || "-"} | ${lead.status || "Pending"}`);
  return `Tool result: Found ${referrals.length} lead(s):\n${lines.join("\n")}\n\nNext actions: user can reply "show lead 1" to inspect one, or "add lead" to create a new lead.`;
}

async function buildAdminLeadListReply(senderPhone: string) {
  const referrals = await listAllWhatsappReferrals(30);
  const listState = referrals.slice(0, 30).map((lead, index) => ({
    index: index + 1,
    referralId: lead.id,
    leadName: lead.leadName,
  }));

  await saveAgentState(senderPhone, {
    ...EMPTY_WHATSAPP_AGENT_STATE,
    lastLeadList: listState,
  });

  if (referrals.length === 0) {
    return "Tool result: No submitted referral leads found in the system.";
  }

  const lines = referrals.slice(0, 15).map((lead, index) => {
    const referrerLabel = [lead.referrerName, lead.referrerPhone].map((value) => value?.trim()).filter(Boolean).join(" / ");
    return `${index + 1}. ${lead.leadName} | ${lead.leadMobile || "-"} | ${lead.status || "Pending"} | Referrer: ${referrerLabel || lead.referrerCustomerId}`;
  });

  return `Tool result: Super admin all-referral view. Showing ${Math.min(referrals.length, 15)} latest lead(s):\n${lines.join("\n")}\n\nNext actions: user can reply "show lead 1" for detail, or "my leads" for only their own referral account.`;
}

async function buildAdminLeadListByReferrerPhoneReply(senderPhone: string, referrerPhone: string) {
  const referrals = await listWhatsappReferralsByReferrerPhone(referrerPhone, 30);
  const listState = referrals.slice(0, 30).map((lead, index) => ({
    index: index + 1,
    referralId: lead.id,
    leadName: lead.leadName,
  }));

  await saveAgentState(senderPhone, {
    ...EMPTY_WHATSAPP_AGENT_STATE,
    lastLeadList: listState,
  });

  if (referrals.length === 0) {
    return `Tool result: No submitted referral leads found for referrer phone ${referrerPhone}.`;
  }

  const referrerLabel = [referrals[0].referrerName, referrals[0].referrerPhone].map((value) => value?.trim()).filter(Boolean).join(" / ");
  const lines = referrals.slice(0, 15).map((lead, index) => `${index + 1}. ${lead.leadName} | ${lead.leadMobile || "-"} | ${lead.status || "Pending"}`);

  return `Tool result: Super admin referrer-filter view.\nReferrer: ${referrerLabel || referrals[0].referrerCustomerId}\nShowing ${Math.min(referrals.length, 15)} lead(s):\n${lines.join("\n")}\n\nNext action: user can reply "show lead 1" for detail.`;
}

async function buildLeadDetailReply(referrer: WhatsappReferrerAccount, message: string) {
  const adminMode = isWhatsappSuperAdminPhone(referrer.phone);
  const referrals = adminMode ? await listAllWhatsappReferrals(30) : await listWhatsappReferrals(referrer.customerId);
  const text = normalizeText(message);
  const indexMatch = text.match(/\blead\s+(\d+)\b/);
  let selected = null;

  if (indexMatch) {
    selected = referrals[Number(indexMatch[1]) - 1] || null;
  }

  if (!selected) {
    const named = text.match(/(?:status of|show|open)\s+(.+)/)?.[1]?.trim();
    if (named) {
      selected = referrals.find((lead) => normalizeText(lead.leadName).includes(named)) || null;
    }
  }

  if (!selected) {
    return 'Tool result: Could not match that request to a current lead. Next action: ask user to reply "my leads" first, then "show lead 1".';
  }

  const location = [selected.leadState, selected.leadCity, selected.leadAddress].map((value) => value?.trim()).filter(Boolean).join(" | ");
  const referrerInfo =
    isAdminReferralRow(selected)
      ? [
          `Referrer: ${selected.referrerName || "-"}`,
          `Referrer phone: ${selected.referrerPhone || "-"}`,
          `Referrer ID: ${selected.referrerCustomerId}`,
        ]
      : [];

  return [
    "Tool result: Lead detail found.",
    `Lead: ${selected.leadName}`,
    `Mobile: ${selected.leadMobile || "-"}`,
    `Status: ${selected.status || "Pending"}`,
    `Project: ${selected.projectType || "Not set"}`,
    `Relationship: ${selected.relationship || "-"}`,
    `Location: ${location || "-"}`,
    `Preferred agent: ${selected.preferredAgentName || "Not selected"}`,
    ...referrerInfo,
  ].join("\n");
}

function selectLeadFromMessage(message: string, referrals: Awaited<ReturnType<typeof listWhatsappReferrals>>) {
  const text = normalizeText(message);
  const indexMatch = text.match(/\blead\s+(\d+)\b/) || text.match(/\b(\d+)\b/);

  if (indexMatch) {
    const lead = referrals[Number(indexMatch[1]) - 1];
    if (lead) return lead;
  }

  if (text.includes("latest")) {
    return referrals[0] || null;
  }

  const cleaned = text
    .replace(/update|edit|change|lead|status|of|the|my|details|for/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned) {
    return referrals.find((lead) => normalizeText(lead.leadName).includes(cleaned)) || null;
  }

  return null;
}

async function runLeadUpdate(senderPhone: string, referrer: WhatsappReferrerAccount, state: WhatsappAgentState, message: string) {
  if (isCancel(message)) {
    await saveAgentState(senderPhone, EMPTY_WHATSAPP_AGENT_STATE);
    return polishWhatsappReply({
      referrer,
      userMessage: message,
      toolResult: 'Tool result: Lead update cancelled. Next action: user can reply "my leads" or "update lead 1".',
    });
  }

  const referrals = await listWhatsappReferrals(referrer.customerId);

  if (state.mode === "idle") {
    const selected = selectLeadFromMessage(message, referrals);

    if (!selected) {
      const lines = referrals.slice(0, 10).map((lead, index) => `${index + 1}. ${lead.leadName} | ${lead.leadMobile || "-"} | ${lead.status || "Pending"}`);
      await saveAgentState(senderPhone, {
        ...EMPTY_WHATSAPP_AGENT_STATE,
        mode: "selecting_update_lead",
        lastLeadList: referrals.slice(0, 20).map((lead, index) => ({ index: index + 1, referralId: lead.id, leadName: lead.leadName })),
      });
      return polishWhatsappReply({
        referrer,
        userMessage: message,
        toolResult: `Tool result: User wants to update a lead but no target was selected.\nCurrent leads:\n${lines.join("\n") || "No leads found."}\nAsk user to reply with a lead number, for example "lead 1".`,
      });
    }

    const field = parseUpdateField(message);
    await saveAgentState(senderPhone, {
      ...EMPTY_WHATSAPP_AGENT_STATE,
      mode: field ? "collecting_update_value" : "selecting_update_field",
      update: { referralId: selected.id, field: field || undefined },
    });
    return polishWhatsappReply({
      referrer,
      userMessage: message,
      toolResult: field
        ? `Tool result: Selected lead ${selected.leadName}. Ask for the new ${describeUpdateField(field)}.`
        : `Tool result: Selected lead ${selected.leadName}. Ask which field to update. Available fields: name, mobile, state, city, address, relationship, project, remark.`,
    });
  }

  if (state.mode === "selecting_update_lead") {
    const selected = selectLeadFromMessage(message, referrals);

    if (!selected) {
      return polishWhatsappReply({
        referrer,
        userMessage: message,
        toolResult: 'Tool result: Could not match the lead number/name. Ask user to reply with a lead number such as "lead 1".',
      });
    }

    await saveAgentState(senderPhone, {
      ...EMPTY_WHATSAPP_AGENT_STATE,
      mode: "selecting_update_field",
      update: { referralId: selected.id },
    });
    return polishWhatsappReply({
      referrer,
      userMessage: message,
      toolResult: `Tool result: Selected lead ${selected.leadName}. Ask which field to update. Available fields: name, mobile, state, city, address, relationship, project, remark.`,
    });
  }

  if (state.mode === "selecting_update_field") {
    const field = parseUpdateField(message);

    if (!field) {
      return polishWhatsappReply({
        referrer,
        userMessage: message,
        toolResult: "Tool result: Could not identify update field. Ask user to choose one: name, mobile, state, city, address, relationship, project, remark.",
      });
    }

    await saveAgentState(senderPhone, {
      ...state,
      mode: "collecting_update_value",
      update: { ...state.update, field },
    });
    return polishWhatsappReply({
      referrer,
      userMessage: message,
      toolResult: `Tool result: Update field selected: ${describeUpdateField(field)}. Ask for the new value.`,
    });
  }

  if (state.mode === "collecting_update_value") {
    const field = state.update?.field;

    if (!field || !state.update?.referralId) {
      await saveAgentState(senderPhone, EMPTY_WHATSAPP_AGENT_STATE);
      return "I lost the update context. Please reply \"update lead 1\" to start again.";
    }

    const parsed = validateField(field, message);
    if (!parsed.ok) {
      return polishWhatsappReply({
        referrer,
        userMessage: message,
        toolResult: `Tool result: Validation error: ${parsed.error}. Ask user for a valid ${describeUpdateField(field)}.`,
      });
    }

    await saveAgentState(senderPhone, {
      ...state,
      mode: "confirming_update",
      update: { ...state.update, value: parsed.value },
    });
    return polishWhatsappReply({
      referrer,
      userMessage: message,
      toolResult: `Tool result: Ready to update lead ID ${state.update.referralId}. Field: ${describeUpdateField(field)}. New value: ${parsed.value}. Ask user to reply "CONFIRM" to save or "CANCEL" to stop.`,
    });
  }

  if (state.mode === "confirming_update") {
    if (!isConfirm(message)) {
      return polishWhatsappReply({
        referrer,
        userMessage: message,
        toolResult: 'Tool result: Update is ready but not saved. Ask user to reply "CONFIRM" to save or "CANCEL" to stop.',
      });
    }

    if (!state.update?.referralId || !state.update.field || typeof state.update.value !== "string") {
      await saveAgentState(senderPhone, EMPTY_WHATSAPP_AGENT_STATE);
      return "I lost the update context. Please reply \"update lead 1\" to start again.";
    }

    const updated = await updateWhatsappReferral(referrer, {
      referralId: state.update.referralId,
      field: state.update.field,
      value: state.update.value,
    });
    await saveAgentState(senderPhone, EMPTY_WHATSAPP_AGENT_STATE);
    return polishWhatsappReply({
      referrer,
      userMessage: message,
      toolResult: `Tool result: Lead updated successfully.\nReferral ID: ${updated.referralId}\nLead: ${updated.leadName}\nUpdated field: ${describeUpdateField(state.update.field)}\nNew value: ${state.update.value}`,
    });
  }

  return "Please reply \"my leads\", \"add lead\", or \"update lead 1\".";
}

async function runLeadCollection(senderPhone: string, referrer: WhatsappReferrerAccount, state: WhatsappAgentState, message: string) {
  if (isCancel(message)) {
    await saveAgentState(senderPhone, EMPTY_WHATSAPP_AGENT_STATE);
    return polishWhatsappReply({
      referrer,
      userMessage: message,
      toolResult: 'Tool result: Lead creation cancelled. Next action: user can reply "add lead" to start again.',
    });
  }

  if (state.mode === "idle") {
    const nextState: WhatsappAgentState = {
      mode: "collecting_lead",
      draft: {},
      nextField: "leadName",
    };
    await saveAgentState(senderPhone, nextState);
    return polishWhatsappReply({
      referrer,
      userMessage: message,
      toolResult: `Tool result: Started a new referral lead collection. Ask this exact next question: ${describeField("leadName")}`,
    });
  }

  if (state.mode === "confirming_lead") {
    if (!isConfirm(message)) {
      return polishWhatsappReply({
        referrer,
        userMessage: message,
        toolResult: 'Tool result: Lead is ready but not saved yet. Ask user to reply "CONFIRM" to save this lead or "CANCEL" to stop.',
      });
    }

    const referralId = await createWhatsappReferral(referrer, state.draft as WhatsappLeadDraft);
    await saveAgentState(senderPhone, EMPTY_WHATSAPP_AGENT_STATE);
    return polishWhatsappReply({
      referrer,
      userMessage: message,
      toolResult: `Tool result: Lead saved successfully.\nReferral ID: ${referralId}\nLead: ${state.draft.leadName}\nMobile: ${state.draft.leadMobileNumber}`,
    });
  }

  const field = state.nextField || getNextField(state.draft);
  if (!field) {
    const nextState: WhatsappAgentState = {
      mode: "confirming_lead",
      draft: state.draft,
      nextField: null,
    };
    await saveAgentState(senderPhone, nextState);
    return polishWhatsappReply({
      referrer,
      userMessage: message,
      toolResult: `Tool result: Lead draft complete. Ask user to review and reply "CONFIRM" to save or "CANCEL" to stop.\n\n${draftSummary(state.draft)}`,
    });
  }

  const parsed = validateField(field, message);
  if (!parsed.ok) {
    return polishWhatsappReply({
      referrer,
      userMessage: message,
      toolResult: `Tool result: Validation error: ${parsed.error}\nAsk this exact next question: ${describeField(field)}`,
    });
  }

  const draft = {
    ...state.draft,
    [field]: parsed.value,
  };
  const nextField = getNextField(draft);

  if (!nextField) {
    const nextState: WhatsappAgentState = {
      mode: "confirming_lead",
      draft,
      nextField: null,
    };
    await saveAgentState(senderPhone, nextState);
    return polishWhatsappReply({
      referrer,
      userMessage: message,
      toolResult: `Tool result: Lead draft complete. Ask user to review and reply "CONFIRM" to save or "CANCEL" to stop.\n\n${draftSummary(draft)}`,
    });
  }

  await saveAgentState(senderPhone, {
    mode: "collecting_lead",
    draft,
    nextField,
  });
  return polishWhatsappReply({
    referrer,
    userMessage: message,
    toolResult: `Tool result: Saved field "${field}" into draft. Ask this exact next question: ${describeField(nextField)}`,
  });
}

export async function runWhatsappAgentTurn(input: {
  senderPhone: string;
  text: string;
  state: WhatsappAgentState;
}) {
  const referrer = await resolveOrCreateReferrerByWhatsappPhone(input.senderPhone);
  const message = input.text.trim();

  if (!message) {
    return "I received your message, but I could not read text from it yet. Please send a text message.";
  }

  if (input.state.mode.startsWith("selecting_update") || input.state.mode.startsWith("collecting_update") || input.state.mode === "confirming_update" || wantsUpdateLead(message)) {
    return runLeadUpdate(input.senderPhone, referrer, input.state, message);
  }

  if (input.state.mode !== "idle" || wantsAddLead(message)) {
    return runLeadCollection(input.senderPhone, referrer, input.state, message);
  }

  const referrals = await listWhatsappReferrals(referrer.customerId);
  let intent = null;

  try {
    intent = await classifyWhatsappIntent({ referrer, referrals, message });
  } catch {
    intent = null;
  }

  const selectedIntent =
    intent?.intent ||
    (wantsLeadList(message)
      ? "list_leads"
      : wantsLeadDetail(message)
        ? "lead_details"
        : wantsHelp(message)
          ? "help"
          : wantsUpdateLead(message)
            ? "update_lead"
            : "unknown");

  const requestedReferrerPhone = extractPhoneFromMessage(message);

  if (isWhatsappSuperAdminPhone(input.senderPhone) && requestedReferrerPhone && normalizeText(message).includes("lead")) {
    const toolResult = await buildAdminLeadListByReferrerPhoneReply(input.senderPhone, requestedReferrerPhone);
    return polishWhatsappReply({ referrer, userMessage: message, toolResult });
  }

  if (isWhatsappSuperAdminPhone(input.senderPhone) && wantsAdminLeadList(message) && selectedIntent !== "lead_details") {
    const toolResult = await buildAdminLeadListReply(input.senderPhone);
    return polishWhatsappReply({ referrer, userMessage: message, toolResult });
  }

  if (selectedIntent === "add_lead") {
    return runLeadCollection(input.senderPhone, referrer, input.state, message);
  }

  if (selectedIntent === "update_lead") {
    return runLeadUpdate(input.senderPhone, referrer, input.state, message);
  }

  if (selectedIntent === "list_leads") {
    const toolResult = await buildLeadListReply(referrer, input.senderPhone);
    return polishWhatsappReply({ referrer, userMessage: message, toolResult });
  }

  if (selectedIntent === "lead_details") {
    const toolResult = await buildLeadDetailReply(referrer, message);
    return polishWhatsappReply({ referrer, userMessage: message, toolResult });
  }

  if (selectedIntent === "help") {
    return polishWhatsappReply({
      referrer,
      userMessage: message,
      toolResult: [
        "Tool result: Show menu.",
        "Available actions:",
        '- Reply "add lead" to create a referral.',
        '- Reply "my leads" to see referral leads.',
        '- Reply "show lead 1" after listing leads.',
        '- Reply "update lead 1" to edit a lead.',
      ].join("\n"),
    });
  }

  return polishWhatsappReply({
    referrer,
    userMessage: message,
    toolResult: 'Tool result: Unsupported message. Explain that the assistant can help with referral leads. Suggested actions: "add lead", "my leads", "show lead 1", or "update lead 1".',
  });
}

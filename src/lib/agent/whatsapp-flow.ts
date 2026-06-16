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

// IMPORTANT: Every string returned from this module is sent to the user verbatim.
// There is NO LLM "polish" step. Do not put internal labels, tool names, role
// descriptions, or scaffolding ("Tool result:", "Next action:", "Role:", etc.)
// into any returned string. Author replies exactly as the user should read them.

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

const MENU = [
  "I'm the Referral Assistant. I help you manage your referral leads.",
  "",
  '• Reply "add lead" to submit a new referral',
  '• Reply "my leads" to see your leads',
  '• Reply "lead 1" to view a lead\'s details',
  '• Reply "update lead 1" to edit a lead',
].join("\n");

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

function isResetOrFrustration(value: string) {
  const text = normalizeText(value);

  return (
    ["reset", "restart", "start over", "clear", "oi", "oii", "oiii", "oiiii", "hello", "hey", "hai", "hi"].includes(text) ||
    text.includes("you there") ||
    text.includes("fuck") ||
    text.includes("stupid") ||
    text.includes("dead") ||
    text.includes("not working")
  );
}

function isConfirm(value: string) {
  return ["confirm", "yes", "save", "ok", "okay"].includes(normalizeText(value));
}

function wantsAddLead(message: string) {
  const text = normalizeText(message);
  return (
    text.includes("new lead") ||
    text.includes("add lead") ||
    text.includes("create lead") ||
    text.includes("refer someone") ||
    text.includes("lead baru") ||
    text.includes("tambah lead") ||
    text.includes("tambah referral") ||
    text.includes("新增") ||
    text.includes("添加") ||
    text.includes("推荐")
  );
}

function wantsLeadList(message: string) {
  const text = normalizeText(message);
  return (
    text.includes("my leads") ||
    text.includes("my referrals") ||
    text.includes("show all leads") ||
    text === "leads" ||
    text.includes("manage lead") ||
    text.includes("how many lead") ||
    text.includes("how many referral") ||
    (text.includes("only") && text.includes("lead")) ||
    (text.includes("got") && text.includes("lead")) ||
    text.includes("lead saya") ||
    text.includes("referral saya") ||
    text.includes("senarai lead") ||
    text.includes("berapa lead") ||
    text.includes("我的lead") ||
    text.includes("我的 lead") ||
    text.includes("我的推荐") ||
    text.includes("有几个lead") ||
    text.includes("几个lead")
  );
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

function removePhoneFromMessage(message: string) {
  return message
    .replace(/(?:\+?6?0?1[0-9][\s-]?[0-9\s-]{6,}|60[0-9]{8,}|0[0-9]{8,})/g, "")
    .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, "")
    .trim();
}

function wantsPhoneFirstLead(message: string) {
  const text = normalizeText(message);
  const phone = extractPhoneFromMessage(message);
  const wordsWithoutPhone = removePhoneFromMessage(text);

  if (!phone) return false;
  if (!wordsWithoutPhone) return true;

  return (
    text.includes("call") ||
    text.includes("contact") ||
    text.includes("follow up") ||
    text.includes("him") ||
    text.includes("her") ||
    text.includes("customer") ||
    text.includes("client") ||
    text.includes("lead") ||
    text.includes("referral") ||
    text.includes("hubungi") ||
    text.includes("telefon") ||
    text.includes("联系") ||
    text.includes("打给")
  );
}

function wantsLeadDetail(message: string) {
  const text = normalizeText(message);
  return (
    text.includes("show lead") ||
    text.includes("lead detail") ||
    text.includes("status of") ||
    text.includes("open lead") ||
    text.includes("lihat lead") ||
    text.includes("status lead") ||
    text.includes("查看lead") ||
    text.includes("查看 lead") ||
    text.includes("lead详情") ||
    text.includes("lead 详情") ||
    /^lead\s+\d+$/.test(text)
  );
}

function wantsUpdateLead(message: string) {
  const text = normalizeText(message);
  return (
    text.includes("update lead") ||
    text.includes("edit lead") ||
    text.includes("change lead") ||
    text.includes("change the") ||
    text.includes("update the") ||
    text.includes("kemas kini lead") ||
    text.includes("ubah lead") ||
    text.includes("更新lead") ||
    text.includes("更新 lead") ||
    text.includes("修改lead") ||
    text.includes("修改 lead")
  );
}

function wantsHelp(message: string) {
  const text = normalizeText(message);
  return text === "hi" || text === "hello" || text === "help" || text === "menu" || text === "start" || text === "你好" || text === "hai" || text === "halo";
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

function askField(field: WhatsappLeadField) {
  switch (field) {
    case "leadName":
      return "What is the lead's name?";
    case "leadMobileNumber":
      return "What is the lead's mobile number?";
    case "leadState":
      return "Which state is the lead in?";
    case "leadCity":
      return 'Which city is the lead in? Reply "skip" if not needed.';
    case "leadAddress":
      return 'What is the lead\'s address? Reply "skip" if not needed.';
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
      return "name";
    case "leadMobileNumber":
      return "mobile number";
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

const UPDATE_FIELD_LIST = "name, mobile, state, city, address, relationship, project, remark";

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
      return value.length >= 2 ? { ok: true as const, value } : { ok: false as const, error: "The name must be at least 2 characters." };
    case "leadMobileNumber": {
      const canonical = toCanonicalMalaysiaPhone(value);
      return canonical.length >= 8 ? { ok: true as const, value: canonical } : { ok: false as const, error: "That mobile number looks too short." };
    }
    case "leadState":
      return value.length >= 2 ? { ok: true as const, value } : { ok: false as const, error: "Please tell me the state." };
    case "leadCity":
    case "leadAddress":
    case "remark":
      return { ok: true as const, value: isSkip(value) ? "" : value };
    case "relationship": {
      const match = RELATIONSHIP_OPTIONS.find((option) => normalizeText(option) === normalizeText(value));
      return match && isAllowedRelationship(match) ? { ok: true as const, value: match } : { ok: false as const, error: `Please choose one of: ${RELATIONSHIP_OPTIONS.join(", ")}` };
    }
    case "projectType": {
      const match = PROJECT_TYPE_OPTIONS.find((option) => normalizeText(option) === normalizeText(value));
      return match && isAllowedProjectType(match) ? { ok: true as const, value: match } : { ok: false as const, error: `Please choose one of: ${PROJECT_TYPE_OPTIONS.join(", ")}` };
    }
  }
}

function draftSummary(draft: Partial<WhatsappLeadDraft>) {
  return [
    `Name: ${draft.leadName || "-"}`,
    `Mobile: ${draft.leadMobileNumber || "-"}`,
    `State: ${draft.leadState || "-"}`,
    `City: ${draft.leadCity || "-"}`,
    `Address: ${draft.leadAddress || "-"}`,
    `Relationship: ${draft.relationship || "-"}`,
    `Project: ${draft.projectType || "-"}`,
    `Remark: ${draft.remark || "-"}`,
  ].join("\n");
}

function confirmPrompt(draft: Partial<WhatsappLeadDraft>) {
  return [
    "Please review this lead:",
    "",
    draftSummary(draft),
    "",
    "Reply CONFIRM to save, or CANCEL to discard.",
  ].join("\n");
}

async function buildLeadListReply(referrer: WhatsappReferrerAccount, senderPhone: string) {
  const referrals = await listWhatsappReferrals(referrer.customerId);

  await saveAgentState(senderPhone, {
    ...EMPTY_WHATSAPP_AGENT_STATE,
    lastLeadList: referrals.slice(0, 20).map((lead, index) => ({ index: index + 1, referralId: lead.id, leadName: lead.leadName })),
  });

  if (referrals.length === 0) {
    return 'You don\'t have any referral leads yet.\n\nReply "add lead" to submit one.';
  }

  const lines = referrals
    .slice(0, 10)
    .map((lead, index) => `${index + 1}. ${lead.leadName} — ${lead.leadMobile || "no mobile"} — ${lead.status || "Pending"}`);

  return [
    referrals.length === 1 ? "You have 1 referral lead:" : `You have ${referrals.length} referral leads:`,
    "",
    lines.join("\n"),
    "",
    'Reply "lead 1" to view details, or "add lead" to submit another.',
  ].join("\n");
}

async function buildAdminLeadListReply(senderPhone: string) {
  const referrals = await listAllWhatsappReferrals(30);

  await saveAgentState(senderPhone, {
    ...EMPTY_WHATSAPP_AGENT_STATE,
    lastLeadList: referrals.slice(0, 30).map((lead, index) => ({ index: index + 1, referralId: lead.id, leadName: lead.leadName })),
  });

  if (referrals.length === 0) {
    return "There are no submitted referral leads in the system yet.";
  }

  const lines = referrals.slice(0, 15).map((lead, index) => {
    const referrerLabel = [lead.referrerName, lead.referrerPhone].map((value) => value?.trim()).filter(Boolean).join(" / ");
    return `${index + 1}. ${lead.leadName} — ${lead.leadMobile || "no mobile"} — ${lead.status || "Pending"} (by ${referrerLabel || lead.referrerCustomerId})`;
  });

  return [
    `All referral leads (showing ${Math.min(referrals.length, 15)} latest):`,
    "",
    lines.join("\n"),
    "",
    'Reply "lead 1" for details, or "my leads" to see only your own.',
  ].join("\n");
}

async function buildAdminLeadListByReferrerPhoneReply(senderPhone: string, referrerPhone: string) {
  const referrals = await listWhatsappReferralsByReferrerPhone(referrerPhone, 30);

  await saveAgentState(senderPhone, {
    ...EMPTY_WHATSAPP_AGENT_STATE,
    lastLeadList: referrals.slice(0, 30).map((lead, index) => ({ index: index + 1, referralId: lead.id, leadName: lead.leadName })),
  });

  if (referrals.length === 0) {
    return `No referral leads found for referrer ${referrerPhone}.`;
  }

  const referrerLabel = [referrals[0].referrerName, referrals[0].referrerPhone].map((value) => value?.trim()).filter(Boolean).join(" / ");
  const lines = referrals.slice(0, 15).map((lead, index) => `${index + 1}. ${lead.leadName} — ${lead.leadMobile || "no mobile"} — ${lead.status || "Pending"}`);

  return [
    `Leads by ${referrerLabel || referrals[0].referrerCustomerId} (showing ${Math.min(referrals.length, 15)}):`,
    "",
    lines.join("\n"),
    "",
    'Reply "lead 1" for details.',
  ].join("\n");
}

async function buildLeadDetailReply(referrer: WhatsappReferrerAccount, message: string) {
  const adminMode = isWhatsappSuperAdminPhone(referrer.phone);
  const referrals = adminMode ? await listAllWhatsappReferrals(30) : await listWhatsappReferrals(referrer.customerId);
  const text = normalizeText(message);
  const indexMatch = text.match(/\blead\s+(\d+)\b/) || text.match(/^(\d+)$/);
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
    return 'I couldn\'t match that to a lead. Reply "my leads" first, then "lead 1".';
  }

  const location = [selected.leadState, selected.leadCity, selected.leadAddress].map((value) => value?.trim()).filter(Boolean).join(", ");
  const referrerInfo =
    isAdminReferralRow(selected)
      ? [
          `Referrer: ${selected.referrerName || "-"}`,
          `Referrer phone: ${selected.referrerPhone || "-"}`,
        ]
      : [];

  return [
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
    return 'No problem, I cancelled the update. Reply "my leads" or "update lead 1" anytime.';
  }

  const referrals = await listWhatsappReferrals(referrer.customerId);

  if (state.mode === "idle") {
    const selected = selectLeadFromMessage(message, referrals);

    if (!selected) {
      const lines = referrals.slice(0, 10).map((lead, index) => `${index + 1}. ${lead.leadName} — ${lead.leadMobile || "no mobile"} — ${lead.status || "Pending"}`);
      await saveAgentState(senderPhone, {
        ...EMPTY_WHATSAPP_AGENT_STATE,
        mode: "selecting_update_lead",
        lastLeadList: referrals.slice(0, 20).map((lead, index) => ({ index: index + 1, referralId: lead.id, leadName: lead.leadName })),
      });

      if (referrals.length === 0) {
        return 'You don\'t have any leads to update yet.\n\nReply "add lead" to create one.';
      }

      return [
        "Which lead do you want to update?",
        "",
        lines.join("\n"),
        "",
        'Reply with the number, e.g. "1".',
      ].join("\n");
    }

    const field = parseUpdateField(message);
    await saveAgentState(senderPhone, {
      ...EMPTY_WHATSAPP_AGENT_STATE,
      mode: field ? "collecting_update_value" : "selecting_update_field",
      update: { referralId: selected.id, field: field || undefined },
    });

    return field
      ? `Updating "${selected.leadName}". What is the new ${describeUpdateField(field)}?`
      : `Updating "${selected.leadName}". Which field?\nOptions: ${UPDATE_FIELD_LIST}`;
  }

  if (state.mode === "selecting_update_lead") {
    const selected = selectLeadFromMessage(message, referrals);

    if (!selected) {
      return 'I couldn\'t match that lead. Reply with a number from the list, e.g. "1".';
    }

    await saveAgentState(senderPhone, {
      ...EMPTY_WHATSAPP_AGENT_STATE,
      mode: "selecting_update_field",
      update: { referralId: selected.id },
    });

    return `Updating "${selected.leadName}". Which field?\nOptions: ${UPDATE_FIELD_LIST}`;
  }

  if (state.mode === "selecting_update_field") {
    const field = parseUpdateField(message);

    if (!field) {
      return `Please choose a field to update.\nOptions: ${UPDATE_FIELD_LIST}`;
    }

    await saveAgentState(senderPhone, {
      ...state,
      mode: "collecting_update_value",
      update: { ...state.update, field },
    });

    return `What is the new ${describeUpdateField(field)}?`;
  }

  if (state.mode === "collecting_update_value") {
    const field = state.update?.field;

    if (!field || !state.update?.referralId) {
      await saveAgentState(senderPhone, EMPTY_WHATSAPP_AGENT_STATE);
      return 'I lost track of that update. Reply "update lead 1" to start again.';
    }

    const parsed = validateField(field, message);
    if (!parsed.ok) {
      return `${parsed.error}\nWhat is the new ${describeUpdateField(field)}?`;
    }

    await saveAgentState(senderPhone, {
      ...state,
      mode: "confirming_update",
      update: { ...state.update, value: parsed.value },
    });

    return [
      "Please confirm this update:",
      "",
      `Field: ${describeUpdateField(field)}`,
      `New value: ${parsed.value}`,
      "",
      "Reply CONFIRM to save, or CANCEL to stop.",
    ].join("\n");
  }

  if (state.mode === "confirming_update") {
    if (!isConfirm(message)) {
      return 'The update isn\'t saved yet. Reply CONFIRM to save, or CANCEL to stop.';
    }

    if (!state.update?.referralId || !state.update.field || typeof state.update.value !== "string") {
      await saveAgentState(senderPhone, EMPTY_WHATSAPP_AGENT_STATE);
      return 'I lost track of that update. Reply "update lead 1" to start again.';
    }

    const updated = await updateWhatsappReferral(referrer, {
      referralId: state.update.referralId,
      field: state.update.field,
      value: state.update.value,
    });
    await saveAgentState(senderPhone, EMPTY_WHATSAPP_AGENT_STATE);

    return [
      "✅ Lead updated.",
      `Lead: ${updated.leadName}`,
      `${describeUpdateField(state.update.field)}: ${state.update.value}`,
    ].join("\n");
  }

  return MENU;
}

async function runLeadCollection(senderPhone: string, referrer: WhatsappReferrerAccount, state: WhatsappAgentState, message: string) {
  if (isCancel(message)) {
    await saveAgentState(senderPhone, EMPTY_WHATSAPP_AGENT_STATE);
    return 'No problem, I cancelled the new lead. Reply "add lead" when you want to start again.';
  }

  if (state.mode !== "idle" && isResetOrFrustration(message)) {
    await saveAgentState(senderPhone, EMPTY_WHATSAPP_AGENT_STATE);
    return `I cleared the unfinished lead and I'm ready again.\n\n${MENU}`;
  }

  if (state.mode === "idle") {
    await saveAgentState(senderPhone, {
      mode: "collecting_lead",
      draft: {},
      nextField: "leadName",
    });
    return `Sure, let's add a referral.\n${askField("leadName")}`;
  }

  if (state.mode === "confirming_lead") {
    if (!isConfirm(message)) {
      return confirmPrompt(state.draft);
    }

    const referralId = await createWhatsappReferral(referrer, state.draft as WhatsappLeadDraft);
    await saveAgentState(senderPhone, EMPTY_WHATSAPP_AGENT_STATE);

    return [
      "✅ Lead saved!",
      `Reference ID: ${referralId}`,
      `Name: ${state.draft.leadName}`,
      `Mobile: ${state.draft.leadMobileNumber}`,
      "",
      'Reply "my leads" to see all your leads.',
    ].join("\n");
  }

  const field = state.nextField || getNextField(state.draft);
  if (!field) {
    await saveAgentState(senderPhone, {
      mode: "confirming_lead",
      draft: state.draft,
      nextField: null,
    });
    return confirmPrompt(state.draft);
  }

  const parsed = validateField(field, message);
  if (!parsed.ok) {
    return `${parsed.error}\n${askField(field)}`;
  }

  const draft = {
    ...state.draft,
    [field]: parsed.value,
  };
  const nextField = getNextField(draft);

  if (!nextField) {
    await saveAgentState(senderPhone, {
      mode: "confirming_lead",
      draft,
      nextField: null,
    });
    return confirmPrompt(draft);
  }

  await saveAgentState(senderPhone, {
    mode: "collecting_lead",
    draft,
    nextField,
  });
  return askField(nextField);
}

async function startPhoneFirstLeadCollection(senderPhone: string, referrer: WhatsappReferrerAccount, message: string) {
  const leadMobileNumber = toCanonicalMalaysiaPhone(extractPhoneFromMessage(message));
  const remark = removePhoneFromMessage(message);
  const draft: Partial<WhatsappLeadDraft> = {
    leadMobileNumber,
    remark,
  };

  await saveAgentState(senderPhone, {
    mode: "collecting_lead",
    draft,
    nextField: "leadName",
  });

  return [
    "Sure, I can add this referral.",
    `Mobile: ${leadMobileNumber}`,
    remark ? `Remark: ${remark}` : "",
    "",
    askField("leadName"),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export async function runWhatsappAgentTurn(input: {
  senderPhone: string;
  text: string;
  state: WhatsappAgentState;
}) {
  const referrer = await resolveOrCreateReferrerByWhatsappPhone(input.senderPhone);
  const message = input.text.trim();

  if (!message) {
    return "I received your message, but I couldn't read any text in it. Please send a text message.";
  }

  // Continue an in-progress update flow, or start one on request.
  if (
    input.state.mode.startsWith("selecting_update") ||
    input.state.mode.startsWith("collecting_update") ||
    input.state.mode === "confirming_update" ||
    (input.state.mode === "idle" && wantsUpdateLead(message))
  ) {
    return runLeadUpdate(input.senderPhone, referrer, input.state, message);
  }

  // Phone-first quick add ("call 0123456789 mr tan").
  if (input.state.mode === "idle" && wantsPhoneFirstLead(message)) {
    return startPhoneFirstLeadCollection(input.senderPhone, referrer, message);
  }

  // Continue an in-progress lead collection, or start one on request.
  if (input.state.mode !== "idle" || wantsAddLead(message)) {
    return runLeadCollection(input.senderPhone, referrer, input.state, message);
  }

  // From here on the state is idle. Route by keyword only.
  const isAdmin = isWhatsappSuperAdminPhone(input.senderPhone);
  const requestedReferrerPhone = extractPhoneFromMessage(message);

  if (isAdmin && requestedReferrerPhone && normalizeText(message).includes("lead")) {
    return buildAdminLeadListByReferrerPhoneReply(input.senderPhone, requestedReferrerPhone);
  }

  if (isAdmin && wantsAdminLeadList(message) && !wantsLeadDetail(message)) {
    return buildAdminLeadListReply(input.senderPhone);
  }

  if (wantsLeadDetail(message)) {
    return buildLeadDetailReply(referrer, message);
  }

  if (wantsLeadList(message)) {
    return buildLeadListReply(referrer, input.senderPhone);
  }

  if (wantsHelp(message)) {
    return MENU;
  }

  // Anything unrecognized: show the menu so the user always knows what to do.
  return MENU;
}

import { toCanonicalMalaysiaPhone } from "@/lib/phone-normalization";
import {
  createReferrerOnBehalf,
  createWhatsappReferral,
  EMPTY_WHATSAPP_AGENT_STATE,
  loadAgentState,
  notifyPreferredAgentOfLead,
  saveAgentState,
  saveReferrerProfile,
  searchReferrerByPhone,
  searchReferrersByPhonePartial,
  updateWhatsappReferral,
  listWhatsappReferrals,
  type WhatsappAgentOption,
  type WhatsappAgentState,
  type WhatsappLeadDraft,
  type WhatsappReferrerAccount,
  type WhatsappUpdateField,
} from "@/lib/agent/whatsapp-data";
import {
  extractAssignmentText,
  isAdminModeExit,
  isAdminModeTrigger,
  isCancelMessage,
  isCreateReferrerCommand,
  isSearchMyReferralsCommand,
  isSearchReferrerCommand,
  isSkipMessage,
  matchAgentName,
  parseAdminLeadCandidate,
  parseAdminReferrerQuery,
  parseAdminReferrerSelection,
  parseExplicitLeadUpdate,
  parseLeadCandidate,
} from "@/lib/agent/whatsapp-intent";
import type { ReferralRow } from "@/lib/referrals";

export type WhatsappWorkflowTrace = {
  name: string;
  input: Record<string, unknown>;
  status: string;
  agentNotified?: unknown;
};

export type WhatsappWorkflowResult = {
  handled: boolean;
  reply: string;
  toolTrace: WhatsappWorkflowTrace[];
  referrer: WhatsappReferrerAccount;
  leads: ReferralRow[];
};

type WorkflowInput = {
  senderPhone: string;
  message: string;
  referrer: WhatsappReferrerAccount;
  leads: ReferralRow[];
  agents: WhatsappAgentOption[];
};

const STATE_TTL_MS = 60 * 60 * 1000;

function freshState(state: WhatsappAgentState) {
  if (!state.updatedAt) return state;
  const age = Date.now() - Date.parse(state.updatedAt);
  return Number.isFinite(age) && age <= STATE_TTL_MS ? state : EMPTY_WHATSAPP_AGENT_STATE;
}

async function persistState(senderPhone: string, state: WhatsappAgentState) {
  await saveAgentState(senderPhone, { ...state, updatedAt: new Date().toISOString() });
}

async function clearState(senderPhone: string) {
  await persistState(senderPhone, { ...EMPTY_WHATSAPP_AGENT_STATE });
}

function areaLabel(lead: ReferralRow) {
  return [lead.leadState, lead.leadCity].map((value) => value?.trim()).filter(Boolean).join(", ");
}

function displayLeadName(name: string) {
  return name.trim() || "the lead";
}

function findDuplicate(leads: ReferralRow[], mobile: string) {
  const canonical = toCanonicalMalaysiaPhone(mobile);
  return leads.find((lead) => toCanonicalMalaysiaPhone(lead.leadMobile) === canonical);
}

function resolveAgent(
  rawText: string,
  agents: WhatsappAgentOption[],
): { ok: true; agent: WhatsappAgentOption } | { ok: false; message: string } {
  const result = matchAgentName(rawText, agents);
  if (result.status === "missing") {
    return { ok: false, message: "Please send the preferred agent's name, or reply skip." };
  }
  if (result.status === "none") {
    return { ok: false, message: `I couldn't match "${rawText.trim()}" to a sales agent. Please send the full agent name, or reply skip.` };
  }
  if (result.status === "ambiguous") {
    return { ok: false, message: `That matches more than one agent. Please send the full agent name, or reply skip.` };
  }
  return { ok: true, agent: result.matches[0] };
}

async function notifyAgent(
  agent: WhatsappAgentOption,
  lead: { leadName: string; leadMobile: string; area: string },
  referrer: WhatsappReferrerAccount,
) {
  try {
    return await notifyPreferredAgentOfLead({
      agentId: agent.id,
      agentName: agent.name,
      leadName: lead.leadName,
      leadMobile: lead.leadMobile,
      area: lead.area,
      referrerName: referrer.name,
      referrerPhone: referrer.phone,
    });
  } catch (error) {
    return {
      sent: false,
      agentPhone: "",
      reason: error instanceof Error ? error.message : "notification failed",
    };
  }
}

function assignmentReply(agentName: string, notified: { sent: boolean }) {
  return notified.sent
    ? `Done — assigned to ${agentName}. I've notified them to follow up.`
    : `Done — assigned to ${agentName}. I couldn't notify them because no working WhatsApp number is on file.`;
}

async function assignAgent(
  input: WorkflowInput,
  referralId: number,
  lead: { leadName: string; leadMobile: string; area: string },
  agentText: string,
): Promise<WhatsappWorkflowResult> {
  const resolved = resolveAgent(agentText, input.agents);
  if (!resolved.ok) {
    return { handled: true, reply: resolved.message, toolTrace: [], referrer: input.referrer, leads: input.leads };
  }

  await updateWhatsappReferral(input.referrer, {
    referralId,
    field: "preferredAgent",
    value: resolved.agent.id,
  });
  const notified = await notifyAgent(resolved.agent, lead, input.referrer);
  await clearState(input.senderPhone);

  return {
    handled: true,
    reply: assignmentReply(resolved.agent.name, notified),
    toolTrace: [
      {
        name: "assign_preferred_agent",
        input: { referralId, agent: resolved.agent.name },
        status: "saved",
        agentNotified: notified,
      },
    ],
    referrer: input.referrer,
    leads: input.leads,
  };
}

async function createLead(
  input: WorkflowInput,
  draft: WhatsappLeadDraft,
  preferredAgentText: string,
): Promise<WhatsappWorkflowResult> {
  const mobile = toCanonicalMalaysiaPhone(draft.leadMobileNumber);
  if (mobile.length < 8) {
    return {
      handled: true,
      reply: "I couldn't recognize a valid contact number. Please send the lead's phone number in text.",
      toolTrace: [],
      referrer: input.referrer,
      leads: input.leads,
    };
  }

  const duplicate = findDuplicate(input.leads, mobile);
  if (duplicate) {
    if (preferredAgentText) {
      return assignAgent(
        input,
        duplicate.id,
        {
          leadName: duplicate.leadName,
          leadMobile: duplicate.leadMobile || mobile,
          area: areaLabel(duplicate),
        },
        preferredAgentText,
      );
    }
    await persistState(input.senderPhone, {
      ...EMPTY_WHATSAPP_AGENT_STATE,
      mode: "awaiting_preferred_agent",
      activeLead: {
        referralId: duplicate.id,
        leadName: duplicate.leadName,
        leadMobile: duplicate.leadMobile || mobile,
        area: areaLabel(duplicate),
      },
    });
    return {
      handled: true,
      reply: `${displayLeadName(duplicate.leadName)} (${mobile}) is already in your referral list. Do you want to assign a preferred agent? Reply with the agent's name, or skip.`,
      toolTrace: [],
      referrer: input.referrer,
      leads: input.leads,
    };
  }

  let preferredAgent: WhatsappAgentOption | null = null;
  if (preferredAgentText) {
    const resolved = resolveAgent(preferredAgentText, input.agents);
    if (!resolved.ok) {
      return { handled: true, reply: resolved.message, toolTrace: [], referrer: input.referrer, leads: input.leads };
    }
    preferredAgent = resolved.agent;
  }

  const referralId = await createWhatsappReferral(
    input.referrer,
    { ...draft, leadMobileNumber: mobile },
    { preferredAgentId: preferredAgent?.id || null },
  );
  const trace: WhatsappWorkflowTrace[] = [
    {
      name: "add_lead",
      input: {
        mobile,
        name: draft.leadName,
        area: draft.area,
        preferredAgent: preferredAgent?.name || "",
      },
      status: "saved",
    },
  ];

  if (preferredAgent) {
    const notified = await notifyAgent(
      preferredAgent,
      { leadName: draft.leadName, leadMobile: mobile, area: draft.area },
      input.referrer,
    );
    trace[0].agentNotified = notified;
    await clearState(input.senderPhone);
    return {
      handled: true,
      reply: `${displayLeadName(draft.leadName)} (${mobile}) has been added. ${assignmentReply(preferredAgent.name, notified)}`,
      toolTrace: trace,
      referrer: input.referrer,
      leads: input.leads,
    };
  }

  if (input.agents.length > 0) {
    await persistState(input.senderPhone, {
      ...EMPTY_WHATSAPP_AGENT_STATE,
      mode: "awaiting_preferred_agent",
      activeLead: { referralId, leadName: draft.leadName, leadMobile: mobile, area: draft.area },
    });
    return {
      handled: true,
      reply: `${displayLeadName(draft.leadName)} (${mobile}) has been added. Do you have a preferred agent to handle this lead? Reply with the agent's name, or skip.`,
      toolTrace: trace,
      referrer: input.referrer,
      leads: input.leads,
    };
  }

  await clearState(input.senderPhone);
  return {
    handled: true,
    reply: `${displayLeadName(draft.leadName)} (${mobile}) has been added.`,
    toolTrace: trace,
    referrer: input.referrer,
    leads: input.leads,
  };
}

async function handleOnboarding(
  input: WorkflowInput,
  state: WhatsappAgentState,
  candidate: ReturnType<typeof parseLeadCandidate>,
): Promise<WhatsappWorkflowResult> {
  if (state.mode === "onboarding_name") {
    const name = input.message.trim();
    if (name.length < 2) {
      return { handled: true, reply: "Please send your full name.", toolTrace: [], referrer: input.referrer, leads: input.leads };
    }
    await persistState(input.senderPhone, {
      ...state,
      mode: "onboarding_bank",
      onboarding: { name },
    });
    return {
      handled: true,
      reply: "Thanks. Now send your bank name and account number for referral-fee payouts.",
      toolTrace: [],
      referrer: input.referrer,
      leads: input.leads,
    };
  }

  if (state.mode === "onboarding_bank") {
    const bankAccount = input.message.trim();
    if (bankAccount.length < 6 || !/\d{4,}/.test(bankAccount)) {
      return {
        handled: true,
        reply: "Please send both the bank name and account number, for example: Maybank 1234567890.",
        toolTrace: [],
        referrer: input.referrer,
        leads: input.leads,
      };
    }
    const name = state.onboarding?.name?.trim() || "";
    if (!name) {
      await persistState(input.senderPhone, { ...state, mode: "onboarding_name" });
      return { handled: true, reply: "Please send your full name first.", toolTrace: [], referrer: input.referrer, leads: input.leads };
    }

    const referrer = await saveReferrerProfile(input.referrer, { name, bankAccount });
    const nextInput = { ...input, referrer };
    const profileTrace: WhatsappWorkflowTrace = {
      name: "save_referrer_profile",
      input: { name, bankAccount: "[redacted]" },
      status: "saved",
    };
    if (state.draft.leadMobileNumber) {
      const created = await createLead(
        nextInput,
        {
          leadName: state.draft.leadName || "",
          leadMobileNumber: state.draft.leadMobileNumber,
          area: state.draft.area || "",
        },
        "",
      );
      return {
        ...created,
        reply: `Your referral account is ready. ${created.reply}`,
        toolTrace: [profileTrace, ...created.toolTrace],
        referrer,
      };
    }
    await clearState(input.senderPhone);
    return {
      handled: true,
      reply: "Your referral account is ready. You can now send a lead's phone number, contact card, or screenshot.",
      toolTrace: [profileTrace],
      referrer,
      leads: input.leads,
    };
  }

  const draft = candidate
    ? {
        leadName: candidate.leadName,
        leadMobileNumber: candidate.leadMobileNumber,
        area: candidate.area,
      }
    : {};
  await persistState(input.senderPhone, {
    ...EMPTY_WHATSAPP_AGENT_STATE,
    mode: "onboarding_name",
    draft,
  });
  return {
    handled: true,
    reply:
      "Before you can submit referrals, I need to set up your referral account for payouts. First, what is your full name?",
    toolTrace: [],
    referrer: input.referrer,
    leads: input.leads,
  };
}

function adminReply(message: string) {
  return `[ADMIN MODE]\n${message}`;
}

function isAdminAuthorized(phone: string) {
  void phone;
  return true;
}

async function handleAdminModeEntry(input: WorkflowInput, state: WhatsappAgentState): Promise<WhatsappWorkflowResult> {
  void state;
  await persistState(input.senderPhone, {
    ...EMPTY_WHATSAPP_AGENT_STATE,
    mode: "admin_idle",
    adminContext: { adminPhone: input.senderPhone }
  });
  return {
    handled: true,
    reply: adminReply("Admin mode activated. You can 'search referrer <phone>', 'create <name>', or add leads. Reply 'exit' to leave."),
    toolTrace: [{ name: "admin_mode_entry", status: "success", input: { phone: input.senderPhone } }],
    referrer: input.referrer,
    leads: input.leads,
  };
}

async function handleAdminModeExit(input: WorkflowInput, state: WhatsappAgentState): Promise<WhatsappWorkflowResult> {
  void state;
  await clearState(input.senderPhone);
  return {
    handled: true,
    reply: adminReply("Exited admin mode."),
    toolTrace: [{ name: "admin_mode_exit", status: "success", input: { phone: input.senderPhone } }],
    referrer: input.referrer,
    leads: input.leads,
  };
}

async function handleAdminSearchReferrer(input: WorkflowInput, state: WhatsappAgentState): Promise<WhatsappWorkflowResult> {
  const query = parseAdminReferrerQuery(input.message);
  if (!query) {
    return { handled: true, reply: adminReply("Please provide a valid phone number."), toolTrace: [{ name: "admin_search_referrer", status: "failed", input: { error: "invalid_phone", text: input.message } }], referrer: input.referrer, leads: input.leads };
  }
  const results = await searchReferrersByPhonePartial(query.phone);
  if (results.length === 0) {
    return { handled: true, reply: adminReply(`No referrers found matching ${query.phone}.`), toolTrace: [{ name: "admin_search_referrer", status: "failed", input: { error: "not_found", phone: query.phone } }], referrer: input.referrer, leads: input.leads };
  }
  if (results.length === 1) {
    const target = await searchReferrerByPhone(results[0].phone || "");
    await persistState(input.senderPhone, {
      ...state,
      mode: "admin_idle",
      adminContext: { ...state.adminContext!, targetReferrer: target }
    });
    return { handled: true, reply: adminReply(`Selected referrer: ${target?.name} (${target?.phone}).`), toolTrace: [{ name: "admin_search_referrer", status: "success", input: { match: "single", phone: target?.phone } }], referrer: input.referrer, leads: input.leads };
  }
  
  await persistState(input.senderPhone, {
    ...state,
    mode: "admin_selecting_referrer",
    adminContext: { ...state.adminContext!, targetReferrerSearchResults: results }
  });
  const lines = results.map((r, i) => `${i + 1}. ${r.name || "Unknown"} (${r.phone || "No phone"})`);
  return { handled: true, reply: adminReply(`Found ${results.length} referrers:\n${lines.join("\n")}\nReply with a number to select.`), toolTrace: [{ name: "admin_search_referrer", status: "success", input: { match: "multiple", count: results.length } }], referrer: input.referrer, leads: input.leads };
}

async function handleAdminSelectReferrer(input: WorkflowInput, state: WhatsappAgentState): Promise<WhatsappWorkflowResult> {
  const index = parseAdminReferrerSelection(input.message);
  const results = state.adminContext?.targetReferrerSearchResults || [];
  if (index === null || index < 1 || index > results.length) {
    return { handled: true, reply: adminReply("Invalid selection. Please reply with a valid number from the list."), toolTrace: [{ name: "admin_select_referrer", status: "failed", input: { error: "invalid_selection" } }], referrer: input.referrer, leads: input.leads };
  }
  const selected = results[index - 1];
  const target = await searchReferrerByPhone(selected.phone || "");
  await persistState(input.senderPhone, {
    ...state,
    mode: "admin_idle",
    adminContext: { adminPhone: input.senderPhone, targetReferrer: target }
  });
  return { handled: true, reply: adminReply(`Selected referrer: ${target?.name} (${target?.phone}).`), toolTrace: [{ name: "admin_select_referrer", status: "success", input: { phone: target?.phone } }], referrer: input.referrer, leads: input.leads };
}

async function handleAdminCreateReferrer(input: WorkflowInput, state: WhatsappAgentState): Promise<WhatsappWorkflowResult> {
  if (state.mode === "admin_creating_referrer_name") {
    const name = input.message.trim();
    if (!name) return { handled: true, reply: adminReply("Please provide a valid name."), toolTrace: [{ name: "admin_create_referrer", status: "failed", input: { step: "name", error: "empty" } }], referrer: input.referrer, leads: input.leads };
    await persistState(input.senderPhone, {
      ...state,
      mode: "admin_creating_referrer_phone",
      adminContext: { ...state.adminContext!, newReferrerName: name }
    });
    return { handled: true, reply: adminReply(`Name set to "${name}". What is their phone number?`), toolTrace: [{ name: "admin_create_referrer", status: "success", input: { step: "name", name } }], referrer: input.referrer, leads: input.leads };
  }
  if (state.mode === "admin_creating_referrer_phone") {
    const query = parseAdminReferrerQuery(input.message);
    if (!query) {
      return { handled: true, reply: adminReply("Please provide a valid phone number (digits only)."), toolTrace: [{ name: "admin_create_referrer", status: "failed", input: { step: "phone", error: "invalid", text: input.message } }], referrer: input.referrer, leads: input.leads };
    }
    const phone = query.phone;
    const name = state.adminContext?.newReferrerName || "Unknown";
    const newReferrer = await createReferrerOnBehalf({ name, phone, createdBy: input.senderPhone });
    await persistState(input.senderPhone, {
      ...state,
      mode: "admin_idle",
      adminContext: { adminPhone: input.senderPhone, targetReferrer: newReferrer }
    });
    return { handled: true, reply: adminReply(`Referrer created: ${newReferrer.name} (${newReferrer.phone}). They are now the active target.`), toolTrace: [{ name: "admin_create_referrer", status: "success", input: { step: "phone", phone } }], referrer: input.referrer, leads: input.leads };
  }
  return { handled: true, reply: adminReply("Invalid state for create."), toolTrace: [], referrer: input.referrer, leads: input.leads };
}

async function handleAdminAddLead(
  input: WorkflowInput,
  state: WhatsappAgentState,
  draft: { leadName: string; leadMobileNumber: string; area: string; preferredAgentText?: string },
  targetReferrer: WhatsappReferrerAccount
): Promise<WhatsappWorkflowResult> {
  const mobile = toCanonicalMalaysiaPhone(draft.leadMobileNumber);
  if (mobile.length < 8) {
    return { handled: true, reply: adminReply("I couldn't recognize a valid contact number. Please send the lead's phone number in text."), toolTrace: [{ name: "admin_add_lead", status: "failed", input: { error: "invalid_phone" } }], referrer: input.referrer, leads: input.leads };
  }

  const targetLeads = await listWhatsappReferrals(targetReferrer.customerId);
  const duplicate = findDuplicate(targetLeads, mobile);

  if (duplicate) {
    if (draft.preferredAgentText) {
      const result = await assignAgent(
        { ...input, referrer: targetReferrer, leads: targetLeads },
        duplicate.id,
        { leadName: duplicate.leadName, leadMobile: duplicate.leadMobile || mobile, area: areaLabel(duplicate) },
        draft.preferredAgentText
      );
      await persistState(input.senderPhone, { ...state, mode: "admin_idle" });
      return { ...result, reply: adminReply(result.reply) };
    }
    
    await persistState(input.senderPhone, {
      ...state,
      mode: "admin_awaiting_preferred_agent",
      activeLead: { referralId: duplicate.id, leadName: duplicate.leadName, leadMobile: duplicate.leadMobile || mobile, area: areaLabel(duplicate) }
    });
    return { handled: true, reply: adminReply(`${displayLeadName(duplicate.leadName)} (${mobile}) is already in their list. Do you want to assign a preferred agent? Reply with the agent's name, or skip.`), toolTrace: [{ name: "admin_add_lead", status: "duplicate_agent_prompt", input: { mobile } }], referrer: input.referrer, leads: input.leads };
  }

  let preferredAgent: WhatsappAgentOption | null = null;
  if (draft.preferredAgentText) {
    const resolved = resolveAgent(draft.preferredAgentText, input.agents);
    if (!resolved.ok) {
      return { handled: true, reply: adminReply(resolved.message), toolTrace: [{ name: "admin_add_lead", status: "failed", input: { error: "agent_not_found" } }], referrer: input.referrer, leads: input.leads };
    }
    preferredAgent = resolved.agent;
  }

  const referralId = await createWhatsappReferral(
    targetReferrer,
    { ...draft, leadMobileNumber: mobile },
    { preferredAgentId: preferredAgent?.id || null },
  );
  const trace: WhatsappWorkflowTrace[] = [{ name: "admin_add_lead", input: { mobile, name: draft.leadName, area: draft.area, preferredAgent: preferredAgent?.name || "" }, status: "saved" }];

  if (preferredAgent) {
    const notified = await notifyAgent(preferredAgent, { leadName: draft.leadName, leadMobile: mobile, area: draft.area }, targetReferrer);
    trace[0].agentNotified = notified;
    await persistState(input.senderPhone, { ...state, mode: "admin_idle" });
    return { handled: true, reply: adminReply(`${displayLeadName(draft.leadName)} (${mobile}) has been added for ${targetReferrer.name}. ${assignmentReply(preferredAgent.name, notified)}`), toolTrace: trace, referrer: input.referrer, leads: input.leads };
  }

  if (input.agents.length > 0) {
    await persistState(input.senderPhone, {
      ...state,
      mode: "admin_awaiting_preferred_agent",
      activeLead: { referralId, leadName: draft.leadName, leadMobile: mobile, area: draft.area }
    });
    return { handled: true, reply: adminReply(`${displayLeadName(draft.leadName)} (${mobile}) has been added for ${targetReferrer.name}. Do you have a preferred agent to handle this lead? Reply with the agent's name, or skip.`), toolTrace: trace, referrer: input.referrer, leads: input.leads };
  }

  await persistState(input.senderPhone, { ...state, mode: "admin_idle" });
  return { handled: true, reply: adminReply(`${displayLeadName(draft.leadName)} (${mobile}) has been added for ${targetReferrer.name}.`), toolTrace: trace, referrer: input.referrer, leads: input.leads };
}

async function handleAdminAwaitingPreferredAgent(input: WorkflowInput, state: WhatsappAgentState): Promise<WhatsappWorkflowResult> {
  const targetReferrer = state.adminContext?.targetReferrer;
  if (!targetReferrer || !state.activeLead) {
    await persistState(input.senderPhone, { ...state, mode: "admin_idle" });
    return { handled: true, reply: adminReply("Lost lead context. Returning to admin idle."), toolTrace: [], referrer: input.referrer, leads: input.leads };
  }

  if (isSkipMessage(input.message)) {
    await persistState(input.senderPhone, { ...state, mode: "admin_idle" });
    return { handled: true, reply: adminReply("No problem — I'll leave the lead unassigned."), toolTrace: [], referrer: input.referrer, leads: input.leads };
  }

  const targetLeads = await listWhatsappReferrals(targetReferrer.customerId);
  const result = await assignAgent(
    { ...input, referrer: targetReferrer, leads: targetLeads },
    state.activeLead.referralId,
    { leadName: state.activeLead.leadName, leadMobile: state.activeLead.leadMobile, area: state.activeLead.area },
    input.message
  );
  
  await persistState(input.senderPhone, { ...state, mode: "admin_idle" });
  return { ...result, reply: adminReply(result.reply) };
}

async function handleAdminIdleCommand(input: WorkflowInput, state: WhatsappAgentState): Promise<WhatsappWorkflowResult> {
  const text = input.message;

  if (isSearchReferrerCommand(text)) {
    return handleAdminSearchReferrer(input, state);
  }

  if (isSearchMyReferralsCommand(text)) {
    const target = state.adminContext?.targetReferrer;
    if (!target) {
      return { handled: true, reply: adminReply("No referrer selected. Please search or create one first."), toolTrace: [{ name: "admin_my_leads", status: "failed", input: { error: "no_referrer_selected" } }], referrer: input.referrer, leads: input.leads };
    }
    const targetLeads = await listWhatsappReferrals(target.customerId);
    const leadsList = targetLeads.length > 0
      ? targetLeads.map((l, i) => `${i + 1}. ${l.leadName || "no name"} (${l.leadMobile || "no phone"}) - ${l.status || "Pending"}`).join("\n")
      : "No leads found.";
    return { handled: true, reply: adminReply(`Leads for ${target.name}:\n\n${leadsList}`), toolTrace: [{ name: "admin_my_leads", status: "success", input: { referrer: target.name, count: targetLeads.length } }], referrer: input.referrer, leads: input.leads };
  }

  if (isCreateReferrerCommand(text)) {
    const nameMatch = text.match(/^(?:create|new|add)\s+(.+)/i);
    const nameText = nameMatch ? nameMatch[1].trim() : "";
    if (nameText) {
      await persistState(input.senderPhone, {
        ...state,
        mode: "admin_creating_referrer_phone",
        adminContext: { ...state.adminContext!, newReferrerName: nameText }
      });
      return { handled: true, reply: adminReply(`Creating referrer "${nameText}". Please provide their phone number.`), toolTrace: [{ name: "admin_create_referrer", status: "started", input: { name: nameText } }], referrer: input.referrer, leads: input.leads };
    }
    await persistState(input.senderPhone, {
      ...state,
      mode: "admin_creating_referrer_name"
    });
    return { handled: true, reply: adminReply("Please provide the new referrer's name."), toolTrace: [{ name: "admin_create_referrer", status: "started", input: {} }], referrer: input.referrer, leads: input.leads };
  }

  const candidate = parseAdminLeadCandidate(text);
  if (candidate) {
    if (candidate.referrerPhone) {
      const target = await searchReferrerByPhone(candidate.referrerPhone);
      if (!target) {
         return { handled: true, reply: adminReply(`Could not find a referrer matching ${candidate.referrerPhone}.`), toolTrace: [{ name: "admin_add_lead", status: "failed", input: { error: "referrer_not_found", phone: candidate.referrerPhone } }], referrer: input.referrer, leads: input.leads };
      }
      return handleAdminAddLead(input, state, candidate, target);
    } else if (state.adminContext?.targetReferrer) {
      return handleAdminAddLead(input, state, candidate, state.adminContext.targetReferrer);
    } else {
      return { handled: true, reply: adminReply("No referrer selected. Please search or create one first, or include 'for <phone>' in your message."), toolTrace: [{ name: "admin_add_lead", status: "failed", input: { error: "no_referrer_selected" } }], referrer: input.referrer, leads: input.leads };
    }
  }

  return { handled: true, reply: adminReply("Unrecognized admin command. You can 'search referrer <phone>', 'create <name>', 'my leads', or 'exit'."), toolTrace: [{ name: "admin_unknown_command", status: "failed", input: { text } }], referrer: input.referrer, leads: input.leads };
}

export async function tryRunWhatsappWorkflow(input: WorkflowInput): Promise<WhatsappWorkflowResult> {
  const storedState = freshState(await loadAgentState(input.senderPhone));
  const candidate = parseLeadCandidate(input.message);

  if (isAdminAuthorized(input.senderPhone)) {
    if (isAdminModeExit(input.message) && (storedState.mode.startsWith("admin_") || isAdminModeTrigger(input.message))) {
      return handleAdminModeExit(input, storedState);
    }
    if (isAdminModeTrigger(input.message) && !storedState.mode.startsWith("admin_")) {
      return handleAdminModeEntry(input, storedState);
    }
    if (storedState.mode.startsWith("admin_")) {
      if (storedState.mode === "admin_idle") {
        return handleAdminIdleCommand(input, storedState);
      }
      if (storedState.mode === "admin_creating_referrer_name" || storedState.mode === "admin_creating_referrer_phone") {
        return handleAdminCreateReferrer(input, storedState);
      }
      if (storedState.mode === "admin_selecting_referrer") {
        return handleAdminSelectReferrer(input, storedState);
      }
      if (storedState.mode === "admin_awaiting_preferred_agent") {
        return handleAdminAwaitingPreferredAgent(input, storedState);
      }
      return { handled: true, reply: adminReply("Invalid admin state."), toolTrace: [], referrer: input.referrer, leads: input.leads };
    }
  }

  if (isCancelMessage(input.message)) {
    await clearState(input.senderPhone);
    return {
      handled: true,
      reply: "Okay, cancelled. Nothing was changed.",
      toolTrace: [],
      referrer: input.referrer,
      leads: input.leads,
    };
  }

  if (!input.referrer.registered) {
    return handleOnboarding(input, storedState, candidate);
  }

  // A fresh lead always wins over stale follow-up state.
  if (candidate) {
    return createLead(
      input,
      {
        leadName: candidate.leadName,
        leadMobileNumber: candidate.leadMobileNumber,
        area: candidate.area,
      },
      candidate.preferredAgentText,
    );
  }

  if (storedState.mode === "awaiting_preferred_agent" && storedState.activeLead) {
    if (isSkipMessage(input.message)) {
      await clearState(input.senderPhone);
      return {
        handled: true,
        reply: "No problem — I'll leave the lead unassigned.",
        toolTrace: [],
        referrer: input.referrer,
        leads: input.leads,
      };
    }
    return assignAgent(
      input,
      storedState.activeLead.referralId,
      {
        leadName: storedState.activeLead.leadName,
        leadMobile: storedState.activeLead.leadMobile,
        area: storedState.activeLead.area,
      },
      input.message,
    );
  }

  const update = parseExplicitLeadUpdate(input.message);
  if (update) {
    const lead = input.leads[update.leadNumber - 1];
    if (!lead) {
      return {
        handled: true,
        reply: `I can't find lead ${update.leadNumber}. Ask for "my leads" to see the current list.`,
        toolTrace: [],
        referrer: input.referrer,
        leads: input.leads,
      };
    }
    if (update.field === "agent") {
      return assignAgent(
        input,
        lead.id,
        { leadName: lead.leadName, leadMobile: lead.leadMobile || "", area: areaLabel(lead) },
        update.value,
      );
    }
    const fieldMap: Record<"name" | "phone" | "mobile" | "area", WhatsappUpdateField> = {
      name: "leadName",
      phone: "leadMobileNumber",
      mobile: "leadMobileNumber",
      area: "area",
    };
    const value = update.field === "phone" || update.field === "mobile"
      ? toCanonicalMalaysiaPhone(update.value)
      : update.value;
    await updateWhatsappReferral(input.referrer, {
      referralId: lead.id,
      field: fieldMap[update.field],
      value,
    });
    await clearState(input.senderPhone);
    return {
      handled: true,
      reply: `Lead ${update.leadNumber} has been updated.`,
      toolTrace: [
        {
          name: "update_lead",
          input: { referralId: lead.id, field: update.field, value },
          status: "saved",
        },
      ],
      referrer: input.referrer,
      leads: input.leads,
    };
  }

  const assignmentText = extractAssignmentText(input.message);
  if (assignmentText && input.leads[0]) {
    const lead = input.leads[0];
    return assignAgent(
      input,
      lead.id,
      { leadName: lead.leadName, leadMobile: lead.leadMobile || "", area: areaLabel(lead) },
      assignmentText,
    );
  }

  return {
    handled: false,
    reply: "",
    toolTrace: [],
    referrer: input.referrer,
    leads: input.leads,
  };
}

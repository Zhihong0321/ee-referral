import { PROJECT_TYPE_OPTIONS, RELATIONSHIP_OPTIONS, type ReferralRow } from "@/lib/referrals";

import { createSandboxReferral } from "@/lib/agent/sandbox-data";
import type { AgentSandboxSnapshot } from "@/lib/agent/sandbox";
import {
  EMPTY_SANDBOX_AGENT_STATE,
  type SandboxAgentState,
  type SandboxIntent,
  type SandboxLeadDraft,
  type SandboxLeadField,
  type SandboxTurn,
} from "@/lib/agent/sandbox-types";

const FIELD_SEQUENCE: SandboxLeadField[] = [
  "leadName",
  "leadMobileNumber",
  "leadState",
  "leadCity",
  "leadAddress",
  "relationship",
  "projectType",
  "remark",
];
const OPTIONAL_FIELDS = new Set<SandboxLeadField>(["leadCity", "leadAddress", "remark"]);

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function isSkipValue(value: string) {
  const normalized = normalizeText(value);
  return normalized === "skip" || normalized === "none" || normalized === "na" || normalized === "n/a";
}

function isCancelValue(value: string) {
  const normalized = normalizeText(value);
  return normalized === "cancel" || normalized === "stop" || normalized === "abort";
}

function isConfirmValue(value: string) {
  const normalized = normalizeText(value);
  return normalized === "confirm" || normalized === "yes" || normalized === "save" || normalized === "ok";
}

function isLeadCreationStart(value: string) {
  const normalized = normalizeText(value);
  return (
    normalized.includes("new lead") ||
    normalized.includes("add lead") ||
    normalized.includes("create lead") ||
    normalized.includes("refer someone")
  );
}

function isClearlyOffTopic(value: string) {
  const normalized = normalizeText(value);
  return /(weather|joke|football|movie|stock|bitcoin|translate|recipe|holiday|news)/.test(normalized);
}

function getNextField(draft: Partial<SandboxLeadDraft>): SandboxLeadField | null {
  for (const field of FIELD_SEQUENCE) {
    const value = draft[field];

    if (OPTIONAL_FIELDS.has(field)) {
      if (typeof value !== "string") {
        return field;
      }
      continue;
    }

    if (typeof value !== "string" || !value.trim()) {
      return field;
    }
  }

  return null;
}

function describeField(field: SandboxLeadField) {
  switch (field) {
    case "leadName":
      return "What is the lead name?";
    case "leadMobileNumber":
      return "What is the lead mobile number?";
    case "leadState":
      return "Which state is the lead in?";
    case "leadCity":
      return 'Which city is the lead in? You can reply "skip" if not needed.';
    case "leadAddress":
      return 'What is the lead address? You can reply "skip" if not needed.';
    case "relationship":
      return `What is your relationship to the lead? Choose one: ${RELATIONSHIP_OPTIONS.join(", ")}.`;
    case "projectType":
      return `What is the project type? Choose one: ${PROJECT_TYPE_OPTIONS.join(", ")}.`;
    case "remark":
      return 'Any remark for this lead? Reply "skip" if none.';
  }
}

function tryNormalizeRelationship(value: string) {
  const normalized = normalizeText(value);
  return RELATIONSHIP_OPTIONS.find((option) => normalizeText(option) === normalized) ?? null;
}

function tryNormalizeProjectType(value: string) {
  const normalized = normalizeText(value);
  return PROJECT_TYPE_OPTIONS.find((option) => normalizeText(option) === normalized) ?? null;
}

function validateField(field: SandboxLeadField, rawValue: string) {
  const value = rawValue.trim();

  switch (field) {
    case "leadName":
      if (value.length < 2) return { ok: false, error: "Lead name must be at least 2 characters." };
      return { ok: true, value };
    case "leadMobileNumber": {
      const normalized = value.replace(/\s+/g, "");
      if (normalized.length < 6) return { ok: false, error: "Lead mobile number must be at least 6 characters." };
      return { ok: true, value: normalized };
    }
    case "leadState":
      if (value.length < 2) return { ok: false, error: "Lead state is required." };
      return { ok: true, value };
    case "leadCity":
    case "leadAddress":
    case "remark":
      return { ok: true, value: isSkipValue(value) ? "" : value };
    case "relationship": {
      const relationship = tryNormalizeRelationship(value);
      if (!relationship) {
        return { ok: false, error: `Use one of: ${RELATIONSHIP_OPTIONS.join(", ")}.` };
      }
      return { ok: true, value: relationship };
    }
    case "projectType": {
      const projectType = tryNormalizeProjectType(value);
      if (!projectType) {
        return { ok: false, error: `Use one of: ${PROJECT_TYPE_OPTIONS.join(", ")}.` };
      }
      return { ok: true, value: projectType };
    }
  }
}

function buildDraftSummary(draft: Partial<SandboxLeadDraft>) {
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

function findDuplicateLead(referrals: ReferralRow[], draft: Partial<SandboxLeadDraft>) {
  const draftMobile = draft.leadMobileNumber?.replace(/\s+/g, "");
  const draftName = normalizeText(draft.leadName || "");

  return (
    referrals.find((row) => {
      const sameMobile = draftMobile && row.leadMobile?.replace(/\s+/g, "") === draftMobile;
      const sameName = draftName && normalizeText(row.leadName) === draftName;
      return Boolean(sameMobile || (sameName && sameMobile));
    }) ?? null
  );
}

function buildTurn(userMessage: string, intent: SandboxIntent, reply: string, plannedTools: string[]): SandboxTurn {
  return {
    userMessage,
    intent,
    reply,
    plannedTools,
  };
}

export async function runLeadCollectionTurn(
  snapshot: AgentSandboxSnapshot,
  priorState: SandboxAgentState | null | undefined,
  userMessage: string,
): Promise<{ turn: SandboxTurn; state: SandboxAgentState }> {
  const message = userMessage.trim();
  const state = priorState ?? EMPTY_SANDBOX_AGENT_STATE;

  if (isCancelValue(message)) {
    return {
      turn: buildTurn(message, "create_lead_collecting", "Lead creation cancelled. You can start again any time with \"new lead\".", []),
      state: EMPTY_SANDBOX_AGENT_STATE,
    };
  }

  if (state.mode === "idle") {
    const nextField = "leadName" as const;
    return {
      turn: buildTurn(
        message,
        "create_lead_collecting",
        `Starting a new lead.\n${describeField(nextField)}`,
        ["create_referral (pending confirmation)"],
      ),
      state: {
        mode: "collecting_lead",
        draft: {},
        nextField,
      },
    };
  }

  if (state.mode === "confirming_lead") {
    if (!isConfirmValue(message)) {
      return {
        turn: buildTurn(
          message,
          "create_lead_confirming",
          'Reply "CONFIRM" to save this lead or "CANCEL" to stop.',
          ["create_referral (pending confirmation)"],
        ),
        state,
      };
    }

    const duplicate = findDuplicateLead(snapshot.referrals, state.draft);
    if (duplicate) {
      return {
        turn: buildTurn(
          message,
          "create_lead_confirming",
          `I found a likely duplicate lead already in your list: ${duplicate.leadName} (${duplicate.leadMobile || "-"}) with status ${duplicate.status || "Pending"}.\nPlease cancel and change the mobile/name if this should be a different lead.`,
          ["list_referrer_leads"],
        ),
        state,
      };
    }

    const draft = state.draft as SandboxLeadDraft;
    const created = await createSandboxReferral({
      phone: snapshot.phone,
      leadName: draft.leadName,
      leadMobileNumber: draft.leadMobileNumber,
      leadState: draft.leadState,
      leadCity: draft.leadCity,
      leadAddress: draft.leadAddress,
      relationship: draft.relationship,
      projectType: draft.projectType,
      preferredAgentId: draft.preferredAgentId || "",
      remark: draft.remark,
    });

    return {
      turn: buildTurn(
        message,
        "create_lead_created",
        `Lead saved successfully.\nReferral ID: ${created.referralId}\nLead: ${draft.leadName}\nMobile: ${draft.leadMobileNumber}\nYou can now ask "my leads" to verify it.`,
        ["create_referral"],
      ),
      state: EMPTY_SANDBOX_AGENT_STATE,
    };
  }

  const currentField = state.nextField ?? getNextField(state.draft);
  if (!currentField) {
    return {
      turn: buildTurn(
        message,
        "create_lead_confirming",
        `Please review this lead and reply "CONFIRM" to save or "CANCEL" to stop.\n\n${buildDraftSummary(state.draft)}`,
        ["create_referral (pending confirmation)"],
      ),
      state: {
        mode: "confirming_lead",
        draft: state.draft,
        nextField: null,
      },
    };
  }

  const parsed = validateField(currentField, message);
  if (!parsed.ok) {
    return {
      turn: buildTurn(message, "create_lead_collecting", `${parsed.error}\n${describeField(currentField)}`, []),
      state: {
        ...state,
        nextField: currentField,
      },
    };
  }

  const nextDraft = {
    ...state.draft,
    [currentField]: parsed.value,
  };
  const nextField = getNextField(nextDraft);

  if (!nextField) {
    return {
      turn: buildTurn(
        message,
        "create_lead_confirming",
        `Please review this lead and reply "CONFIRM" to save or "CANCEL" to stop.\n\n${buildDraftSummary(nextDraft)}`,
        ["create_referral (pending confirmation)"],
      ),
      state: {
        mode: "confirming_lead",
        draft: nextDraft,
        nextField: null,
      },
    };
  }

  return {
    turn: buildTurn(message, "create_lead_collecting", describeField(nextField), []),
    state: {
      mode: "collecting_lead",
      draft: nextDraft,
      nextField,
    },
  };
}

export function shouldStartLeadCollection(message: string) {
  return isLeadCreationStart(message);
}

export function buildOffTopicTurn(userMessage: string): SandboxTurn {
  return buildTurn(
    userMessage,
    "off_topic",
    "I only handle referral lead tasks here: add a lead, check your leads, inspect one lead, and later update lead workflow. Please keep the chat on referral management.",
    [],
  );
}

export function isOffTopicMessage(message: string) {
  return isClearlyOffTopic(message);
}

export const MAX_SANDBOX_ROUNDS = 30;
export const MAX_SANDBOX_MESSAGES = MAX_SANDBOX_ROUNDS * 2;

export type SandboxIntent =
  | "greeting"
  | "help"
  | "list_leads"
  | "lead_details"
  | "create_lead_collecting"
  | "create_lead_confirming"
  | "create_lead_created"
  | "update_lead_blocked"
  | "follow_up_blocked"
  | "off_topic"
  | "unknown";

export type SandboxTurn = {
  userMessage: string;
  intent: SandboxIntent;
  reply: string;
  plannedTools: string[];
};

export type SandboxConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export type SandboxLeadDraft = {
  leadName: string;
  leadMobileNumber: string;
  leadState: string;
  leadCity: string;
  leadAddress: string;
  relationship: string;
  projectType: string;
  preferredAgentId: string;
  remark: string;
};

export type SandboxLeadField =
  | "leadName"
  | "leadMobileNumber"
  | "leadState"
  | "leadCity"
  | "leadAddress"
  | "relationship"
  | "projectType"
  | "remark";

export type SandboxAgentState = {
  mode: "idle" | "collecting_lead" | "confirming_lead";
  draft: Partial<SandboxLeadDraft>;
  nextField: SandboxLeadField | null;
};

export const EMPTY_SANDBOX_AGENT_STATE: SandboxAgentState = {
  mode: "idle",
  draft: {},
  nextField: null,
};

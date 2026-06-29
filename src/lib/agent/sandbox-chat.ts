import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { z } from "zod";

import type { AgentSandboxSnapshot } from "@/lib/agent/sandbox";
import {
  MAX_SANDBOX_MESSAGES,
  type SandboxConversationMessage,
  type SandboxTurn,
} from "@/lib/agent/sandbox-types";

const execFileAsync = promisify(execFile);
const MMX_EXECUTABLE = process.platform === "win32" ? "mmx.cmd" : "mmx";

const sandboxTurnSchema = z.object({
  reply: z.string().trim().min(1),
  intent: z.enum([
    "greeting",
    "help",
    "list_leads",
    "lead_details",
    "create_lead_collecting",
    "create_lead_confirming",
    "create_lead_created",
    "update_lead_blocked",
    "follow_up_blocked",
    "off_topic",
    "unknown",
  ]),
  plannedTools: z.array(z.string()).max(5).default([]),
});

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function buildSnapshotContext(snapshot: AgentSandboxSnapshot) {
  const header = snapshot.referrer
    ? `Referrer account found.\nCustomer ID: ${snapshot.referrer.customerId}\nDisplay name: ${snapshot.referrer.name}\nPhone: ${snapshot.referrer.phone}`
    : `No referrer account exists yet for phone ${snapshot.phone}.`;

  const leadSummary =
    snapshot.referrals.length === 0
      ? "No referral leads currently linked to this sandbox identity."
      : snapshot.referrals
          .slice(0, 20)
          .map((referral, index) => {
            const location = [referral.leadState, referral.leadCity, referral.leadAddress]
              .map((value) => value?.trim())
              .filter(Boolean)
              .join(" | ");
            return `${index + 1}. ${referral.leadName} | mobile=${referral.leadMobile || "-"} | status=${referral.status || "Pending"} | projectType=${referral.projectType || "Not set"} | relationship=${referral.relationship || "-"} | preferredAgent=${referral.preferredAgentName || "Not selected"} | location=${location || "Location not provided"}`;
          })
          .join("\n");

  return `${header}\n\nLead snapshot:\n${leadSummary}`;
}

function buildSystemPrompt(snapshot: AgentSandboxSnapshot) {
  return [
    "You are the Phase 1 referral sandbox agent for Eternalgy.",
    "This is a local internal testing interface before WhatsApp is connected.",
    "You only handle referral-related tasks.",
    "You may help with help, my leads, lead details, and referral lead management questions using only the provided snapshot.",
    "Do not answer unrelated topics such as jokes, weather, sports, finance, translation, or general chat.",
    "If the user asks an unrelated question, reply that you only handle referral lead tasks.",
    "Write actions such as edit lead and follow-up are NOT enabled yet unless the route handler explicitly manages them.",
    "Never invent leads or data that are not present in the snapshot.",
    "Be concise and useful.",
    'Return JSON only with keys: "reply", "intent", "plannedTools".',
    "Allowed intent values: greeting, help, list_leads, lead_details, create_lead_collecting, create_lead_confirming, create_lead_created, update_lead_blocked, follow_up_blocked, off_topic, unknown.",
    "plannedTools should reflect what the system would conceptually use, such as list_referrer_leads or get_lead_details.",
    "If no tool is needed, return an empty array.",
    "",
    `Snapshot for phone ${snapshot.phone}:`,
    buildSnapshotContext(snapshot),
  ].join("\n");
}

function buildLeadSummary(snapshot: AgentSandboxSnapshot) {
  if (snapshot.referrals.length === 0) {
    return "I could not find any referral leads for this emulated phone yet.";
  }

  const lines = snapshot.referrals.slice(0, 8).map((referral, index) => {
    const projectType = referral.projectType || "Not set";
    const status = referral.status || "Pending";
    return `${index + 1}. ${referral.leadName} | ${projectType} | ${status}`;
  });

  return `I found ${snapshot.referrals.length} lead(s) for this sandbox identity:\n${lines.join("\n")}`;
}

function findLeadByMessage(snapshot: AgentSandboxSnapshot, normalizedMessage: string) {
  const indexMatch = normalizedMessage.match(/\blead\s+(\d+)\b/);

  if (indexMatch) {
    const index = Number(indexMatch[1]);
    if (Number.isInteger(index) && index > 0) {
      return snapshot.referrals[index - 1] || null;
    }
  }

  const namedMatch = normalizedMessage.match(/(?:status of|show|details for|open)\s+(.+)/);
  const candidateName = namedMatch?.[1]?.trim();

  if (!candidateName) {
    return null;
  }

  return (
    snapshot.referrals.find((referral) => normalizeText(referral.leadName).includes(candidateName)) ?? null
  );
}

export function runReadonlySandboxTurn(
  snapshot: AgentSandboxSnapshot,
  userMessage: string | null | undefined,
): SandboxTurn | null {
  const message = userMessage?.trim();

  if (!message) {
    return null;
  }

  const normalizedMessage = normalizeText(message);

  if (/^(hi|hello|hey|start)\b/.test(normalizedMessage)) {
    return {
      userMessage: message,
      intent: "greeting",
      reply:
        "Hello. This is the Phase 1 read-only sandbox. I can inspect the current referrer account, list leads, and show lead details for the emulated phone number.",
      plannedTools: ["get_or_create_referrer_by_phone (read-only lookup mode)"],
    };
  }

  if (normalizedMessage.includes("help")) {
    return {
      userMessage: message,
      intent: "help",
      reply:
        'Try messages like "new lead", "my leads", "show lead 1", or "status of John". Lead creation is enabled with explicit confirmation. Lead updates and follow-up remain blocked in this milestone.',
      plannedTools: [],
    };
  }

  if (
    normalizedMessage.includes("my leads") ||
    normalizedMessage.includes("my referrals") ||
    normalizedMessage.includes("show all leads") ||
    normalizedMessage.includes("check leads") ||
    normalizedMessage === "leads"
  ) {
    return {
      userMessage: message,
      intent: "list_leads",
      reply: buildLeadSummary(snapshot),
      plannedTools: ["list_referrer_leads"],
    };
  }

  if (
    normalizedMessage.includes("new lead") ||
    normalizedMessage.includes("add lead") ||
    normalizedMessage.includes("refer someone")
  ) {
    return {
      userMessage: message,
      intent: "create_lead_collecting",
      reply:
        "Lead creation is handled by the sandbox flow now. Say \"new lead\" and I will collect the details one field at a time.",
      plannedTools: [],
    };
  }

  if (normalizedMessage.includes("update") || normalizedMessage.includes("edit")) {
    return {
      userMessage: message,
      intent: "update_lead_blocked",
      reply:
        "Lead updates are intentionally blocked in this milestone. The next safe build step is a confirmation-first write flow after the sandbox conversation loop is stable.",
      plannedTools: [],
    };
  }

  if (
    normalizedMessage.includes("follow up") ||
    normalizedMessage.includes("follow-up") ||
    normalizedMessage.includes("assign") ||
    normalizedMessage.includes("contact the lead")
  ) {
    return {
      userMessage: message,
      intent: "follow_up_blocked",
      reply:
        "Human follow-up and assignment requests are not enabled yet in the sandbox. For now I only expose the read-only agent reasoning path and current lead data.",
      plannedTools: [],
    };
  }

  if (
    normalizedMessage.includes("show lead") ||
    normalizedMessage.includes("status of") ||
    normalizedMessage.includes("details for") ||
    normalizedMessage.includes("open lead")
  ) {
    const lead = findLeadByMessage(snapshot, normalizedMessage);

    if (!lead) {
      return {
        userMessage: message,
        intent: "lead_details",
        reply:
          "I could not match that request to a current lead. Try \"my leads\" first, then ask for \"show lead 1\" or use part of the lead name.",
        plannedTools: ["list_referrer_leads"],
      };
    }

    const projectType = lead.projectType || "Not set";
    const status = lead.status || "Pending";
    const location = [lead.leadState, lead.leadCity, lead.leadAddress].map((value) => value?.trim()).filter(Boolean).join(" | ");

    return {
      userMessage: message,
      intent: "lead_details",
      reply: `Lead details for ${lead.leadName}:\n- Mobile: ${lead.leadMobile || "-"}\n- Status: ${status}\n- Project type: ${projectType}\n- Relationship: ${lead.relationship || "-"}\n- Preferred agent: ${lead.preferredAgentName || "Not selected"}\n- Location: ${location || "Location not provided"}`,
      plannedTools: ["get_lead_details"],
    };
  }

  return {
    userMessage: message,
    intent: "off_topic",
    reply:
      'I only handle referral lead tasks here. Try "new lead", "my leads", or "show lead 1".',
    plannedTools: [],
  };
}

export function trimSandboxHistory(history: SandboxConversationMessage[]) {
  return history.slice(-MAX_SANDBOX_MESSAGES);
}

async function runMiniMaxJsonTurn(
  snapshot: AgentSandboxSnapshot,
  history: SandboxConversationMessage[],
  userMessage: string,
): Promise<SandboxTurn> {
  const args = ["text", "chat", "--non-interactive", "--quiet", "--output", "json", "--message", `system:${buildSystemPrompt(snapshot)}`];

  for (const message of trimSandboxHistory(history)) {
    args.push("--message", `${message.role}:${message.content}`);
  }

  args.push("--message", `user:${userMessage}`);

  const { stdout } = await execFileAsync(MMX_EXECUTABLE, args, {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
  });

  const parsed = sandboxTurnSchema.parse(JSON.parse(stdout));

  return {
    userMessage,
    intent: parsed.intent,
    reply: parsed.reply,
    plannedTools: parsed.plannedTools,
  };
}

export async function runSandboxTurn(
  snapshot: AgentSandboxSnapshot,
  history: SandboxConversationMessage[],
  userMessage: string | null | undefined,
): Promise<SandboxTurn | null> {
  const message = userMessage?.trim();

  if (!message) {
    return null;
  }

  try {
    return await runMiniMaxJsonTurn(snapshot, history, message);
  } catch {
    return runReadonlySandboxTurn(snapshot, message);
  }
}

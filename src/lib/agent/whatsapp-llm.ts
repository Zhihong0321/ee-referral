import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

import type { ReferralRow } from "@/lib/referrals";
import type { WhatsappReferrerAccount } from "@/lib/agent/whatsapp-data";

const execFileAsync = promisify(execFile);

function getMmxCommand() {
  const localScript = path.join(process.cwd(), "node_modules", "mmx-cli", "dist", "mmx.mjs");

  if (existsSync(localScript)) {
    return {
      command: process.execPath,
      prefixArgs: [localScript],
    };
  }

  return {
    command: process.platform === "win32" ? process.execPath : "mmx",
    prefixArgs:
      process.platform === "win32"
        ? ["C:\\Users\\Eternalgy\\AppData\\Roaming\\npm\\node_modules\\mmx-cli\\dist\\mmx.mjs"]
        : [],
  };
}

const intentSchema = z.object({
  intent: z.enum(["help", "list_leads", "lead_details", "add_lead", "update_lead", "unknown"]),
  leadReference: z.string().trim().optional().default(""),
  replyHint: z.string().trim().optional().default(""),
});

const replySchema = z.object({
  reply: z.string().trim().min(1),
});

function extractJsonObject(output: string) {
  const trimmed = output.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("MiniMax did not return a JSON object.");
  }

  return JSON.parse(candidate.slice(start, end + 1)) as unknown;
}

async function runMiniMaxJson<T>(schema: z.ZodType<T>, messages: string[]) {
  const args = ["text", "chat", "--non-interactive", "--quiet", "--output", "json"];

  for (const message of messages) {
    args.push("--message", message);
  }

  const { command, prefixArgs } = getMmxCommand();
  const commandArgs = [...prefixArgs, ...args];

  const { stdout } = await execFileAsync(command, commandArgs, {
    cwd: process.cwd(),
    timeout: 25000,
    maxBuffer: 1024 * 1024,
  });

  return schema.parse(extractJsonObject(stdout));
}

function buildLeadContext(referrals: ReferralRow[]) {
  if (referrals.length === 0) {
    return "No leads currently found.";
  }

  return referrals
    .slice(0, 15)
    .map((lead, index) => {
      const location = [lead.leadState, lead.leadCity, lead.leadAddress].map((value) => value?.trim()).filter(Boolean).join(" | ");
      return `${index + 1}. ${lead.leadName}; mobile=${lead.leadMobile || "-"}; status=${lead.status || "Pending"}; project=${lead.projectType || "Not set"}; location=${location || "-"}`;
    })
    .join("\n");
}

export async function classifyWhatsappIntent(input: {
  referrer: WhatsappReferrerAccount;
  referrals: ReferralRow[];
  message: string;
}) {
  return runMiniMaxJson(intentSchema, [
    [
      "system:You are Eternalgy's WhatsApp referral assistant intent classifier.",
      "Return JSON only.",
      "Classify the user's message into one intent:",
      "help, list_leads, lead_details, add_lead, update_lead, unknown.",
      "Use add_lead when user wants to refer someone or create a new lead.",
      "Use update_lead when user wants to edit/change/update a lead field, phone, name, address, state, project, relationship, or remark.",
      "Use list_leads when user asks for all/my leads/referrals/manage leads.",
      "Use lead_details when user asks about a specific lead by number, name, latest, status, or details.",
      "Do not invent data. Do not write SQL. The server will execute tools.",
      'Return shape: {"intent":"...", "leadReference":"", "replyHint":""}',
      "",
      `Referrer: ${input.referrer.name}; phone=${input.referrer.phone}`,
      `Known leads:\n${buildLeadContext(input.referrals)}`,
    ].join("\n"),
    `user:${input.message}`,
  ]);
}

export async function polishWhatsappReply(input: {
  referrer: WhatsappReferrerAccount;
  userMessage: string;
  toolResult: string;
}) {
  try {
    const parsed = await runMiniMaxJson(replySchema, [
      [
        "system:You are Eternalgy's WhatsApp referral assistant.",
        "Return JSON only with key reply.",
        "Rewrite the tool result into a natural WhatsApp reply.",
        "Keep every factual value exactly as provided. Do not add names, leads, IDs, prices, statuses, promises, or capabilities that are not in the tool result.",
        "Keep it concise, friendly, and action-oriented.",
      ].join("\n"),
      `user:Referrer name: ${input.referrer.name}\nUser message: ${input.userMessage}\nTool result:\n${input.toolResult}`,
    ]);

    return parsed.reply;
  } catch {
    return input.toolResult;
  }
}

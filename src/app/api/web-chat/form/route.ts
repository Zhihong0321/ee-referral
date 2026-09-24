import { NextResponse } from "next/server";
import { z } from "zod";

import {
  EMPTY_WEBCHAT_MENU_STATE,
  appendConversation,
  createWhatsappReferral,
  listWhatsappAgents,
  resolveOrCreateReferrerByWhatsappPhone,
  saveAgentState,
  saveReferrerProfile,
} from "@/lib/agent/whatsapp-data";
import { MENU_TEXT } from "@/lib/agent/webchat-flow-logic";
import { maskSensitive, validateAddLeadSubmission, validateProfileSubmission } from "@/lib/agent/webchat-forms";
import { logWebchatExchange } from "@/lib/agent/webchat-transcript";
import { toCanonicalMalaysiaPhone } from "@/lib/phone-normalization";

export const runtime = "nodejs";

const requestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("add_lead"),
    phone: z.string().trim().min(1).max(30),
    leadName: z.string().max(400).default(""),
    leadMobileNumber: z.string().max(60).default(""),
    area: z.string().max(400).default(""),
    preferredAgentId: z.string().max(200).default(""),
    remark: z.string().max(1000).default(""),
  }),
  z.object({
    kind: z.literal("profile"),
    phone: z.string().trim().min(1).max(30),
    name: z.string().max(300).default(""),
    bankName: z.string().max(200).default(""),
    bankAccount: z.string().max(200).default(""),
    icNumber: z.string().max(100).default(""),
    tin: z.string().max(100).default(""),
    address: z.string().max(500).default(""),
  }),
]);

function isPlausibleMalaysiaMobile(canonicalPhone: string) {
  return /^60\d{9,11}$/.test(canonicalPhone);
}


/**
 * Records the form submission in the conversation the same way a typed turn is
 * recorded, so the chat transcript reads continuously and a page reload shows
 * what happened. The "user turn" is a readable summary, not the raw payload.
 */
async function finishSubmission(canonicalPhone: string, summary: string, reply: string, source: string) {
  // Never throws. Everything here runs AFTER the lead or profile is already
  // committed, so a failed bookkeeping write must not turn a successful save
  // into a 500 — the user would re-submit and create a duplicate lead.
  try {
    await saveAgentState(canonicalPhone, EMPTY_WEBCHAT_MENU_STATE);

    const now = new Date().toISOString();
    await appendConversation(canonicalPhone, [
      { role: "user", text: summary, time: now },
      { role: "assistant", text: reply, time: now },
    ]);
  } catch (error) {
    console.error("[web-chat] failed to record form exchange:", error instanceof Error ? error.message : error);
  }

  await logWebchatExchange({
    canonicalPhone,
    inboundText: summary,
    inboundMessageType: "text",
    reply,
    inboundSource: source,
  });
}

export async function POST(request: Request) {
  const body = requestSchema.safeParse(await request.json().catch(() => ({})));

  if (!body.success) {
    return NextResponse.json({ error: "Invalid form submission." }, { status: 400 });
  }

  const canonicalPhone = toCanonicalMalaysiaPhone(body.data.phone);

  if (!isPlausibleMalaysiaMobile(canonicalPhone)) {
    return NextResponse.json({ error: "Please log in with a valid phone number first." }, { status: 400 });
  }

  try {
    if (body.data.kind === "add_lead") {
      const agents = await listWhatsappAgents();
      const validated = validateAddLeadSubmission(body.data, {
        canonicalize: toCanonicalMalaysiaPhone,
        agentIds: agents.map((agent) => agent.id),
      });

      if (!validated.ok) {
        return NextResponse.json({ fieldErrors: validated.errors }, { status: 400 });
      }

      const lead = validated.value;
      const referrer = await resolveOrCreateReferrerByWhatsappPhone(canonicalPhone);
      const { referralId } = await createWhatsappReferral(
        referrer,
        {
          leadName: lead.leadName,
          leadMobileNumber: lead.leadMobileNumber,
          area: lead.area,
          remark: lead.remark,
        },
        { preferredAgentId: lead.preferredAgentId || null },
      );

      const agentName = agents.find((agent) => agent.id === lead.preferredAgentId)?.name || "";
      const summary = [
        "Submitted the Add Lead form.",
        `Lead: ${lead.leadName} — ${lead.leadMobileNumber}`,
        lead.area ? `Area: ${lead.area}` : "",
        `Assigned agent: ${agentName || "(none)"}`,
        lead.remark ? `Remarks: ${lead.remark}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const reply = `Lead saved (#${referralId}) — ${lead.leadName}, ${lead.leadMobileNumber}${
        agentName ? `, assigned to ${agentName}` : ""
      }.\n\n${MENU_TEXT}`;

      await finishSubmission(canonicalPhone, summary, reply, "web_chat_add_lead_form");

      return NextResponse.json({ reply, summary });
    }

    const validated = validateProfileSubmission(body.data);

    if (!validated.ok) {
      return NextResponse.json({ fieldErrors: validated.errors }, { status: 400 });
    }

    const profile = validated.value;
    const referrer = await resolveOrCreateReferrerByWhatsappPhone(canonicalPhone);
    await saveReferrerProfile(referrer, {
      name: profile.name,
      bankName: profile.bankName,
      bankAccount: profile.bankAccount,
      icNumber: profile.icNumber,
      tin: profile.tin,
      address: profile.address,
    });

    const summary = [
      "Submitted the My Details form.",
      `Name: ${profile.name}`,
      `Bank: ${profile.bankName}`,
      `Bank account: ${maskSensitive(profile.bankAccount)}`,
      `IC number: ${maskSensitive(profile.icNumber)}`,
      `TIN: ${maskSensitive(profile.tin)}`,
      `Address: ${profile.address}`,
    ].join("\n");
    const reply = `Your details are saved, ${profile.name}.\n\n${MENU_TEXT}`;

    await finishSubmission(canonicalPhone, summary, reply, "web_chat_profile_form");

    return NextResponse.json({ reply, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    console.error("[web-chat] form submission failed:", message);
    return NextResponse.json({ error: `Unable to save right now: ${message}` }, { status: 500 });
  }
}

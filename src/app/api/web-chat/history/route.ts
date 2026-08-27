import { NextResponse } from "next/server";

import { loadAgentState, loadConversation } from "@/lib/agent/whatsapp-data";
import { buildAddLeadForm, buildProfileForm } from "@/lib/agent/webchat-flow";
import type { WebchatForm } from "@/lib/agent/webchat-forms";
import { distillHistoryTurnText } from "@/lib/agent/whatsapp-history";
import { toCanonicalMalaysiaPhone } from "@/lib/phone-normalization";

export const runtime = "nodejs";

function isPlausibleMalaysiaMobile(canonicalPhone: string) {
  return /^60\d{9,11}$/.test(canonicalPhone);
}

// A form is not part of the stored transcript, so it has to be rebuilt from the
// persisted step — otherwise reloading mid-form drops the user on a prompt with
// nothing to fill in.
async function reopenForm(canonicalPhone: string): Promise<WebchatForm | undefined> {
  const state = await loadAgentState(canonicalPhone);

  if (state.step === "add_form") {
    return (await buildAddLeadForm(canonicalPhone)).form;
  }

  if (state.step === "profile_form") {
    return (await buildProfileForm(canonicalPhone)).form;
  }

  return undefined;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const canonicalPhone = toCanonicalMalaysiaPhone(url.searchParams.get("phone"));

  if (!isPlausibleMalaysiaMobile(canonicalPhone)) {
    return NextResponse.json({ error: "Please enter a valid phone number." }, { status: 400 });
  }

  try {
    const [history, form] = await Promise.all([loadConversation(canonicalPhone), reopenForm(canonicalPhone)]);

    return NextResponse.json({
      messages: history.map((turn) => ({
        role: turn.role,
        text: turn.role === "user" ? distillHistoryTurnText(turn.text) : turn.text,
        time: turn.time || null,
      })),
      form,
    });
  } catch {
    return NextResponse.json({ error: "Unable to load conversation history right now." }, { status: 500 });
  }
}

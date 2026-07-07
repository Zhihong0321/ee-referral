import { NextResponse } from "next/server";
import { z } from "zod";

import { appendConversation } from "@/lib/agent/whatsapp-data";
import { runWhatsappAgentTurnV2 } from "@/lib/agent/whatsapp-flow-v2";
import { toCanonicalMalaysiaPhone } from "@/lib/phone-normalization";

export const runtime = "nodejs";

const requestSchema = z.object({
  phone: z.string().trim().min(1).max(30),
  message: z.string().trim().min(1).max(2000),
});

function isPlausibleMalaysiaMobile(canonicalPhone: string) {
  return /^60\d{9,11}$/.test(canonicalPhone);
}

export async function POST(request: Request) {
  const body = requestSchema.safeParse(await request.json().catch(() => ({})));

  if (!body.success) {
    return NextResponse.json({ error: body.error.issues[0]?.message || "Invalid request." }, { status: 400 });
  }

  const canonicalPhone = toCanonicalMalaysiaPhone(body.data.phone);

  if (!isPlausibleMalaysiaMobile(canonicalPhone)) {
    return NextResponse.json({ error: "Please log in with a valid phone number first." }, { status: 400 });
  }

  try {
    const { reply } = await runWhatsappAgentTurnV2({ senderPhone: canonicalPhone, text: body.data.message });

    const now = new Date().toISOString();
    await appendConversation(canonicalPhone, [
      { role: "user", text: body.data.message, time: now },
      { role: "assistant", text: reply, time: now },
    ]);

    return NextResponse.json({ reply });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return NextResponse.json({ error: `Unable to reach the referral assistant right now: ${message}` }, { status: 500 });
  }
}

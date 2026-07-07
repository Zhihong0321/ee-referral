import { NextResponse } from "next/server";

import { loadConversation } from "@/lib/agent/whatsapp-data";
import { toCanonicalMalaysiaPhone } from "@/lib/phone-normalization";

export const runtime = "nodejs";

function isPlausibleMalaysiaMobile(canonicalPhone: string) {
  return /^60\d{9,11}$/.test(canonicalPhone);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const canonicalPhone = toCanonicalMalaysiaPhone(url.searchParams.get("phone"));

  if (!isPlausibleMalaysiaMobile(canonicalPhone)) {
    return NextResponse.json({ error: "Please enter a valid phone number." }, { status: 400 });
  }

  try {
    const history = await loadConversation(canonicalPhone);
    return NextResponse.json({
      messages: history.map((turn) => ({ role: turn.role, text: turn.text, time: turn.time || null })),
    });
  } catch {
    return NextResponse.json({ error: "Unable to load conversation history right now." }, { status: 500 });
  }
}

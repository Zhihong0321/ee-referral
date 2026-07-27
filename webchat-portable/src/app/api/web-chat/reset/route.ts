import { NextResponse } from "next/server";
import { z } from "zod";

import { clearConversation } from "@/lib/agent/whatsapp-data";
import { toCanonicalMalaysiaPhone } from "@/lib/phone-normalization";

export const runtime = "nodejs";

const requestSchema = z.object({
  phone: z.string().trim().min(1).max(30),
});

function isPlausibleMalaysiaMobile(canonicalPhone: string) {
  return /^60\d{9,11}$/.test(canonicalPhone);
}

export async function POST(request: Request) {
  const body = requestSchema.safeParse(await request.json().catch(() => ({})));

  if (!body.success) {
    return NextResponse.json({ error: "Please enter your phone number." }, { status: 400 });
  }

  const canonicalPhone = toCanonicalMalaysiaPhone(body.data.phone);

  if (!isPlausibleMalaysiaMobile(canonicalPhone)) {
    return NextResponse.json({ error: "Please enter a valid phone number." }, { status: 400 });
  }

  try {
    await clearConversation(canonicalPhone);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unable to reset the chat right now." }, { status: 500 });
  }
}

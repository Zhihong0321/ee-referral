import { NextResponse } from "next/server";
import { z } from "zod";

import { loadConversation, resolveOrCreateReferrerByWhatsappPhone } from "@/lib/agent/whatsapp-data";
import { toCanonicalMalaysiaPhone } from "@/lib/phone-normalization";

export const runtime = "nodejs";

const requestSchema = z.object({
  phone: z.string().trim().min(1).max(30),
});

function isPlausibleMalaysiaMobile(canonicalPhone: string) {
  // "60" + 9-11 digits covers the local mobile/landline range (e.g. 60123456789).
  return /^60\d{9,11}$/.test(canonicalPhone);
}

export async function POST(request: Request) {
  const body = requestSchema.safeParse(await request.json().catch(() => ({})));

  if (!body.success) {
    return NextResponse.json({ error: "Please enter your phone number." }, { status: 400 });
  }

  const canonicalPhone = toCanonicalMalaysiaPhone(body.data.phone);

  if (!isPlausibleMalaysiaMobile(canonicalPhone)) {
    return NextResponse.json({ error: "Please enter a valid phone number, e.g. 012-345 6789." }, { status: 400 });
  }

  try {
    const [referrer, history] = await Promise.all([
      resolveOrCreateReferrerByWhatsappPhone(canonicalPhone),
      loadConversation(canonicalPhone),
    ]);

    return NextResponse.json({
      phone: canonicalPhone,
      referrerName: referrer.name,
      isNew: history.length === 0,
    });
  } catch {
    return NextResponse.json({ error: "Unable to log in right now. Please try again." }, { status: 500 });
  }
}

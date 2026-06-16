import { NextResponse } from "next/server";
import { z } from "zod";

import {
  isWhatsappAgentRequestAuthorized,
  processWhatsappAgentMessages,
} from "@/lib/agent/whatsapp-processor";

export const runtime = "nodejs";

// Manual/testing entry point. Real inbound traffic arrives via the webhook route.
const requestSchema = z.object({
  dryRun: z.boolean().optional().default(false),
  messages: z
    .array(
      z.object({
        externalMessageId: z.string().min(1),
        senderPhone: z.string().min(1),
        recipientPhone: z.string().optional().nullable(),
        messageType: z.string().optional().default("text"),
        text: z.string().min(1),
        rawPayload: z.record(z.string(), z.unknown()).optional().default({}),
      }),
    )
    .min(1),
});

function isAuthorized(request: Request) {
  return isWhatsappAgentRequestAuthorized(request, ["WHATSAPP_AGENT_PROCESS_SECRET"]);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = requestSchema.parse(await request.json().catch(() => ({})));
  const results = await processWhatsappAgentMessages(body.messages, { dryRun: body.dryRun });

  return NextResponse.json({
    processed: results.length,
    results,
  });
}

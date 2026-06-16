import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getLatestWhatsappInboundId,
  isWhatsappAgentRequestAuthorized,
  processPendingWhatsappInbound,
  processWhatsappAgentMessages,
} from "@/lib/agent/whatsapp-processor";

export const runtime = "nodejs";

const requestSchema = z.object({
  limit: z.coerce.number().int().positive().max(20).default(5),
  afterId: z.coerce.number().int().min(0).default(0),
  dryRun: z.boolean().optional().default(false),
  includeFailed: z.boolean().optional().default(false),
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
    .optional(),
});

function isAuthorized(request: Request) {
  return isWhatsappAgentRequestAuthorized(request, ["WHATSAPP_AGENT_PROCESS_SECRET"]);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = requestSchema.parse(await request.json().catch(() => ({})));

  if (body.messages?.length) {
    const results = await processWhatsappAgentMessages(body.messages, { dryRun: body.dryRun });

    return NextResponse.json({
      processed: results.length,
      results,
    });
  }

  const results = await processPendingWhatsappInbound({
    limit: body.limit,
    afterId: body.afterId,
    includeFailed: body.includeFailed,
    dryRun: body.dryRun,
  });

  return NextResponse.json({
    processed: results.length,
    results,
  });
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return NextResponse.json({
    latestInboundId: await getLatestWhatsappInboundId(),
  });
}

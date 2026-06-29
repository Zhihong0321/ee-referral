import { NextResponse } from "next/server";
import { z } from "zod";

import {
  isWhatsappAgentRequestAuthorized,
  processPendingWhatsappAgentMessages,
  processWhatsappAgentMessages,
} from "@/lib/agent/whatsapp-processor";
import { processPendingPreferredAgentNotifications } from "@/lib/agent/whatsapp-data";

export const runtime = "nodejs";

// Manual/testing entry point. Real inbound traffic arrives via the webhook route.
const requestSchema = z.object({
  dryRun: z.boolean().optional().default(false),
  source: z.enum(["request", "database"]).optional().default("request"),
  limit: z.number().int().min(1).max(50).optional().default(10),
  lookbackMinutes: z.number().int().min(1).max(10080).optional().default(60),
  messages: z
    .array(
      z.object({
        externalMessageId: z.string().min(1),
        senderPhone: z.string().min(1),
        recipientPhone: z.string().optional().nullable(),
        messageType: z.string().optional().default("text"),
        text: z.string().optional().default(""),
        mediaUrl: z.string().optional().nullable(),
        rawPayload: z.record(z.string(), z.unknown()).optional().default({}),
      }),
    )
    .optional()
    .default([]),
});

function isAuthorized(request: Request) {
  return isWhatsappAgentRequestAuthorized(request, ["WHATSAPP_AGENT_PROCESS_SECRET"]);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = requestSchema.parse(await request.json().catch(() => ({})));
  const results =
    body.source === "database"
      ? await processPendingWhatsappAgentMessages({
          dryRun: body.dryRun,
          limit: body.limit,
          lookbackMinutes: body.lookbackMinutes,
        })
      : await processWhatsappAgentMessages(body.messages, { dryRun: body.dryRun });
  const preferredAgentNotifications = body.dryRun
    ? []
    : await processPendingPreferredAgentNotifications({ limit: body.limit });

  return NextResponse.json({
    processed: results.length,
    preferredAgentNotificationsProcessed: preferredAgentNotifications.length,
    source: body.source,
    results,
    preferredAgentNotifications,
  });
}

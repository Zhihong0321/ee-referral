import { NextResponse } from "next/server";
import { z } from "zod";

import {
  ensureChannelSession,
  extractTextFromPayload,
  getLatestWhatsappInboundId,
  hasEtMessage,
  insertEtMessage,
  listPendingWhatsappInbound,
  loadAgentState,
  markInboundFailed,
  markInboundProcessed,
  sendWhatsappText,
} from "@/lib/agent/whatsapp-data";
import { runWhatsappAgentTurn } from "@/lib/agent/whatsapp-flow";
import { ensureWhatsappAgentWorker } from "@/lib/agent/worker-start";
import { toCanonicalMalaysiaPhone } from "@/lib/phone-normalization";

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
  const secret = process.env.WHATSAPP_AGENT_PROCESS_SECRET?.trim();

  if (!secret) {
    return true;
  }

  const header = request.headers.get("authorization") || "";
  return header === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  ensureWhatsappAgentWorker();

  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = requestSchema.parse(await request.json().catch(() => ({})));
  const channelSession = await ensureChannelSession();
  const results = [];

  if (body.messages?.length) {
    for (const message of body.messages) {
      try {
        const senderPhone = toCanonicalMalaysiaPhone(message.senderPhone);
        const recipientPhone = toCanonicalMalaysiaPhone(message.recipientPhone || "");

        if (!senderPhone) {
          results.push({ id: message.externalMessageId, status: "failed", reason: "missing_sender_phone" });
          continue;
        }

        if (await hasEtMessage(message.externalMessageId, "inbound")) {
          results.push({ id: message.externalMessageId, status: "skipped", reason: "already_processed" });
          continue;
        }

        const state = await loadAgentState(senderPhone);
        const reply = await runWhatsappAgentTurn({ senderPhone, text: message.text, state });

        let sendResult: unknown = null;
        if (!body.dryRun) {
          await insertEtMessage({
            externalMessageId: message.externalMessageId,
            direction: "inbound",
            messageType: message.messageType || "text",
            textContent: message.text,
            rawPayload: message.rawPayload,
            senderPhone,
            recipientPhone,
            channelSessionId: channelSession.id,
          });

          sendResult = await sendWhatsappText(senderPhone, reply);
          await insertEtMessage({
            externalMessageId: `agent_reply_${message.externalMessageId}`,
            direction: "outbound",
            messageType: "text",
            textContent: reply,
            rawPayload: { source: "whatsapp_agent_baileys_poll", inboundMessageId: message.externalMessageId, sendResult },
            senderPhone: recipientPhone,
            recipientPhone: senderPhone,
            channelSessionId: channelSession.id,
          });
        }

        results.push({
          id: message.externalMessageId,
          status: body.dryRun ? "dry_run" : "processed",
          senderPhone,
          text: message.text,
          reply,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown WhatsApp agent error.";
        results.push({ id: message.externalMessageId, status: "failed", error: errorMessage });
      }
    }

    return NextResponse.json({
      processed: results.length,
      results,
    });
  }

  const rows = await listPendingWhatsappInbound(body.limit, body.afterId, body.includeFailed);

  for (const row of rows) {
    try {
      const text = extractTextFromPayload(row.raw_payload);
      const senderPhone = toCanonicalMalaysiaPhone(row.sender_phone || "");
      const recipientPhone = toCanonicalMalaysiaPhone(row.recipient_phone || "");

      if (!senderPhone) {
        if (!body.dryRun) {
          await markInboundFailed(row.id, "Missing sender phone.");
        }
        results.push({ id: row.id, status: "failed", reason: "missing_sender_phone" });
        continue;
      }

      if (!text) {
        if (!body.dryRun) {
          await markInboundProcessed(row.id, "");
        }
        results.push({ id: row.id, status: "skipped", reason: "non_text_message", messageType: row.message_type });
        continue;
      }

      const state = await loadAgentState(senderPhone);
      const reply = await runWhatsappAgentTurn({ senderPhone, text, state });

      let sendResult: unknown = null;
      if (!body.dryRun) {
        await insertEtMessage({
          externalMessageId: row.external_message_id,
          direction: "inbound",
          messageType: row.message_type || "text",
          textContent: text,
          rawPayload: row.raw_payload,
          senderPhone,
          recipientPhone,
          channelSessionId: channelSession.id,
        });

        sendResult = await sendWhatsappText(senderPhone, reply);
        await insertEtMessage({
          externalMessageId: `agent_reply_${row.external_message_id}`,
          direction: "outbound",
          messageType: "text",
          textContent: reply,
          rawPayload: { source: "whatsapp_agent", inboundId: row.id, sendResult },
          senderPhone: recipientPhone,
          recipientPhone: senderPhone,
          channelSessionId: channelSession.id,
        });
      }

      if (!body.dryRun) {
        await markInboundProcessed(row.id, reply);
      }
      results.push({
        id: row.id,
        status: body.dryRun ? "dry_run" : "processed",
        senderPhone,
        text,
        reply,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown WhatsApp agent error.";
      if (!body.dryRun) {
        await markInboundFailed(row.id, message);
      }
      results.push({ id: row.id, status: "failed", error: message });
    }
  }

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

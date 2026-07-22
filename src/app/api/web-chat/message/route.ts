import { NextResponse } from "next/server";
import { z } from "zod";

import { appendConversation, ensureChannelSession, insertEtMessage } from "@/lib/agent/whatsapp-data";
import { convertVisualBytesToText } from "@/lib/agent/whatsapp-processor";
import { runWhatsappAgentTurnV2 } from "@/lib/agent/whatsapp-flow-v2";
import { toCanonicalMalaysiaPhone } from "@/lib/phone-normalization";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// Webchat has no real WhatsApp business number to log as the bot's phone,
// so et_messages uses this fixed placeholder as the "other side" of the pair.
const WEBCHAT_BOT_PHONE = "webchat-assistant";

async function logWebchatMessages(params: {
  canonicalPhone: string;
  inboundText: string;
  inboundMessageType: string;
  reply: string;
}) {
  try {
    const channelSession = await ensureChannelSession();
    const idSuffix = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

    await insertEtMessage({
      channel: "webchat",
      externalMessageId: `webchat_in_${idSuffix}`,
      direction: "inbound",
      messageType: params.inboundMessageType,
      textContent: params.inboundText,
      rawPayload: { source: "web_chat" },
      senderPhone: params.canonicalPhone,
      recipientPhone: WEBCHAT_BOT_PHONE,
      channelSessionId: channelSession.id,
    });

    await insertEtMessage({
      channel: "webchat",
      externalMessageId: `webchat_out_${idSuffix}`,
      direction: "outbound",
      messageType: "text",
      textContent: params.reply,
      rawPayload: { source: "web_chat_agent_reply" },
      senderPhone: WEBCHAT_BOT_PHONE,
      recipientPhone: params.canonicalPhone,
      channelSessionId: channelSession.id,
    });
  } catch (error) {
    // Logging to et_messages must never break the user-facing chat reply.
    console.error("[web-chat] failed to log message to et_messages:", error instanceof Error ? error.message : error);
  }
}

const requestSchema = z
  .object({
    phone: z.string().trim().min(1).max(30),
    message: z.string().trim().max(2000).default(""),
    image: z
      .object({
        dataUrl: z.string().trim().min(1),
      })
      .optional(),
  })
  .refine((data) => data.message.length > 0 || data.image, {
    message: "Type a message or attach an image.",
  });

function isPlausibleMalaysiaMobile(canonicalPhone: string) {
  return /^60\d{9,11}$/.test(canonicalPhone);
}

function parseImageDataUrl(dataUrl: string) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;

  const [, contentType, base64] = match;
  const byteLength = Buffer.byteLength(base64, "base64");
  if (byteLength === 0 || byteLength > MAX_IMAGE_BYTES) return null;

  return { contentType, base64 };
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

  const caption = body.data.message;
  let agentText = caption;
  let displayText = caption;

  if (body.data.image) {
    const parsedImage = parseImageDataUrl(body.data.image.dataUrl);

    if (!parsedImage) {
      return NextResponse.json({ error: "Image is missing, unreadable, or too large (max 8 MB)." }, { status: 400 });
    }

    try {
      const converted = await convertVisualBytesToText({
        contentType: parsedImage.contentType,
        base64: parsedImage.base64,
        messageType: "image",
        caption,
      });
      agentText = `[System: User sent an image. Extracted content:]\n${converted}`;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      agentText =
        `[System: User sent an image. Conversion failed: ${reason}.]\n` +
        (caption ? `Caption: ${caption}\n` : "") +
        "Instruct the AI Agent to reply exactly with: '( Image failed to read ), can you write in text?'";
    }
    displayText = caption ? `(sent an image) ${caption}` : "(sent an image)";
  }

  try {
    const { reply } = await runWhatsappAgentTurnV2({ senderPhone: canonicalPhone, text: agentText });

    const now = new Date().toISOString();
    await appendConversation(canonicalPhone, [
      { role: "user", text: agentText, time: now },
      { role: "assistant", text: reply, time: now },
    ]);

    await logWebchatMessages({
      canonicalPhone,
      inboundText: agentText,
      inboundMessageType: body.data.image ? "image" : "text",
      reply,
    });

    return NextResponse.json({ reply, displayText });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return NextResponse.json({ error: `Unable to reach the referral assistant right now: ${message}` }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

import {
  isWhatsappAgentRequestAuthorized,
  processWhatsappAgentMessages,
  type WhatsappAgentMessageInput,
} from "@/lib/agent/whatsapp-processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

function createWebhookLogId() {
  return `wa_webhook_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

function getRequestLogContext(request: Request, logId: string) {
  const url = new URL(request.url);

  return {
    logId,
    method: request.method,
    pathname: url.pathname,
    search: url.search,
    userAgent: request.headers.get("user-agent") || "",
    contentType: request.headers.get("content-type") || "",
    xForwardedFor: request.headers.get("x-forwarded-for") || "",
  };
}

function logWebhook(event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    event,
    ...data,
  }));
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asRecord(value: unknown) {
  return isRecord(value) ? value : {};
}

function asRecordArray(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringFrom(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberStringFrom(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return stringFrom(value);
}

function pickString(source: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const value = stringFrom(source[key]);
    if (value) return value;
  }

  return "";
}

function getNestedRecord(source: JsonRecord, keys: string[]) {
  let current: unknown = source;

  for (const key of keys) {
    if (!isRecord(current)) return {};
    current = current[key];
  }

  return asRecord(current);
}

function extractGenericText(message: JsonRecord) {
  const direct = pickString(message, ["text", "body", "content", "contentPreview", "message", "caption"]);
  if (direct) return direct;

  const textObject = asRecord(message.text);
  const textBody = stringFrom(textObject.body);
  if (textBody) return textBody;

  const messageObject = asRecord(message.message);
  const conversation = stringFrom(messageObject.conversation);
  if (conversation) return conversation;

  const extendedText = getNestedRecord(messageObject, ["extendedTextMessage"]);
  const extendedTextValue = stringFrom(extendedText.text);
  if (extendedTextValue) return extendedTextValue;

  for (const key of ["imageMessage", "videoMessage", "documentMessage", "audioMessage", "stickerMessage", "contactMessage"]) {
    const nestedMessage = asRecord(messageObject[key]);
    const caption = pickString(nestedMessage, ["caption", "fileName", "displayName"]);
    if (caption) return caption;
  }

  return "";
}

function extractMediaUrl(message: JsonRecord) {
  const direct = pickString(message, ["mediaUrl", "media_url", "url", "path"]);
  if (direct) return direct;

  const messageObject = asRecord(message.message);
  for (const key of ["imageMessage", "videoMessage", "documentMessage", "audioMessage", "stickerMessage"]) {
    const nestedMessage = asRecord(messageObject[key]);
    const mediaUrl = pickString(nestedMessage, ["mediaUrl", "media_url", "url", "directPath"]);
    if (mediaUrl) return mediaUrl;
  }

  return "";
}

function inferGenericMessageType(message: JsonRecord) {
  const direct = pickString(message, ["messageType", "type", "message_type"]);
  if (direct) return direct;

  const messageObject = asRecord(message.message);
  const typeMap: Array<[string, string]> = [
    ["imageMessage", "image"],
    ["videoMessage", "video"],
    ["documentMessage", "document"],
    ["audioMessage", "audio"],
    ["stickerMessage", "sticker"],
    ["contactMessage", "contact"],
    ["contactsArrayMessage", "contacts"],
    ["extendedTextMessage", "text"],
  ];
  const found = typeMap.find(([key]) => Object.keys(asRecord(messageObject[key])).length > 0);

  return found?.[1] || "text";
}

function isFromMe(message: JsonRecord) {
  if (message.fromMe === true) return true;

  const key = asRecord(message.key);
  if (key.fromMe === true) return true;

  const direction = stringFrom(message.direction).toLowerCase();
  return direction === "outbound" || direction === "out";
}

function normalizeGenericMessage(message: JsonRecord, fallbackRecipientPhone = ""): WhatsappAgentMessageInput | null {
  // Never react to our own outbound messages — that would create a reply loop.
  if (isFromMe(message)) {
    return null;
  }

  const text = extractGenericText(message);
  const messageType = inferGenericMessageType(message);
  const mediaUrl = extractMediaUrl(message);
  const key = asRecord(message.key);
  const senderPhone =
    pickString(message, ["senderPhone", "from", "phone", "phoneNumber", "sender", "sender_phone", "remoteJid", "chatId", "jid"]) ||
    pickString(key, ["remoteJid", "participant"]);
  const externalMessageId =
    pickString(message, ["externalMessageId", "id", "messageId", "message_id"]) ||
    pickString(key, ["id"]) ||
    `${senderPhone || "unknown"}_${Date.now()}`;

  if (!senderPhone || (!text && messageType === "text" && !mediaUrl)) {
    return null;
  }

  return {
    externalMessageId,
    senderPhone,
    recipientPhone: pickString(message, ["recipientPhone", "to", "recipient", "recipient_phone"]) || fallbackRecipientPhone,
    messageType,
    text,
    mediaUrl,
    rawPayload: message,
  };
}

function normalizeMetaMessage(message: JsonRecord, value: JsonRecord): WhatsappAgentMessageInput | null {
  const textObject = asRecord(message.text);
  const interactive = asRecord(message.interactive);
  const button = asRecord(message.button);
  const listReply = getNestedRecord(interactive, ["list_reply"]);
  const buttonReply = getNestedRecord(interactive, ["button_reply"]);
  const text =
    stringFrom(textObject.body) ||
    stringFrom(asRecord(message.image).caption) ||
    stringFrom(asRecord(message.video).caption) ||
    stringFrom(asRecord(message.document).caption) ||
    stringFrom(asRecord(message.document).filename) ||
    stringFrom(listReply.title) ||
    stringFrom(listReply.id) ||
    stringFrom(buttonReply.title) ||
    stringFrom(buttonReply.id) ||
    stringFrom(button.text);
  const senderPhone = stringFrom(message.from);
  const messageType = stringFrom(message.type) || "text";

  if (!senderPhone || (!text && messageType === "text")) {
    return null;
  }

  const metadata = asRecord(value.metadata);

  return {
    externalMessageId: stringFrom(message.id) || `${senderPhone}_${Date.now()}`,
    senderPhone,
    recipientPhone: stringFrom(metadata.display_phone_number) || stringFrom(metadata.phone_number_id),
    messageType,
    text,
    rawPayload: { source: "meta_whatsapp_webhook", value, message },
  };
}

function normalizeMetaWebhook(body: JsonRecord) {
  const normalized: WhatsappAgentMessageInput[] = [];

  for (const entry of asRecordArray(body.entry)) {
    for (const change of asRecordArray(entry.changes)) {
      const value = asRecord(change.value);

      for (const message of asRecordArray(value.messages)) {
        const normalizedMessage = normalizeMetaMessage(message, value);
        if (normalizedMessage) {
          normalized.push(normalizedMessage);
        }
      }
    }
  }

  return normalized;
}

function normalizeWebhookPayload(payload: unknown) {
  const body = asRecord(payload);
  const normalized: WhatsappAgentMessageInput[] = [];

  normalized.push(...normalizeMetaWebhook(body));

  const fallbackRecipientPhone =
    pickString(body, ["recipientPhone", "to", "connectedNumber"]) ||
    numberStringFrom(body.connectedNumber);

  for (const message of asRecordArray(body.messages)) {
    const normalizedMessage = normalizeGenericMessage(message, fallbackRecipientPhone);
    if (normalizedMessage) {
      normalized.push(normalizedMessage);
    }
  }

  const singleMessage = asRecord(body.message);
  if (Object.keys(singleMessage).length > 0) {
    const mergedMessage = {
      ...singleMessage,
      senderPhone: pickString(singleMessage, ["senderPhone", "from", "phone", "phoneNumber"]) || pickString(body, ["senderPhone", "from", "phone", "phoneNumber"]),
      recipientPhone: pickString(singleMessage, ["recipientPhone", "to"]) || fallbackRecipientPhone,
    };
    const normalizedMessage = normalizeGenericMessage(mergedMessage, fallbackRecipientPhone);
    if (normalizedMessage) {
      normalized.push(normalizedMessage);
    }
  }

  const topLevelMessage = normalizeGenericMessage(body, fallbackRecipientPhone);
  if (topLevelMessage) {
    normalized.push(topLevelMessage);
  }

  const seen = new Set<string>();
  return normalized.filter((message) => {
    const key = `${message.externalMessageId}:${message.senderPhone}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function GET(request: Request) {
  const logId = createWebhookLogId();
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token") || "";
  const challenge = url.searchParams.get("hub.challenge");
  const expectedToken = process.env.WHATSAPP_AGENT_WEBHOOK_VERIFY_TOKEN?.trim();
  const logContext = getRequestLogContext(request, logId);

  logWebhook("whatsapp_agent_webhook_get_received", {
    ...logContext,
    mode,
    hasChallenge: Boolean(challenge),
    hasVerifyToken: Boolean(token),
    verifyTokenMatches: Boolean(expectedToken && token === expectedToken),
  });

  if (mode === "subscribe" && challenge && (!expectedToken || token === expectedToken)) {
    logWebhook("whatsapp_agent_webhook_get_verified", logContext);

    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return NextResponse.json({ ok: true, endpoint: "whatsapp-agent-webhook" });
}

export async function POST(request: Request) {
  if (!isWhatsappAgentRequestAuthorized(request, ["WHATSAPP_AGENT_WEBHOOK_SECRET", "WHATSAPP_AGENT_PROCESS_SECRET"])) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const logId = createWebhookLogId();
  const logContext = getRequestLogContext(request, logId);

  let payload: unknown = null;
  let payloadParseError = "";

  try {
    payload = await request.json();
  } catch (error) {
    payloadParseError = error instanceof Error ? error.message : String(error);
  }

  const messages = normalizeWebhookPayload(payload);
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "true";

  logWebhook("whatsapp_agent_webhook_post_received", {
    ...logContext,
    dryRun,
    payloadParseError,
    normalizedMessageCount: messages.length,
    normalizedMessages: messages.map((message) => ({
      externalMessageId: message.externalMessageId,
      senderPhone: message.senderPhone,
      recipientPhone: message.recipientPhone || "",
      messageType: message.messageType || "text",
      textLength: message.text?.length || 0,
      hasMediaUrl: Boolean(message.mediaUrl),
    })),
  });

  if (messages.length === 0) {
    logWebhook("whatsapp_agent_webhook_post_ignored", {
      ...logContext,
      reason: payloadParseError || "No supported inbound text messages found in webhook payload.",
    });

    return NextResponse.json({
      processed: 0,
      results: [],
      warning: "No supported inbound text messages found in webhook payload.",
    });
  }

  const results = await processWhatsappAgentMessages(messages, { dryRun });

  logWebhook("whatsapp_agent_webhook_post_processed", {
    ...logContext,
    processed: results.length,
    results,
  });

  return NextResponse.json({
    processed: results.length,
    results,
  });
}

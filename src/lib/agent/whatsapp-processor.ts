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
import { toCanonicalMalaysiaPhone } from "@/lib/phone-normalization";

export type WhatsappAgentMessageInput = {
  externalMessageId: string;
  senderPhone: string;
  recipientPhone?: string | null;
  messageType?: string;
  text: string;
  rawPayload?: Record<string, unknown>;
};

export type WhatsappProcessOptions = {
  dryRun?: boolean;
};

export function isWhatsappAgentRequestAuthorized(request: Request, secretNames: string[]) {
  const secrets = secretNames
    .map((name) => process.env[name]?.trim())
    .filter((secret): secret is string => Boolean(secret));

  if (secrets.length === 0) {
    return true;
  }

  const authorization = request.headers.get("authorization") || "";
  const webhookSecret = request.headers.get("x-webhook-secret") || "";
  const apiKey = request.headers.get("x-api-key") || "";

  return secrets.some(
    (secret) =>
      authorization === `Bearer ${secret}` ||
      webhookSecret === secret ||
      apiKey === secret,
  );
}

export async function processWhatsappAgentMessages(
  messages: WhatsappAgentMessageInput[],
  options: WhatsappProcessOptions = {},
) {
  const channelSession = await ensureChannelSession();
  const dryRun = Boolean(options.dryRun);
  const results = [];

  for (const message of messages) {
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
      if (!dryRun) {
        await insertEtMessage({
          externalMessageId: message.externalMessageId,
          direction: "inbound",
          messageType: message.messageType || "text",
          textContent: message.text,
          rawPayload: message.rawPayload || {},
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
          rawPayload: { source: "whatsapp_agent_webhook", inboundMessageId: message.externalMessageId, sendResult },
          senderPhone: recipientPhone,
          recipientPhone: senderPhone,
          channelSessionId: channelSession.id,
        });
      }

      results.push({
        id: message.externalMessageId,
        status: dryRun ? "dry_run" : "processed",
        senderPhone,
        text: message.text,
        reply,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown WhatsApp agent error.";
      results.push({ id: message.externalMessageId, status: "failed", error: errorMessage });
    }
  }

  return results;
}

export async function processPendingWhatsappInbound(input: {
  limit: number;
  afterId?: number;
  includeFailed?: boolean;
  dryRun?: boolean;
}) {
  const channelSession = await ensureChannelSession();
  const rows = await listPendingWhatsappInbound(input.limit, input.afterId || 0, Boolean(input.includeFailed));
  const results = [];
  const dryRun = Boolean(input.dryRun);

  for (const row of rows) {
    try {
      const text = extractTextFromPayload(row.raw_payload);
      const senderPhone = toCanonicalMalaysiaPhone(row.sender_phone || "");
      const recipientPhone = toCanonicalMalaysiaPhone(row.recipient_phone || "");

      if (!senderPhone) {
        if (!dryRun) {
          await markInboundFailed(row.id, "Missing sender phone.");
        }
        results.push({ id: row.id, status: "failed", reason: "missing_sender_phone" });
        continue;
      }

      if (!text) {
        if (!dryRun) {
          await markInboundProcessed(row.id, "");
        }
        results.push({ id: row.id, status: "skipped", reason: "non_text_message", messageType: row.message_type });
        continue;
      }

      const state = await loadAgentState(senderPhone);
      const reply = await runWhatsappAgentTurn({ senderPhone, text, state });

      let sendResult: unknown = null;
      if (!dryRun) {
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

      if (!dryRun) {
        await markInboundProcessed(row.id, reply);
      }
      results.push({
        id: row.id,
        status: dryRun ? "dry_run" : "processed",
        senderPhone,
        text,
        reply,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown WhatsApp agent error.";
      if (!dryRun) {
        await markInboundFailed(row.id, message);
      }
      results.push({ id: row.id, status: "failed", error: message });
    }
  }

  return results;
}

export { getLatestWhatsappInboundId };

import { ensureChannelSession, insertEtMessage } from "@/lib/agent/whatsapp-data";

// Webchat has no real WhatsApp business number to log as the bot's phone,
// so et_messages uses this fixed placeholder as the "other side" of the pair.
const WEBCHAT_BOT_PHONE = "webchat-assistant";

/**
 * Mirrors one webchat exchange into et_messages so the admin transcript views
 * see webchat traffic alongside WhatsApp. Never throws: a logging failure must
 * not cost the user their reply or their saved lead.
 */
export async function logWebchatExchange(params: {
  canonicalPhone: string;
  inboundText: string;
  inboundMessageType: string;
  reply: string;
  inboundSource?: string;
}) {
  try {
    const channelSession = await ensureChannelSession();
    const idSuffix = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const source = params.inboundSource || "web_chat";

    await insertEtMessage({
      channel: "webchat",
      externalMessageId: `webchat_in_${idSuffix}`,
      direction: "inbound",
      messageType: params.inboundMessageType,
      textContent: params.inboundText,
      rawPayload: { source },
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
      rawPayload: { source: `${source}_reply` },
      senderPhone: WEBCHAT_BOT_PHONE,
      recipientPhone: params.canonicalPhone,
      channelSessionId: channelSession.id,
    });
  } catch (error) {
    console.error("[web-chat] failed to log message to et_messages:", error instanceof Error ? error.message : error);
  }
}

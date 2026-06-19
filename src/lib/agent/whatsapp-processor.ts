import {
  appendConversation,
  ensureChannelSession,
  getWhatsappAgentRuntimeConfig,
  hasEtMessage,
  insertEtMessage,
  listUnrepliedWhatsappInboundMessages,
  sendWhatsappText,
} from "@/lib/agent/whatsapp-data";
import { runWhatsappAgentTurn, type WhatsappAgentMediaInput } from "@/lib/agent/whatsapp-flow";
import { toCanonicalMalaysiaPhone } from "@/lib/phone-normalization";

export type WhatsappAgentMessageInput = {
  externalMessageId: string;
  senderPhone: string;
  recipientPhone?: string | null;
  messageType?: string;
  text?: string;
  mediaUrl?: string | null;
  rawPayload?: Record<string, unknown>;
};

export type WhatsappProcessOptions = {
  dryRun?: boolean;
};

export type WhatsappPendingProcessOptions = WhatsappProcessOptions & {
  limit?: number;
  lookbackMinutes?: number;
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

function isRecord(value: unknown): value is Record<string, unknown> {
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

function normalizeMessageType(messageType: string | undefined) {
  return (messageType || "text").trim().toLowerCase();
}

function resolveWhatsappMediaUrl(mediaUrl: string) {
  const trimmed = mediaUrl.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  if (trimmed.startsWith("/")) {
    return `${getWhatsappAgentRuntimeConfig().baileysBaseUrl}${trimmed}`;
  }

  if (trimmed.startsWith("media/")) {
    return `${getWhatsappAgentRuntimeConfig().baileysBaseUrl}/${trimmed}`;
  }

  return trimmed;
}

function extractPhoneFromVcard(vcard: string) {
  const telLine = vcard
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^TEL/i.test(line));

  if (!telLine) return "";

  return telLine
    .replace(/^TEL[^:]*:/i, "")
    .replace(/[^\d+]/g, "")
    .trim();
}

function extractContactsFromPayload(rawPayload: Record<string, unknown>) {
  const payloadMessage = asRecord(rawPayload.message);
  const contactMessage = asRecord(payloadMessage.contactMessage);
  const contactsArrayMessage = asRecord(payloadMessage.contactsArrayMessage);
  const contacts = [
    contactMessage,
    ...asRecordArray(contactsArrayMessage.contacts),
    ...asRecordArray(rawPayload.contacts),
  ].filter((contact) => Object.keys(contact).length > 0);

  return contacts
    .map((contact) => {
      const displayName =
        stringFrom(contact.displayName) ||
        stringFrom(contact.name) ||
        stringFrom(contact.fullName) ||
        stringFrom(contact.formattedName);
      const vcard = stringFrom(contact.vcard);
      const phone =
        stringFrom(contact.phone) ||
        stringFrom(contact.phoneNumber) ||
        stringFrom(contact.waid) ||
        stringFrom(contact.wa_id) ||
        extractPhoneFromVcard(vcard);

      return { displayName, phone };
    })
    .filter((contact) => contact.displayName || contact.phone);
}

function getAudioMimeType(url: string, fallback = "audio/ogg") {
  const pathname = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();

  if (pathname.endsWith(".mp3")) return "audio/mpeg";
  if (pathname.endsWith(".m4a")) return "audio/mp4";
  if (pathname.endsWith(".mp4")) return "audio/mp4";
  if (pathname.endsWith(".wav")) return "audio/wav";
  if (pathname.endsWith(".webm")) return "audio/webm";
  if (pathname.endsWith(".oga") || pathname.endsWith(".ogg") || pathname.endsWith(".opus")) return "audio/ogg";
  return fallback;
}

function filenameFromMediaUrl(url: string, fallback: string) {
  try {
    const pathname = new URL(url).pathname;
    const name = pathname.split("/").filter(Boolean).pop();
    return name || fallback;
  } catch {
    const name = url.split(/[\\/]/).filter(Boolean).pop();
    return name || fallback;
  }
}

async function transcribeWhatsappAudio(mediaUrl: string) {
  const resolvedUrl = resolveWhatsappMediaUrl(mediaUrl);
  if (!resolvedUrl) return "";

  const audioResponse = await fetch(resolvedUrl, { cache: "no-store" });
  if (!audioResponse.ok) {
    throw new Error(`Unable to download WhatsApp audio: HTTP ${audioResponse.status}`);
  }

  const contentType = audioResponse.headers.get("content-type") || getAudioMimeType(resolvedUrl);
  const audioBytes = await audioResponse.arrayBuffer();
  const filename = filenameFromMediaUrl(resolvedUrl, "whatsapp-voice-note.ogg");
  const provider = (process.env.WHATSAPP_AGENT_ASR_PROVIDER || "").trim().toLowerCase();
  const geminiKey = process.env.WHATSAPP_AGENT_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "";
  const uniApiKey = process.env.WHATSAPP_AGENT_UNIAPI_API_KEY || process.env.UNIAPI_API_KEY || "";
  const audioBase64 = Buffer.from(audioBytes).toString("base64");

  if (provider === "uniapi" || provider === "uniapi-gemini" || (!provider && uniApiKey)) {
    if (!uniApiKey) {
      throw new Error("WHATSAPP_AGENT_UNIAPI_API_KEY (or UNIAPI_API_KEY) is not set.");
    }

    const baseUrl = (process.env.WHATSAPP_AGENT_UNIAPI_BASE_URL || process.env.UNIAPI_BASE_URL || "https://api.uniapi.io/gemini").replace(/\/$/, "");
    const model = process.env.WHATSAPP_AGENT_UNIAPI_ASR_MODEL || process.env.WHATSAPP_AGENT_ASR_MODEL || "gemini-2.5-flash";
    const response = await fetch(`${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": uniApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: "Transcribe this WhatsApp voice note exactly. Return only the transcript text. If the speech is not English, Malay, or Chinese, still transcribe in the original language.",
              },
              {
                inline_data: {
                  mime_type: contentType,
                  data: audioBase64,
                },
              },
            ],
          },
        ],
      }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`UniAPI ASR failed: HTTP ${response.status}: ${text.slice(0, 300)}`);
    }

    const payload = JSON.parse(text) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const transcript =
      payload.candidates?.[0]?.content?.parts
        ?.map((part) => part.text?.trim() || "")
        .filter(Boolean)
        .join("\n")
        .trim() || "";
    if (transcript) return transcript;
    throw new Error("UniAPI ASR returned an empty transcript.");
  }

  if (provider === "gemini" || (!provider && geminiKey)) {
    if (!geminiKey) {
      throw new Error("WHATSAPP_AGENT_GEMINI_API_KEY (or GEMINI_API_KEY) is not set.");
    }

    const model = process.env.WHATSAPP_AGENT_GEMINI_ASR_MODEL || process.env.WHATSAPP_AGENT_ASR_MODEL || "gemini-2.5-flash";
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text:
                    "Transcribe this WhatsApp voice note exactly. Return only the transcript text. If the speech is not English, Malay, or Chinese, still transcribe in the original language.",
                },
                {
                  inline_data: {
                    mime_type: contentType,
                    data: audioBase64,
                  },
                },
              ],
            },
          ],
        }),
      },
    );
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Gemini ASR failed: HTTP ${response.status}: ${text.slice(0, 300)}`);
    }

    const payload = JSON.parse(text) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const transcript =
      payload.candidates?.[0]?.content?.parts
        ?.map((part) => part.text?.trim() || "")
        .filter(Boolean)
        .join("\n")
        .trim() || "";
    if (transcript) return transcript;
    throw new Error("Gemini ASR returned an empty transcript.");
  }

  const asrUrl = process.env.WHATSAPP_AGENT_ASR_URL || "";
  const apiKey = process.env.WHATSAPP_AGENT_ASR_API_KEY || "";
  if (!asrUrl || !apiKey) {
    throw new Error("Voice-note transcription is not configured. Set WHATSAPP_AGENT_ASR_PROVIDER=uniapi with WHATSAPP_AGENT_UNIAPI_API_KEY, or set WHATSAPP_AGENT_ASR_URL and WHATSAPP_AGENT_ASR_API_KEY.");
  }

  const model = (process.env.WHATSAPP_AGENT_ASR_MODEL || "").trim();

  const buildForm = (includeModel: boolean) => {
    const form = new FormData();
    if (includeModel && model) {
      form.append("model", model);
    }
    const language = process.env.WHATSAPP_AGENT_ASR_LANGUAGE?.trim();
    if (language) {
      form.append("language", language);
    }
    form.append("response_format", "json");
    form.append("file", new Blob([audioBytes], { type: contentType }), filename);
    return form;
  };

  const attempts = [buildForm(true), buildForm(false)];
  let lastError = "";

  for (const body of attempts) {
    const response = await fetch(asrUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
    });
    const text = await response.text();
    if (!response.ok) {
      lastError = `HTTP ${response.status}: ${text.slice(0, 300)}`;
      continue;
    }

    try {
      const payload = JSON.parse(text) as { text?: unknown; transcript?: unknown; transcription?: unknown };
      const transcript = stringFrom(payload.text) || stringFrom(payload.transcript) || stringFrom(payload.transcription);
      if (transcript) return transcript;
    } catch {
      if (text.trim()) return text.trim();
    }
  }

  throw new Error(`MiniMax ASR failed: ${lastError || "empty transcript"}`);
}

async function prepareWhatsappInboundForAgent(message: WhatsappAgentMessageInput) {
  const messageType = normalizeMessageType(message.messageType);
  const text = (message.text || "").trim();
  const mediaUrl = resolveWhatsappMediaUrl(message.mediaUrl || "");
  const rawPayload = message.rawPayload || {};
  const media: WhatsappAgentMediaInput[] = [];

  if (messageType === "contact" || messageType === "contacts" || messageType === "contactmessage" || messageType === "contactsarraymessage") {
    const contacts = extractContactsFromPayload(rawPayload);
    if (contacts.length > 0) {
      const contactLines = contacts.map((contact, index) => {
        const name = contact.displayName || "(no name)";
        const phone = contact.phone || "(no phone)";
        return `${index + 1}. ${name} — ${phone}`;
      });

      return {
        text: [
        messageType === "contacts" ? "WhatsApp contact cards received:" : "WhatsApp contact card received:",
        ...contactLines,
        text ? `Preview: ${text}` : "",
        "Treat the contact card as lead details if it contains a phone number.",
      ]
        .filter(Boolean)
        .join("\n"),
        media,
      };
    }
  }

  if (messageType === "audio" || messageType === "ptt" || /voice/.test(text.toLowerCase())) {
    if (mediaUrl) {
      try {
        const transcript = await transcribeWhatsappAudio(mediaUrl);
        if (transcript) {
          return {
            text: [
              "WhatsApp voice note received and transcribed.",
              `Transcript: ${transcript}`,
              text && text.toLowerCase() !== "voice note" ? `Preview: ${text}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
            media,
          };
        }
      } catch (error) {
        return {
          text: [
            "WhatsApp voice note received.",
            text && text.toLowerCase() !== "voice note" ? `Preview: ${text}` : "",
            `Transcription failed: ${error instanceof Error ? error.message : "unknown error"}.`,
            "Ask the user to type the lead phone/name/area in text.",
          ]
            .filter(Boolean)
            .join("\n"),
          media,
        };
      }
    }

    return {
      text: [
      "WhatsApp voice note received.",
      text && text.toLowerCase() !== "voice note" ? `Preview: ${text}` : "",
      mediaUrl ? `Media file: ${mediaUrl}` : "",
      "No transcript is available. Ask the user to type the lead phone/name/area in text.",
    ]
      .filter(Boolean)
      .join("\n"),
      media,
    };
  }

  if (messageType === "image" && mediaUrl) {
    media.push({ type: "image", url: mediaUrl });
    return {
      text: [
        "WhatsApp image received. Inspect the attached image for referral lead details such as phone number, name, area, and preferred agent.",
        text ? `Caption/preview: ${text}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      media,
    };
  }

  if (messageType === "video" && mediaUrl) {
    media.push({ type: "video", url: mediaUrl });
    return {
      text: [
        "WhatsApp video received. Inspect the attached video for referral lead details such as phone number, name, area, and preferred agent.",
        text ? `Caption/preview: ${text}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      media,
    };
  }

  if (["document", "sticker"].includes(messageType)) {
    return {
      text: [
      `WhatsApp ${messageType} received.`,
      text ? `Caption/preview: ${text}` : "",
      mediaUrl ? `Media file: ${mediaUrl}` : "",
      "Use the filename/caption if it has lead details; otherwise ask for the details in text.",
    ]
      .filter(Boolean)
      .join("\n"),
      media,
    };
  }

  if (text) {
    return { text, media };
  }

  if (mediaUrl) {
    return {
      text: [
      `WhatsApp ${messageType || "media"} received.`,
      `Media file: ${mediaUrl}`,
      "Ask the user to send the referral details in text.",
    ].join("\n"),
      media,
    };
  }

  return { text: "", media };
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

      if (await hasEtMessage(`agent_reply_${message.externalMessageId}`, "outbound")) {
        results.push({ id: message.externalMessageId, status: "skipped", reason: "already_replied" });
        continue;
      }

      const agentInput = await prepareWhatsappInboundForAgent(message);
      const agentText = agentInput.text;
      const reply = await runWhatsappAgentTurn({ senderPhone, text: agentText, media: agentInput.media });

      let sendResult: unknown = null;
      if (!dryRun) {
        if (!(await hasEtMessage(message.externalMessageId, "inbound"))) {
          await insertEtMessage({
            externalMessageId: message.externalMessageId,
            direction: "inbound",
            messageType: message.messageType || "text",
            textContent: message.text || agentText,
            mediaUrl: message.mediaUrl || "",
            rawPayload: message.rawPayload || {},
            senderPhone,
            recipientPhone,
            channelSessionId: channelSession.id,
          });
        }

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

        await appendConversation(senderPhone, [
          { role: "user", text: agentText },
          { role: "assistant", text: reply },
        ]);
      }

      results.push({
        id: message.externalMessageId,
        status: dryRun ? "dry_run" : "processed",
        senderPhone,
        text: agentText,
        media: agentInput.media,
        reply,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown WhatsApp agent error.";
      results.push({ id: message.externalMessageId, status: "failed", error: errorMessage });
    }
  }

  return results;
}

export async function processPendingWhatsappAgentMessages(options: WhatsappPendingProcessOptions = {}) {
  const limit = Math.max(1, Math.min(options.limit || 10, 50));
  const lookbackMinutes = Math.max(1, options.lookbackMinutes || 60);
  const pending = await listUnrepliedWhatsappInboundMessages(limit, lookbackMinutes);

  return processWhatsappAgentMessages(
    pending.map((message) => ({
      externalMessageId: message.externalMessageId,
      senderPhone: message.senderPhone,
      recipientPhone: message.recipientPhone,
      messageType: message.messageType,
      text: message.textContent,
      mediaUrl: message.mediaUrl,
      rawPayload: {
        ...message.rawPayload,
        etMessageId: message.id,
        etMessageCreatedAt: message.createdAt,
      },
    })),
    options,
  );
}

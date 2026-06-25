import {
  appendConversation,
  ensureChannelSession,
  getWhatsappAgentRuntimeConfig,
  hasEtMessage,
  insertEtMessage,
  listUnrepliedWhatsappInboundMessages,
  sendWhatsappText,
} from "@/lib/agent/whatsapp-data";
import { runWhatsappAgentTurn } from "@/lib/agent/whatsapp-flow";
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

function getAudioMimeType(url: string) {
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
  return "audio/ogg";
}

function getVisualMimeType(url: string, messageType: "image" | "video") {
  const pathname = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();

  if (messageType === "image") {
    if (pathname.endsWith(".png")) return "image/png";
    if (pathname.endsWith(".webp")) return "image/webp";
    return "image/jpeg";
  }

  if (pathname.endsWith(".webm")) return "video/webm";
  if (pathname.endsWith(".mov")) return "video/quicktime";
  return "video/mp4";
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
  const provider = (process.env.WHATSAPP_AGENT_ASR_PROVIDER || "").trim().toLowerCase();
  if (provider !== "uniapi") {
    throw new Error("Voice-note transcription requires WHATSAPP_AGENT_ASR_PROVIDER=uniapi.");
  }

  const uniApiKey = process.env.WHATSAPP_AGENT_UNIAPI_API_KEY || "";
  if (!uniApiKey) {
    throw new Error("WHATSAPP_AGENT_UNIAPI_API_KEY is not set.");
  }

  const baseUrl = (process.env.WHATSAPP_AGENT_UNIAPI_BASE_URL || "").replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error("WHATSAPP_AGENT_UNIAPI_BASE_URL is not set.");
  }

  const model = process.env.WHATSAPP_AGENT_UNIAPI_ASR_MODEL || "";
  if (!model) {
    throw new Error("WHATSAPP_AGENT_UNIAPI_ASR_MODEL is not set.");
  }

  const audioBase64 = Buffer.from(audioBytes).toString("base64");
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

async function describeWhatsappVisual(mediaUrl: string, messageType: "image" | "video", caption: string) {
  const resolvedUrl = resolveWhatsappMediaUrl(mediaUrl);
  if (!resolvedUrl) return "";

  const mediaResponse = await fetch(resolvedUrl, { cache: "no-store" });
  if (!mediaResponse.ok) {
    throw new Error(`Unable to download WhatsApp ${messageType}: HTTP ${mediaResponse.status}`);
  }

  const rawContentType = mediaResponse.headers.get("content-type") || getVisualMimeType(resolvedUrl, messageType);
  const contentType = rawContentType.split(';')[0].trim();
  const mediaBase64 = Buffer.from(await mediaResponse.arrayBuffer()).toString("base64");

  const apiKey = process.env.WHATSAPP_AGENT_VISION_API_KEY || "sk-e277c1aed781df0c08d1df969d76a714e32c3a080477661a3004f71107c9222e";
  if (!apiKey) {
    throw new Error("Vision API key is not set.");
  }

  const baseUrl = (process.env.WHATSAPP_AGENT_VISION_BASE_URL || "https://api.apikey.fun/v1").replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error("Vision API base URL is not set.");
  }

  const model = process.env.WHATSAPP_AGENT_VISION_MODEL || "gpt-5.4-mini";

  const promptText = [
    `Convert this WhatsApp ${messageType} into plain text for a referral assistant.`,
    "Look specifically for referral contact details in name cards, business cards, handwritten notes, forms, screenshots, posters, chat screenshots, and cropped photos.",
    "OCR all visible text that may be a person name, company name, phone/mobile/WhatsApp number, location/area, address, or instruction such as call/contact/pass to/assign/PIC/preferred agent.",
    "Phone extraction is highest priority. Preserve country codes and leading zeroes. If multiple phone numbers are visible, list all of them and label the most likely lead phone if clear.",
    "Name extraction is second priority. Include names from handwritten text, name-card titles, contact screenshots, and labels near phone numbers. Keep Chinese, Malay, and English names exactly as visible.",
    "Area/location extraction is third priority. Include township, city, state, project/site area, or address if visible.",
    "Preferred-agent extraction is fourth priority. Only include it if the image/caption clearly indicates an agent/PIC/handler.",
    "Return only referral-relevant details in plain text using this format when possible: Lead name: ... | Lead phone: ... | Area: ... | Preferred agent: ... | Notes: ...",
    "If no referral lead details are visible, return exactly: No referral lead details visible.",
    caption ? `Caption: ${caption}` : "",
  ].filter(Boolean).join("\n");

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 60000); // 60 seconds timeout

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: promptText },
              {
                type: "image_url",
                image_url: {
                  url: `data:${contentType};base64,${mediaBase64}`
                }
              }
            ]
          }
        ]
      }),
      signal: abortController.signal
    });

    clearTimeout(timeoutId);

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Vision API failed: HTTP ${response.status}: ${text.slice(0, 300)}`);
    }

    const payload = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const converted = payload.choices?.[0]?.message?.content?.trim() || "";
    if (converted) return converted;
    throw new Error(`Vision API returned empty text.`);
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Vision API timed out after 60 seconds.`);
    }
    throw error;
  }
}

async function prepareWhatsappInboundForAgent(message: WhatsappAgentMessageInput) {
  const messageType = normalizeMessageType(message.messageType);
  const text = (message.text || "").trim();
  const mediaUrl = resolveWhatsappMediaUrl(message.mediaUrl || "");
  const rawPayload = message.rawPayload || {};

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
    };
  }

  if (messageType === "image" && mediaUrl) {
    try {
      const converted = await describeWhatsappVisual(mediaUrl, "image", text);
      return { text: `WhatsApp image received and converted to text.\n${converted}` };
    } catch (error) {
      return {
        text: [
          "WhatsApp image received.",
          text ? `Caption: ${text}` : "",
          `Image text conversion failed: ${error instanceof Error ? error.message : "unknown error"}.`,
          "Ask the user to type the lead phone/name/area in text.",
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }
  }

  if (messageType === "video" && mediaUrl) {
    try {
      const converted = await describeWhatsappVisual(mediaUrl, "video", text);
      return { text: `WhatsApp video received and converted to text.\n${converted}` };
    } catch (error) {
      return {
        text: [
          "WhatsApp video received.",
          text ? `Caption: ${text}` : "",
          `Video text conversion failed: ${error instanceof Error ? error.message : "unknown error"}.`,
          "Ask the user to type the lead phone/name/area in text.",
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }
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
    };
  }

  if (text) {
    return { text };
  }

  if (mediaUrl) {
    return {
      text: [
      `WhatsApp ${messageType || "media"} received.`,
      `Media file: ${mediaUrl}`,
      "Ask the user to send the referral details in text.",
    ].join("\n"),
    };
  }

  return { text: "" };
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
      const reply = await runWhatsappAgentTurn({ senderPhone, text: agentText });

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

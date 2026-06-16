// Single-path Baileys poller.
//
// Production ingestion model: this worker polls the Baileys server's /chats
// API for new inbound messages and forwards them to the app's /process route,
// which runs the Referral Assistant and sends the reply back through Baileys.
//
// There is intentionally only ONE ingestion path here. Do not also poll a DB
// queue or accept webhook pushes for the same messages — that caused duplicate
// replies in the past. De-duplication is enforced two ways:
//   1. locally via seen message ids + a timestamp watermark, and
//   2. server-side via et_messages (hasEtMessage) in the processor.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const appBaseUrl = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
const fallbackProcessUrl = appBaseUrl
  ? `${appBaseUrl}/api/whatsapp-agent/process`
  : "http://127.0.0.1:3000/api/whatsapp-agent/process";
const processUrl = process.env.WHATSAPP_AGENT_PROCESS_URL || fallbackProcessUrl;
const intervalMs = Number(process.env.WHATSAPP_AGENT_WORKER_INTERVAL_MS || 5000);
const limit = Number(process.env.WHATSAPP_AGENT_WORKER_LIMIT || 10);
const baileysBaseUrl = (process.env.WHATSAPP_AGENT_BAILEYS_BASE_URL || "https://ee-baileys-2.up.railway.app").replace(/\/$/, "");
const baileysSessionId = process.env.WHATSAPP_AGENT_BAILEYS_SESSION_ID || "0182920127";
const initialLookbackMs = Number(process.env.WHATSAPP_AGENT_BAILEYS_INITIAL_LOOKBACK_MS || 10 * 60 * 1000);
const watchedPhones = (process.env.WHATSAPP_AGENT_WATCH_PHONES || process.env.WHATSAPP_AGENT_SUPER_ADMIN_PHONES || "601121000099")
  .split(",")
  .map((value) => value.replace(/\D/g, ""))
  .filter(Boolean);
const statePath =
  process.env.WHATSAPP_AGENT_WORKER_STATE ||
  path.join(os.tmpdir(), "ee-referral-whatsapp-agent-worker-state.json");
const authorization = process.env.WHATSAPP_AGENT_PROCESS_SECRET
  ? `Bearer ${process.env.WHATSAPP_AGENT_PROCESS_SECRET}`
  : "";

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return {
      seenIds: Array.isArray(parsed.seenIds) ? parsed.seenIds : [],
      watermark: Number(parsed.watermark || 0),
    };
  } catch {
    return {
      seenIds: [],
      watermark: Math.floor((Date.now() - initialLookbackMs) / 1000),
    };
  }
}

function writeState(state) {
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        seenIds: (state.seenIds || []).slice(-500),
        watermark: Number(state.watermark || 0),
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

async function forwardToProcessor(messages) {
  if (messages.length === 0) return [];

  const response = await fetch(processUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify({ messages, dryRun: false }),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `Processor returned HTTP ${response.status}`);
  }

  return payload.results || [];
}

async function poll(state) {
  const chatsResponse = await fetch(`${baileysBaseUrl}/chats?sessionId=${encodeURIComponent(baileysSessionId)}`);
  const chatsPayload = await chatsResponse.json().catch(() => ({}));

  if (!chatsResponse.ok) {
    throw new Error(chatsPayload.error || `Baileys chats returned HTTP ${chatsResponse.status}`);
  }

  const seen = new Set(state.seenIds || []);
  const messagesToProcess = [];
  let watermark = Number(state.watermark || 0);

  const chatIds = new Set(
    (chatsPayload.chats || [])
      .filter((chat) => !chat.isGroup && chat.id && Number(chat.lastMessageTimestamp || 0) >= watermark)
      .slice(0, 30)
      .map((chat) => chat.id),
  );
  for (const phone of watchedPhones) {
    chatIds.add(`${phone}@s.whatsapp.net`);
  }

  for (const chatId of chatIds) {
    const response = await fetch(
      `${baileysBaseUrl}/chats/${encodeURIComponent(chatId)}/messages?sessionId=${encodeURIComponent(baileysSessionId)}&limit=10`,
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) continue;

    for (const message of payload.messages || []) {
      const timestamp = Number(message.timestamp || 0);
      const phone = message.phoneNumber || String(chatId).split("@")[0];
      const content = typeof message.content === "string" ? message.content.trim() : "";

      if (message.fromMe || !content || !phone || seen.has(message.id) || timestamp < watermark) {
        continue;
      }

      messagesToProcess.push({
        externalMessageId: message.id,
        senderPhone: phone,
        recipientPhone: chatsPayload.connectedNumber || "",
        messageType: message.type || "text",
        text: content,
        rawPayload: message,
      });
      seen.add(message.id);
      watermark = Math.max(watermark, timestamp);
    }
  }

  messagesToProcess.sort((a, b) => Number(a.rawPayload?.timestamp || 0) - Number(b.rawPayload?.timestamp || 0));
  const results = await forwardToProcessor(messagesToProcess.slice(0, limit));

  writeState({ seenIds: Array.from(seen), watermark });

  return results;
}

async function tick() {
  const state = readState();
  const results = await poll(state);

  if (results.length > 0) {
    console.log(JSON.stringify({ at: new Date().toISOString(), source: "baileys_poll", processed: results.length, results }));
  }
}

console.log(
  JSON.stringify({
    at: new Date().toISOString(),
    status: "started",
    processUrl,
    intervalMs,
    statePath,
    baileysBaseUrl,
    baileysSessionId,
    watchedPhones,
  }),
);

while (true) {
  try {
    await tick();
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }));
  }

  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}

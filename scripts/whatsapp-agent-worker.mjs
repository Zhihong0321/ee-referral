import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const processUrl = process.env.WHATSAPP_AGENT_PROCESS_URL || "http://localhost:3000/api/whatsapp-agent/process";
const intervalMs = Number(process.env.WHATSAPP_AGENT_WORKER_INTERVAL_MS || 5000);
const limit = Number(process.env.WHATSAPP_AGENT_WORKER_LIMIT || 10);
const baileysBaseUrl = (process.env.WHATSAPP_AGENT_BAILEYS_BASE_URL || "https://ee-baileys-2.up.railway.app").replace(/\/$/, "");
const baileysSessionId = process.env.WHATSAPP_AGENT_BAILEYS_SESSION_ID || "0182920127";
const baileysPollEnabled = process.env.WHATSAPP_AGENT_BAILEYS_POLL !== "false";
const baileysInitialLookbackMs = Number(process.env.WHATSAPP_AGENT_BAILEYS_INITIAL_LOOKBACK_MS || 24 * 60 * 60 * 1000);
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

function readAfterId() {
  return readState().afterId;
}

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return {
      afterId: Number(parsed.afterId || 0),
      baileysSeenIds: Array.isArray(parsed.baileysSeenIds) ? parsed.baileysSeenIds : [],
      baileysWatermark: Number(parsed.baileysWatermark || 0),
    };
  } catch {
    return {
      afterId: Number(process.env.WHATSAPP_AGENT_WORKER_AFTER_ID || 0),
      baileysSeenIds: [],
      baileysWatermark: Date.now() - baileysInitialLookbackMs,
    };
  }
}

function writeState(state) {
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        afterId: Number(state.afterId || 0),
        baileysSeenIds: (state.baileysSeenIds || []).slice(-500),
        baileysWatermark: Number(state.baileysWatermark || 0),
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

function writeAfterId(afterId) {
  writeState({ ...readState(), afterId });
}

async function processBaileysMessages(messages) {
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

async function pollBaileys(state) {
  if (!baileysPollEnabled) return [];

  const chatsResponse = await fetch(`${baileysBaseUrl}/chats?sessionId=${encodeURIComponent(baileysSessionId)}`);
  const chatsPayload = await chatsResponse.json().catch(() => ({}));

  if (!chatsResponse.ok) {
    throw new Error(chatsPayload.error || `Baileys chats returned HTTP ${chatsResponse.status}`);
  }

  const seen = new Set(state.baileysSeenIds || []);
  const messagesToProcess = [];
  let watermark = Number(state.baileysWatermark || 0);
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
  const results = await processBaileysMessages(messagesToProcess.slice(0, limit));

  writeState({
    ...state,
    baileysSeenIds: Array.from(seen),
    baileysWatermark: watermark,
  });

  return results;
}

async function tick() {
  let afterId = readAfterId();

  const response = await fetch(processUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify({ afterId, limit, dryRun: false }),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `Processor returned HTTP ${response.status}`);
  }

  for (const item of payload.results || []) {
    const numericId = Number(item.id);
    if (Number.isFinite(numericId) && numericId > afterId) {
      afterId = numericId;
    }
  }

  writeAfterId(afterId);

  if ((payload.results || []).length > 0) {
    console.log(JSON.stringify({ at: new Date().toISOString(), processed: payload.results.length, afterId, results: payload.results }));
  }

  const state = readState();
  state.afterId = afterId;
  const baileysResults = await pollBaileys(state);

  if (baileysResults.length > 0) {
    console.log(JSON.stringify({ at: new Date().toISOString(), source: "baileys_poll", processed: baileysResults.length, results: baileysResults }));
  }
}

console.log(JSON.stringify({ at: new Date().toISOString(), status: "started", processUrl, intervalMs, statePath, afterId: readAfterId(), baileysPollEnabled, baileysBaseUrl, baileysSessionId, watchedPhones }));

while (true) {
  try {
    await tick();
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }));
  }

  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}

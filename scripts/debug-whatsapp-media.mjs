#!/usr/bin/env node

// Read-only WhatsApp media debugger.
//
// Examples:
//   npm run whatsapp:debug-media -- summary
//   npm run whatsapp:debug-media -- pending --limit 20 --lookback 1440
//   npm run whatsapp:debug-media -- contacts --limit 20
//   npm run whatsapp:debug-media -- probe-url --id MESSAGE_ID
//   npm run whatsapp:debug-media -- asr --id MESSAGE_ID

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(rootDir, ".env.local"));
loadEnvFile(path.join(rootDir, ".env"));

const args = process.argv.slice(2);
const command = args.find((arg) => !arg.startsWith("--")) || "summary";

function flag(name, fallback = "") {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : "true";
}

function intFlag(name, fallback) {
  const value = Number(flag(name, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}

const jsonOutput = args.includes("--json");
const limit = Math.max(1, Math.min(intFlag("limit", 20), 100));
const lookback = Math.max(1, intFlag("lookback", Number(process.env.WHATSAPP_AGENT_DB_LOOKBACK_MINUTES || 60)));

function print(value) {
  if (jsonOutput) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  if (typeof value === "string") {
    console.log(value);
    return;
  }

  console.dir(value, { depth: null, colors: true });
}

function getConfig() {
  const proxyUrl = process.env.WHATSAPP_AGENT_PROXY_URL?.trim() || process.env.SANDBOX_PROXY_URL?.trim() || "";
  const proxyAuth = process.env.WHATSAPP_AGENT_PROXY_AUTH?.trim() || process.env.SANDBOX_PROXY_AUTH?.trim() || "";
  const dbName = process.env.WHATSAPP_AGENT_PROXY_DB_NAME?.trim() || process.env.SANDBOX_PROXY_DB_NAME?.trim() || "";
  const baileysBaseUrl = (process.env.WHATSAPP_AGENT_BAILEYS_BASE_URL || "https://ee-baileys-2.up.railway.app").replace(/\/$/, "");
  return {
    proxyUrl,
    proxyAuth,
    dbName,
    databaseUrl: process.env.DATABASE_URL || "",
    baileysBaseUrl,
    llmModel: process.env.WHATSAPP_AGENT_LLM_MODEL || "MiniMax-M3",
    hasLlmApiKey: Boolean(process.env.WHATSAPP_AGENT_LLM_API_KEY || process.env.MINIMAX_API_KEY),
    asrProvider:
      process.env.WHATSAPP_AGENT_ASR_PROVIDER ||
      (process.env.WHATSAPP_AGENT_UNIAPI_API_KEY || process.env.UNIAPI_API_KEY
        ? "uniapi"
        : process.env.WHATSAPP_AGENT_GEMINI_API_KEY || process.env.GEMINI_API_KEY
          ? "gemini"
          : "custom"),
    asrUrl: process.env.WHATSAPP_AGENT_ASR_URL || "",
    asrModel:
      process.env.WHATSAPP_AGENT_UNIAPI_ASR_MODEL ||
      process.env.WHATSAPP_AGENT_GEMINI_ASR_MODEL ||
      process.env.WHATSAPP_AGENT_ASR_MODEL ||
      (process.env.WHATSAPP_AGENT_ASR_PROVIDER === "gemini" || process.env.WHATSAPP_AGENT_ASR_PROVIDER === "uniapi" ? "gemini-2.5-flash" : ""),
    hasAsrApiKey: Boolean(process.env.WHATSAPP_AGENT_ASR_API_KEY || process.env.WHATSAPP_AGENT_GEMINI_API_KEY || process.env.GEMINI_API_KEY),
    hasUniApiKey: Boolean(process.env.WHATSAPP_AGENT_UNIAPI_API_KEY || process.env.UNIAPI_API_KEY),
    uniApiBaseUrl: (process.env.WHATSAPP_AGENT_UNIAPI_BASE_URL || process.env.UNIAPI_BASE_URL || "https://api.uniapi.io/gemini").replace(/\/$/, ""),
  };
}

function maskSecret(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 12) return "***";
  return `${text.slice(0, 8)}...${text.slice(-4)}`;
}

function publicConfig() {
  const config = getConfig();
  return {
    ...config,
    proxyAuth: config.proxyAuth ? maskSecret(config.proxyAuth) : "",
    databaseUrl: config.databaseUrl ? maskSecret(config.databaseUrl) : "",
  };
}

async function runSql(sql, params = []) {
  const config = getConfig();

  if (config.proxyUrl && config.proxyAuth && config.dbName) {
    const response = await fetch(`${config.proxyUrl.replace(/\/$/, "")}/api/sql`, {
      method: "POST",
      headers: {
        Authorization: config.proxyAuth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ db_name: config.dbName, sql, params }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) {
      throw new Error(payload.error || `SQL proxy HTTP ${response.status}`);
    }
    return payload.rows || [];
  }

  if (!config.databaseUrl) {
    throw new Error("No SQL access configured. Set WHATSAPP_AGENT_PROXY_* or DATABASE_URL.");
  }

  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const result = await pool.query(sql, params);
    return result.rows;
  } finally {
    await pool.end();
  }
}

function resolveMediaUrl(mediaUrl) {
  const trimmed = String(mediaUrl || "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return `${getConfig().baileysBaseUrl}${trimmed}`;
  if (trimmed.startsWith("media/")) return `${getConfig().baileysBaseUrl}/${trimmed}`;
  return trimmed;
}

function stringFrom(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asRecordArray(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) : [];
}

function extractPhoneFromVcard(vcard) {
  const telLine = String(vcard || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^TEL/i.test(line));

  if (!telLine) return "";
  return telLine.replace(/^TEL[^:]*:/i, "").replace(/[^\d+]/g, "").trim();
}

function extractContacts(rawPayload) {
  const payloadMessage = asRecord(rawPayload?.message);
  const contactMessage = asRecord(payloadMessage.contactMessage);
  const contactsArrayMessage = asRecord(payloadMessage.contactsArrayMessage);
  const contacts = [
    contactMessage,
    ...asRecordArray(contactsArrayMessage.contacts),
    ...asRecordArray(rawPayload?.contacts),
  ].filter((contact) => Object.keys(contact).length > 0);

  return contacts
    .map((contact) => {
      const vcard = stringFrom(contact.vcard);
      return {
        displayName:
          stringFrom(contact.displayName) ||
          stringFrom(contact.name) ||
          stringFrom(contact.fullName) ||
          stringFrom(contact.formattedName),
        phone:
          stringFrom(contact.phone) ||
          stringFrom(contact.phoneNumber) ||
          stringFrom(contact.waid) ||
          stringFrom(contact.wa_id) ||
          extractPhoneFromVcard(vcard),
      };
    })
    .filter((contact) => contact.displayName || contact.phone);
}

async function recentMessages(whereClause = "", params = []) {
  return runSql(
    `
      SELECT
        id::text,
        external_message_id,
        direction,
        message_type,
        left(COALESCE(text_content, ''), 300) AS text_content,
        media_url,
        sender_phone,
        recipient_phone,
        created_at::text
      FROM et_messages
      WHERE channel = 'whatsapp'
        ${whereClause}
      ORDER BY created_at DESC NULLS LAST, id DESC
      LIMIT $${params.length + 1}
    `,
    [...params, limit],
  );
}

async function pendingMessages() {
  return runSql(
    `
      SELECT
        inbound.id::text,
        inbound.external_message_id,
        inbound.message_type,
        left(COALESCE(inbound.text_content, ''), 300) AS text_content,
        inbound.media_url,
        inbound.sender_phone,
        inbound.recipient_phone,
        inbound.created_at::text
      FROM et_messages inbound
      WHERE inbound.channel = 'whatsapp'
        AND inbound.direction = 'inbound'
        AND inbound.sender_phone IS NOT NULL
        AND BTRIM(inbound.sender_phone) <> ''
        AND (inbound.recipient_phone IS NULL OR inbound.sender_phone <> inbound.recipient_phone)
        AND inbound.external_message_id IS NOT NULL
        AND BTRIM(inbound.external_message_id) <> ''
        AND inbound.message_type IN ('text', 'conversation', 'extendedTextMessage', 'audio', 'ptt', 'image', 'video', 'document', 'sticker', 'contact', 'contacts', 'contactMessage', 'contactsArrayMessage')
        AND inbound.created_at >= NOW() - ($2::int * INTERVAL '1 minute')
        AND NOT EXISTS (
          SELECT 1
          FROM et_messages outbound
          WHERE outbound.channel = 'whatsapp'
            AND outbound.direction = 'outbound'
            AND outbound.external_message_id = 'agent_reply_' || inbound.external_message_id
        )
      ORDER BY inbound.created_at ASC NULLS LAST, inbound.id ASC
      LIMIT $1
    `,
    [limit, lookback],
  );
}

async function inboxMessages() {
  return runSql(
    `
      SELECT
        id::text,
        session_identifier,
        external_message_id,
        sender_phone,
        recipient_phone,
        message_type,
        media_url,
        process_status,
        process_attempts,
        last_error,
        created_at::text
      FROM wa_inbound_inbox
      ORDER BY created_at DESC NULLS LAST, id DESC
      LIMIT $1
    `,
    [limit],
  );
}

async function findMessageById(idOrExternalId) {
  const rows = await runSql(
    `
      SELECT
        id::text,
        external_message_id,
        message_type,
        text_content,
        media_url,
        raw_payload,
        created_at::text
      FROM et_messages
      WHERE channel = 'whatsapp'
        AND (id::text = $1 OR external_message_id = $1)
      ORDER BY id DESC
      LIMIT 1
    `,
    [idOrExternalId],
  );
  return rows[0] || null;
}

async function probeUrl(url) {
  const resolved = resolveMediaUrl(url);
  if (!resolved) throw new Error("No media URL supplied.");

  let response = await fetch(resolved, { method: "HEAD" });
  if (!response.ok || response.status === 405) {
    response = await fetch(resolved, { headers: { Range: "bytes=0-0" } });
  }

  return {
    url: resolved,
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    contentLength: response.headers.get("content-length") || "",
  };
}

function filenameFromMediaUrl(url, fallback) {
  try {
    const name = new URL(url).pathname.split("/").filter(Boolean).pop();
    return name || fallback;
  } catch {
    return fallback;
  }
}

function audioMimeType(url, fallback = "audio/ogg") {
  const lower = url.toLowerCase();
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".webm")) return "audio/webm";
  if (lower.endsWith(".ogg") || lower.endsWith(".oga") || lower.endsWith(".opus")) return "audio/ogg";
  return fallback;
}

async function transcribeUrl(url) {
  const config = getConfig();
  if (!config.hasAsrApiKey && !config.hasUniApiKey) {
    throw new Error("No ASR key configured. Set WHATSAPP_AGENT_UNIAPI_API_KEY/UNIAPI_API_KEY, WHATSAPP_AGENT_GEMINI_API_KEY/GEMINI_API_KEY, or WHATSAPP_AGENT_ASR_API_KEY.");
  }

  const resolved = resolveMediaUrl(url);
  const audioResponse = await fetch(resolved);
  if (!audioResponse.ok) {
    throw new Error(`Audio download failed: HTTP ${audioResponse.status}`);
  }

  const bytes = await audioResponse.arrayBuffer();
  const contentType = audioResponse.headers.get("content-type") || audioMimeType(resolved);

  if (config.asrProvider === "uniapi" || config.asrProvider === "uniapi-gemini") {
    const key = process.env.WHATSAPP_AGENT_UNIAPI_API_KEY || process.env.UNIAPI_API_KEY;
    const model = config.asrModel || "gemini-2.5-flash";
    const response = await fetch(`${config.uniApiBaseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: "Transcribe this WhatsApp voice note exactly. Return only the transcript text." },
              { inline_data: { mime_type: contentType, data: Buffer.from(bytes).toString("base64") } },
            ],
          },
        ],
      }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`UniAPI ASR HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    const payload = JSON.parse(text);
    return {
      url: resolved,
      provider: "uniapi",
      endpoint: `${config.uniApiBaseUrl}/v1beta/models/${model}:generateContent`,
      model,
      transcript:
        payload.candidates?.[0]?.content?.parts
          ?.map((part) => part.text?.trim() || "")
          .filter(Boolean)
          .join("\n")
          .trim() || "",
      response: payload,
    };
  }

  if (config.asrProvider === "gemini") {
    const key = process.env.WHATSAPP_AGENT_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    const model = config.asrModel || "gemini-2.5-flash";
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: "Transcribe this WhatsApp voice note exactly. Return only the transcript text." },
                { inline_data: { mime_type: contentType, data: Buffer.from(bytes).toString("base64") } },
              ],
            },
          ],
        }),
      },
    );
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Gemini ASR HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    const payload = JSON.parse(text);
    return {
      url: resolved,
      provider: "gemini",
      model,
      transcript:
        payload.candidates?.[0]?.content?.parts
          ?.map((part) => part.text?.trim() || "")
          .filter(Boolean)
          .join("\n")
          .trim() || "",
      response: payload,
    };
  }

  if (!config.asrUrl || !process.env.WHATSAPP_AGENT_ASR_API_KEY) {
    throw new Error("Custom ASR requires WHATSAPP_AGENT_ASR_URL and WHATSAPP_AGENT_ASR_API_KEY.");
  }

  const form = new FormData();
  if (config.asrModel) form.append("model", config.asrModel);
  if (process.env.WHATSAPP_AGENT_ASR_LANGUAGE) form.append("language", process.env.WHATSAPP_AGENT_ASR_LANGUAGE);
  form.append("response_format", "json");
  form.append("file", new Blob([bytes], { type: contentType }), filenameFromMediaUrl(resolved, "whatsapp-voice-note.ogg"));

  const response = await fetch(config.asrUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_AGENT_ASR_API_KEY}`,
    },
    body: form,
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`ASR HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  try {
    return { url: resolved, response: JSON.parse(text) };
  } catch {
    return { url: resolved, response: text };
  }
}

async function main() {
  if (command === "help") {
    print([
      "WhatsApp media debug commands:",
      "  summary                         Show config, recent media/contact rows, pending rows, and inbox rows",
      "  recent                          Show recent WhatsApp et_messages rows",
      "  media                           Show recent media-bearing et_messages rows",
      "  contacts                        Show recent contact cards with extracted contacts",
      "  pending                         Show unreplied inbound et_messages rows",
      "  inbox                           Show recent wa_inbound_inbox rows",
      "  probe-url --id <id>             Resolve and HEAD/Range-check media_url for one message",
      "  probe-url --url <url>           Resolve and HEAD/Range-check one media URL",
      "  asr --id <id>                   Download one audio media_url and call ASR",
      "  asr --url <url>                 Download one audio URL and call ASR",
      "",
      "Flags:",
      "  --limit <n>                     Default 20, max 100",
      "  --lookback <minutes>            Default WHATSAPP_AGENT_DB_LOOKBACK_MINUTES or 60",
      "  --json                          Print JSON",
    ].join("\n"));
    return;
  }

  if (command === "summary") {
    const safe = async (fn) => {
      try {
        return await fn();
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    };

    const [recent, pending, inbox] = await Promise.all([
      safe(() =>
        recentMessages("AND (media_url IS NOT NULL OR message_type IN ('audio', 'image', 'video', 'document', 'sticker', 'contact', 'contacts'))"),
      ),
      safe(() => pendingMessages()),
      safe(() => inboxMessages()),
    ]);

    print({
      config: publicConfig(),
      lookbackMinutes: lookback,
      recentMediaOrContacts: recent,
      unrepliedInbound: pending,
      inboundInbox: inbox,
    });
    return;
  }

  if (command === "recent") {
    print(await recentMessages());
    return;
  }

  if (command === "media") {
    print(await recentMessages("AND (media_url IS NOT NULL OR message_type IN ('audio', 'image', 'video', 'document', 'sticker'))"));
    return;
  }

  if (command === "contacts") {
    const rows = await runSql(
      `
        SELECT id::text, external_message_id, message_type, text_content, raw_payload, created_at::text
        FROM et_messages
        WHERE channel = 'whatsapp'
          AND message_type IN ('contact', 'contacts', 'contactMessage', 'contactsArrayMessage')
        ORDER BY created_at DESC NULLS LAST, id DESC
        LIMIT $1
      `,
      [limit],
    );
    print(rows.map((row) => ({ ...row, extracted_contacts: extractContacts(row.raw_payload) })));
    return;
  }

  if (command === "pending") {
    print(await pendingMessages());
    return;
  }

  if (command === "inbox") {
    print(await inboxMessages());
    return;
  }

  if (command === "probe-url") {
    const id = flag("id");
    const url = flag("url");
    const message = id ? await findMessageById(id) : null;
    print(await probeUrl(url || message?.media_url || ""));
    return;
  }

  if (command === "asr") {
    const id = flag("id");
    const url = flag("url");
    const message = id ? await findMessageById(id) : null;
    print(await transcribeUrl(url || message?.media_url || ""));
    return;
  }

  throw new Error(`Unknown command "${command}". Use help, summary, recent, media, contacts, pending, inbox, probe-url, or asr.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

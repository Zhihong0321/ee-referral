// Single-path WhatsApp agent worker.
//
// Production ingestion model: Baileys promotes inbound WhatsApp messages into
// et_messages. This worker asks the app process route to claim unreplied
// inbound DB rows, run the Referral Assistant, and send the reply via Baileys.
//
// De-duplication is server-side: a message is considered handled once an
// outbound et_messages row exists with external_message_id =
// "agent_reply_" || inbound.external_message_id.

const appBaseUrl = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
const fallbackProcessUrl = appBaseUrl
  ? `${appBaseUrl}/api/whatsapp-agent/process`
  : "http://127.0.0.1:3000/api/whatsapp-agent/process";
const processUrl = process.env.WHATSAPP_AGENT_PROCESS_URL || fallbackProcessUrl;
const intervalMs = Number(process.env.WHATSAPP_AGENT_WORKER_INTERVAL_MS || 5000);
const limit = Number(process.env.WHATSAPP_AGENT_WORKER_LIMIT || 10);
const lookbackMinutes = Number(process.env.WHATSAPP_AGENT_DB_LOOKBACK_MINUTES || 60);
const authorization = process.env.WHATSAPP_AGENT_PROCESS_SECRET
  ? `Bearer ${process.env.WHATSAPP_AGENT_PROCESS_SECRET}`
  : "";

async function processPendingDbMessages() {
  const response = await fetch(processUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify({
      source: "database",
      dryRun: false,
      limit,
      lookbackMinutes,
    }),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `Processor returned HTTP ${response.status}`);
  }

  return payload;
}

async function tick() {
  const payload = await processPendingDbMessages();
  const results = payload.results || [];
  const preferredAgentNotificationsProcessed = Number(payload.preferredAgentNotificationsProcessed || 0);

  if (results.length > 0 || preferredAgentNotificationsProcessed > 0) {
    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        source: "et_messages",
        processed: results.length,
        preferredAgentNotificationsProcessed,
        results,
      }),
    );
  }
}

console.log(
  JSON.stringify({
    at: new Date().toISOString(),
    status: "started",
    processUrl,
    intervalMs,
    limit,
    lookbackMinutes,
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

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const processUrl = process.env.WHATSAPP_AGENT_PROCESS_URL || "http://localhost:3000/api/whatsapp-agent/process";
const intervalMs = Number(process.env.WHATSAPP_AGENT_WORKER_INTERVAL_MS || 5000);
const limit = Number(process.env.WHATSAPP_AGENT_WORKER_LIMIT || 10);
const statePath =
  process.env.WHATSAPP_AGENT_WORKER_STATE ||
  path.join(os.tmpdir(), "ee-referral-whatsapp-agent-worker-state.json");
const authorization = process.env.WHATSAPP_AGENT_PROCESS_SECRET
  ? `Bearer ${process.env.WHATSAPP_AGENT_PROCESS_SECRET}`
  : "";

function readAfterId() {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return Number(parsed.afterId || 0);
  } catch {
    return Number(process.env.WHATSAPP_AGENT_WORKER_AFTER_ID || -1);
  }
}

function writeAfterId(afterId) {
  fs.writeFileSync(statePath, JSON.stringify({ afterId, updatedAt: new Date().toISOString() }, null, 2));
}

async function tick() {
  let afterId = readAfterId();

  if (afterId < 0) {
    const response = await fetch(processUrl, {
      method: "GET",
      headers: {
        ...(authorization ? { Authorization: authorization } : {}),
      },
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || `Processor init returned HTTP ${response.status}`);
    }

    afterId = Number(payload.latestInboundId || 0);
    writeAfterId(afterId);
    console.log(JSON.stringify({ at: new Date().toISOString(), status: "initialized", afterId }));
    return;
  }

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
}

console.log(JSON.stringify({ at: new Date().toISOString(), status: "started", processUrl, intervalMs, statePath, afterId: readAfterId() }));

while (true) {
  try {
    await tick();
  } catch (error) {
    console.error(JSON.stringify({ at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }));
  }

  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}

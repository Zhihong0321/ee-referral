// Production entrypoint: run the Next server AND the Baileys polling worker
// in the same container. The worker is what feeds inbound WhatsApp messages
// into the Referral Assistant, so it MUST run alongside the server.
import { spawn } from "node:child_process";
import fs from "node:fs";

function start(name, command, args, env = process.env) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env,
  });

  child.on("exit", (code, signal) => {
    console.error(`${name} exited`, { code, signal });
    process.exit(code || 1);
  });

  return child;
}

// Next standalone build emits server.js at the app root; otherwise fall back
// to `next start`.
const nextServerArgs = fs.existsSync("server.js")
  ? ["server.js"]
  : ["node_modules/next/dist/bin/next", "start"];

start("next-server", "node", nextServerArgs);

setTimeout(() => {
  const port = process.env.PORT || "3000";
  const appBaseUrl = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  const processUrl =
    process.env.WHATSAPP_AGENT_PROCESS_URL ||
    (appBaseUrl ? `${appBaseUrl}/api/whatsapp-agent/process` : "") ||
    `http://127.0.0.1:${port}/api/whatsapp-agent/process`;

  start("whatsapp-worker", "node", ["scripts/whatsapp-agent-worker.mjs"], {
    ...process.env,
    WHATSAPP_AGENT_PROCESS_URL: processUrl,
  });
}, Number(process.env.WHATSAPP_AGENT_WORKER_START_DELAY_MS || 5000));

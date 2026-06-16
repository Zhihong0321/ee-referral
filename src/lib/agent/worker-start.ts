import { spawn, type ChildProcess } from "node:child_process";

declare global {
  // eslint-disable-next-line no-var
  var __eeWhatsappAgentWorker: ChildProcess | undefined;
}

export function ensureWhatsappAgentWorker() {
  if (process.env.WHATSAPP_AGENT_EMBEDDED_WORKER === "false") {
    return { started: false, reason: "disabled" };
  }

  if (global.__eeWhatsappAgentWorker && !global.__eeWhatsappAgentWorker.killed) {
    return { started: false, reason: "already_running", pid: global.__eeWhatsappAgentWorker.pid };
  }

  const port = process.env.PORT || "3000";
  const processUrl =
    process.env.WHATSAPP_AGENT_PROCESS_URL ||
    `http://127.0.0.1:${port}/api/whatsapp-agent/process`;

  const child = spawn(process.execPath, ["scripts/whatsapp-agent-worker.mjs"], {
    stdio: "inherit",
    env: {
      ...process.env,
      WHATSAPP_AGENT_PROCESS_URL: processUrl,
    },
  });

  global.__eeWhatsappAgentWorker = child;

  child.on("exit", (code, signal) => {
    console.error("embedded whatsapp worker exited", { code, signal });
    global.__eeWhatsappAgentWorker = undefined;
  });

  return { started: true, pid: child.pid, processUrl };
}

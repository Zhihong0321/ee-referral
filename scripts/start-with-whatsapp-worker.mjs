import { spawn } from "node:child_process";

function start(name, command, args) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    console.error(`${name} exited`, { code, signal });
    process.exit(code || 1);
  });

  return child;
}

start("next-server", "node", ["server.js"]);

setTimeout(() => {
  start("whatsapp-worker", "node", ["scripts/whatsapp-agent-worker.mjs"]);
}, Number(process.env.WHATSAPP_AGENT_WORKER_START_DELAY_MS || 5000));

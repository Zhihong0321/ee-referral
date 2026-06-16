import { spawn } from "node:child_process";
import fs from "node:fs";

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

const nextServerArgs = fs.existsSync("server.js")
  ? ["server.js"]
  : ["node_modules/next/dist/bin/next", "start"];

start("next-server", "node", nextServerArgs);

setTimeout(() => {
  start("whatsapp-worker", "node", ["scripts/whatsapp-agent-worker.mjs"]);
}, Number(process.env.WHATSAPP_AGENT_WORKER_START_DELAY_MS || 5000));

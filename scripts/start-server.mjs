import fs from "node:fs";
import { spawn } from "node:child_process";

const args = fs.existsSync("server.js")
  ? ["server.js"]
  : ["node_modules/next/dist/bin/next", "start"];

const server = spawn("node", args, { stdio: "inherit", env: process.env });

server.on("exit", (code, signal) => {
  console.error("next-server exited", { code, signal });
  process.exit(code || 1);
});

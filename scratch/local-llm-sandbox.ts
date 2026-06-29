import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

const rl = readline.createInterface({ input, output });

async function run() {
  const { runWhatsappAgentTurn } = await import("../src/lib/agent/whatsapp-flow");
  console.log("=== WhatsApp Agent Local Sandbox ===");

  const phone = await rl.question("Enter test phone number (e.g. 60123456789): ");
  
  if (!phone) {
    console.log("No phone provided. Exiting.");
    process.exit(1);
  }

  console.log(`\nStarted session for ${phone}. Type 'exit' to quit.\n`);
  console.log(`Hint: If you enter a known admin phone, you can type 'ee-admin' to enter admin mode.\n`);

  while (true) {
    const text = await rl.question("> ");
    if (text.trim().toLowerCase() === "exit") break;
    if (!text.trim()) continue;

    try {
      console.log("Thinking...");
      const result = await runWhatsappAgentTurn({ senderPhone: phone.trim(), text: text.trim() });
      
      console.log("\n[AGENT REPLY]");
      console.log(result.reply);
      
      if (result.toolTrace && result.toolTrace.length > 0) {
        console.log("\n[TOOL TRACE]");
        console.log(JSON.stringify(result.toolTrace, null, 2));
      }
      console.log("\n-----------------------------------\n");
    } catch (e: unknown) {
      console.error("\n[ERROR]", e instanceof Error ? e.message : e, "\n");
    }
  }

  rl.close();
  process.exit(0);
}

run().catch(console.error);

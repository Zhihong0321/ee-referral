import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

async function run() {
  const { runWhatsappAgentTurn } = await import("../src/lib/agent/whatsapp-flow");
  const adminPhone = "601121000099"; // Example admin phone, or use whatever admin phone is known
  console.log(`Starting automated test for Admin Tool Calling with phone: ${adminPhone}`);
  
  // Step 1: Trigger Admin Mode
  console.log("\n--- STEP 1: Enter Admin Mode ---");
  let res = await runWhatsappAgentTurn({ senderPhone: adminPhone, text: "ee-admin" });
  console.log("[AGENT]:", res.reply);

  // Step 2: Search for a referrer
  console.log("\n--- STEP 2: Search Referrer ---");
  res = await runWhatsappAgentTurn({ senderPhone: adminPhone, text: "Search for 01121000099" });
  console.log("[AGENT]:", res.reply);
  console.log("[TRACE]:", JSON.stringify(res.toolTrace, null, 2));

  // Step 3: Add a lead
  console.log("\n--- STEP 3: Add Lead ---");
  res = await runWhatsappAgentTurn({ senderPhone: adminPhone, text: "Add a lead for him. His name is Testing Bot, phone 0123456789 from KL." });
  console.log("[AGENT]:", res.reply);
  console.log("[TRACE]:", JSON.stringify(res.toolTrace, null, 2));

  console.log("\nTest complete.");
  process.exit(0);
}

run().catch(console.error);

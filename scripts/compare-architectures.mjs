/**
 * Compare V1 (Deterministic-First) vs V2 (LLM-First) Responses
 *
 * Usage:
 * node scripts/compare-architectures.mjs
 */

const TEST_CASES = [
  {
    name: "Simple onboarding",
    phone: "60199999001",
    message: "Hi, my name is Ahmad",
  },
  {
    name: "Multi-intent: onboard + create lead",
    phone: "60199999002",
    message: "Hi I'm Sarah, bank 1234567890. New lead: John 60123456789, KL area",
  },
  {
    name: "Create lead with agent",
    phone: "60199999003",
    message: "New customer: Warung Makan 0123456789, assign to agent Sarah",
  },
  {
    name: "Update with typo",
    phone: "60199999004",
    message: "updte lead 1 phon 60198765432",
  },
  {
    name: "Question about program",
    phone: "60199999005",
    message: "How much commission do I get?",
  },
  {
    name: "List leads",
    phone: "60199999006",
    message: "Show me my leads",
  },
];

async function callV1(phone, message) {
  const response = await fetch("http://localhost:3000/api/whatsapp-agent/inbound", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from: phone,
      text: message,
      dryRun: true, // Don't actually send WhatsApp messages
    }),
  });

  if (!response.ok) {
    return { error: `HTTP ${response.status}`, reply: null };
  }

  const data = await response.json();
  return {
    reply: data.reply || data.error || "No reply",
    toolTrace: data.toolTrace || [],
    deterministic: data.deterministic || false,
  };
}

async function callV2(phone, message) {
  const response = await fetch("http://localhost:3000/api/whatsapp-agent/test-v2", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, message }),
  });

  if (!response.ok) {
    return { error: `HTTP ${response.status}`, reply: null };
  }

  const data = await response.json();
  return {
    reply: data.reply || data.error || "No reply",
    toolTrace: data.toolTrace || [],
    toolCount: data.toolCount || 0,
  };
}

async function compareArchitectures() {
  console.log("=".repeat(80));
  console.log("V1 (Deterministic-First) vs V2 (LLM-First) Comparison");
  console.log("=".repeat(80));
  console.log();

  for (const testCase of TEST_CASES) {
    console.log(`\n${"─".repeat(80)}`);
    console.log(`TEST: ${testCase.name}`);
    console.log(`MESSAGE: "${testCase.message}"`);
    console.log(`${"─".repeat(80)}\n`);

    // Call V1
    console.log("V1 (Deterministic-First):");
    const v1Result = await callV1(testCase.phone, testCase.message);
    if (v1Result.error) {
      console.log(`  ❌ ERROR: ${v1Result.error}`);
    } else {
      console.log(`  Deterministic: ${v1Result.deterministic ? "YES" : "NO (LLM fallback)"}`);
      console.log(`  Tools called: ${v1Result.toolTrace.length}`);
      console.log(`  Reply: "${v1Result.reply.slice(0, 200)}${v1Result.reply.length > 200 ? "..." : ""}"`);
    }

    // Call V2
    console.log("\nV2 (LLM-First):");
    const v2Result = await callV2(testCase.phone, testCase.message);
    if (v2Result.error) {
      console.log(`  ❌ ERROR: ${v2Result.error}`);
    } else {
      console.log(`  Tools called: ${v2Result.toolCount}`);
      if (v2Result.toolTrace.length > 0) {
        console.log(`  Tool trace: ${v2Result.toolTrace.map(t => `${t.name}(${t.status})`).join(" → ")}`);
      }
      console.log(`  Reply: "${v2Result.reply.slice(0, 200)}${v2Result.reply.length > 200 ? "..." : ""}"`);
    }

    // Wait a bit between tests
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log("\n" + "=".repeat(80));
  console.log("Comparison complete!");
  console.log("=".repeat(80));
}

// Run comparison
compareArchitectures().catch(console.error);

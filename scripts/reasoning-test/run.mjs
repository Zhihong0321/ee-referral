/**
 * Reasoning stress-test runner for the V2 WhatsApp agent.
 *
 * Runs real LLM turns (see env.mjs for the MiMo provider override) and real
 * DB writes against prod_main through the SQL proxy, using ZZTEST-prefixed
 * test data only. Always cleans up, even on crash.
 *
 * Usage:
 *   node --import ./scripts/reasoning-test/alias-loader.mjs scripts/reasoning-test/run.mjs
 */
import { loadEnv } from "./env.mjs";
loadEnv(process.cwd());

const { runScenario, cleanupTestData } = await import("./harness.mjs");
const { buildScenarios } = await import("./scenarios.mjs");

function hr(char = "=") {
  console.log(char.repeat(78));
}

async function main() {
  console.log("Building scenarios (reads real agent roster, read-only)...");
  const scenarios = await buildScenarios();
  console.log(`${scenarios.length} scenarios ready.\n`);

  const results = [];
  for (const scenario of scenarios) {
    hr();
    console.log(`SCENARIO: ${scenario.name}`);
    hr();
    const ctx = {};
    let result;
    try {
      result = await runScenario(scenario, ctx, (line) => console.log(line));
    } catch (error) {
      console.log(`  SCENARIO CRASHED: ${error?.stack || error}`);
      result = { name: scenario.name, passed: false, checkTotal: 0, checkPassed: 0, turns: [], crashed: String(error) };
    }
    results.push(result);
    console.log(`  -> ${result.passed ? "PASS" : "FAIL"} (${result.checkPassed}/${result.checkTotal} checks)\n`);
  }

  hr("#");
  console.log("SUMMARY");
  hr("#");
  let totalPass = 0;
  let totalChecks = 0;
  for (const r of results) {
    totalPass += r.checkPassed;
    totalChecks += r.checkTotal;
    console.log(`  [${r.passed ? "PASS" : "FAIL"}] ${r.name}  (${r.checkPassed}/${r.checkTotal})`);
  }
  console.log(`\nTOTAL: ${totalPass}/${totalChecks} checks passed across ${results.length} scenarios.`);
  const failedScenarios = results.filter((r) => !r.passed);
  if (failedScenarios.length) {
    console.log(`\n${failedScenarios.length} scenario(s) had failing checks:`);
    for (const r of failedScenarios) {
      for (const t of r.turns) {
        for (const c of t.checks || []) {
          if (!c.pass) console.log(`  - [${r.name}] turn ${t.turn}: ${c.label}${c.note ? ` — ${c.note}` : ""}`);
        }
      }
      if (r.crashed) console.log(`  - [${r.name}] CRASHED: ${r.crashed}`);
    }
  }

  return failedScenarios.length === 0;
}

let ok = false;
try {
  ok = await main();
} finally {
  console.log("\nCleaning up test data...");
  try {
    const cleaned = await cleanupTestData();
    console.log("Cleanup:", cleaned);
  } catch (error) {
    console.error("CLEANUP FAILED — manual cleanup may be needed:", error);
  }
}

process.exit(ok ? 0 : 1);

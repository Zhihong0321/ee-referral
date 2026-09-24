/**
 * Smoke test: confirms the harness plumbing works end-to-end (env, alias
 * loader, real LLM call, real DB write, cleanup) before running the full
 * reasoning stress suite. Run:
 *   node --import ./scripts/reasoning-test/alias-loader.mjs scripts/reasoning-test/smoke.mjs
 */
import { loadEnv } from "./env.mjs";
loadEnv(process.cwd());

const { runTurn, TEST_PHONE_PREFIX, cleanupTestData } = await import("./harness.mjs");

const phone = `${TEST_PHONE_PREFIX}0001`;

console.log("Running smoke turn...");
const r1 = await runTurn(phone, "Hi, my name is ZZTEST Smoke and my bank account is Maybank 111222333");
console.log("Reply:", r1.reply);
console.log("Tools:", r1.toolTrace.map((t) => `${t.name}:${t.status}`).join(", ") || "(none)");

const r2 = await runTurn(phone, "New lead: ZZTEST Lead One, 0123450001, Semenyih area");
console.log("\nReply:", r2.reply);
console.log("Tools:", r2.toolTrace.map((t) => `${t.name}:${t.status}`).join(", ") || "(none)");

console.log("\nCleaning up...");
const cleaned = await cleanupTestData();
console.log("Cleanup result:", cleaned);

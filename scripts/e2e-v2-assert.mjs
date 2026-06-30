/**
 * Assertion harness for the LLM-first WhatsApp agent (V2).
 *
 * Unlike e2e-v2.mjs (which prints output for a human to eyeball), this harness
 * declares the EXPECTED database state for each scenario and auto-diffs it
 * against what actually landed in prod_main. It fails red on mismatch, so the
 * three bugs found earlier (wrong-lead assignment, phantom save, create-vs-
 * update overwrite) are caught mechanically.
 *
 * It runs against a DEDICATED TEST PHONE (not a real referrer) so created rows
 * are isolated and identifiable. Every lead it creates is reported at the end
 * with a single cleanup SQL statement (deletes are not auto-run: prod writes
 * require explicit human approval).
 *
 * Usage:  node scripts/e2e-v2-assert.mjs [testPhone]
 */

import fs from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const BASE = "http://localhost:3000";
const TEST_PHONE = process.argv[2] || "60119900TEST".replace(/\D/g, "") || "601199000001";
const PROXY_SQL = "https://pg-proxy-production.up.railway.app/api/sql";

// ---- read proxy auth from .env.local for DB assertions ----
function envVal(key) {
  const line = fs.readFileSync(".env.local", "utf8").split(/\r?\n/).find((l) => l.startsWith(key + "="));
  if (!line) return "";
  return line.slice(key.length + 1).replace(/^"|"$/g, "");
}
const PROXY_AUTH = envVal("WHATSAPP_AGENT_PROXY_AUTH");
const DB_NAME = envVal("WHATSAPP_AGENT_PROXY_DB_NAME") || "prod_main";

async function sql(query, params = []) {
  const res = await fetch(PROXY_SQL, {
    method: "POST",
    headers: { Authorization: PROXY_AUTH, "Content-Type": "application/json" },
    body: JSON.stringify({ db_name: DB_NAME, sql: query, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error("SQL error: " + json.error);
  return json.rows || [];
}

async function agent(message) {
  const res = await fetch(`${BASE}/api/whatsapp-agent/test-v2`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: TEST_PHONE, message }),
  });
  const json = await res.json();
  return { status: res.status, ...json };
}

// Snapshot the test referrer's leads as a map: id -> {name, phone, agent}.
async function snapshotLeads() {
  const rows = await sql(
    `SELECT r.id, r.name, r.mobile_number, r.linked_agent
       FROM referral r
       JOIN customer c ON c.customer_id = r.linked_customer_profile
      WHERE regexp_replace(COALESCE(c.phone,''),'\\D','','g') LIKE $1`,
    [`%${TEST_PHONE.replace(/^60/, "")}%`],
  );
  const map = new Map();
  for (const r of rows) map.set(r.id, { name: r.name, phone: r.mobile_number, agent: r.linked_agent });
  return map;
}

// ---- assertion bookkeeping ----
let passed = 0;
let failed = 0;
const failures = [];
function check(label, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    failures.push(`${label} — ${detail}`);
    console.log(`  FAIL  ${label}  :: ${detail}`);
  }
}

// A reply must never claim a write that no successful write tool performed.
const WRITE_CLAIM =
  /\b(done|all set|added|saved|updated|assigned|registered|notified|created|cancelled|canceled)\b/i;
const WRITE_TOOLS = new Set(["save_my_profile", "create_lead", "update_lead", "admin_create_referrer", "admin_add_lead"]);
function assertNoPhantom(label, res) {
  const claimed = WRITE_CLAIM.test(res.reply || "");
  const reallyWrote = (res.toolTrace || []).some((t) => WRITE_TOOLS.has(t.name) && t.status === "success");
  // If the reply claims a write, a real successful write must back it.
  check(`${label}: no phantom write-claim`, !claimed || reallyWrote,
    `reply claims write but no successful write tool ran. reply="${(res.reply || "").slice(0, 120)}" tools=${JSON.stringify((res.toolTrace || []).map((t) => t.name + ":" + t.status))}`);
}

const OCR_NEW_BUSINESS =
  "[System: User sent an image. Extracted content:]\n" +
  "Lead name: NR Health Enterprise (Kopi Pak Mentua) | Lead phone: 016-238 1639 | " +
  "Area: Semenyih, Selangor | Notes: Health consultant";

const createdLeadIds = new Set();
function trackCreated(before, after) {
  for (const id of after.keys()) if (!before.has(id)) createdLeadIds.add(id);
}

async function main() {
  console.log(`ASSERT HARNESS — test phone ${TEST_PHONE}\n`);

  // Ensure the test referrer has a known name so onboarding-state is stable.
  await agent("Hi, my name is QA Tester and my bank account is TestBank 99999999");
  await sleep(200);

  // ---------------------------------------------------------------------------
  // SCENARIO 1 — create a brand-new lead (baseline create works)
  // ---------------------------------------------------------------------------
  console.log("SCENARIO 1 — create new lead");
  let before = await snapshotLeads();
  const r1 = await agent("New lead: Ahmad Test, phone 0123000111, Cheras area");
  await sleep(400);
  let after = await snapshotLeads();
  trackCreated(before, after);
  const newOnes1 = [...after.keys()].filter((id) => !before.has(id));
  check("S1: exactly one lead created", newOnes1.length === 1, `created ${newOnes1.length}: ${newOnes1}`);
  if (newOnes1.length === 1) {
    const lead = after.get(newOnes1[0]);
    check("S1: phone normalized correctly", lead.phone === "60123000111", `got ${lead.phone}`);
  }
  assertNoPhantom("S1", r1);

  // ---------------------------------------------------------------------------
  // SCENARIO 2 — Bug C: a NEW-business image must CREATE, never overwrite
  // ---------------------------------------------------------------------------
  console.log("SCENARIO 2 — image of new business must create, not overwrite (Bug C)");
  before = await snapshotLeads();
  const beforeNames = new Map([...before].map(([id, v]) => [id, v.name]));
  const r2 = await agent(OCR_NEW_BUSINESS);
  await sleep(400);
  after = await snapshotLeads();
  trackCreated(before, after);
  const newOnes2 = [...after.keys()].filter((id) => !before.has(id));
  check("S2: a new lead was created (not an overwrite)", newOnes2.length === 1, `created ${newOnes2.length}`);
  // No pre-existing lead's name may have changed to the business name.
  let overwritten = false;
  for (const [id, oldName] of beforeNames) {
    const now = after.get(id);
    if (now && now.name !== oldName) overwritten = true;
  }
  check("S2: no existing lead was overwritten", !overwritten, "an existing lead's name changed");
  assertNoPhantom("S2", r2);

  // ---------------------------------------------------------------------------
  // SCENARIO 3 — Bug A: assign agent hits the RIGHT lead, no collateral change
  // ---------------------------------------------------------------------------
  console.log("SCENARIO 3 — assign agent to a specific lead, no collateral (Bug A)");
  before = await snapshotLeads();
  const agentsBefore = new Map([...before].map(([id, v]) => [id, v.agent]));
  // Create a fresh, uniquely-named lead WITH an agent in one turn.
  const r3 = await agent("Add lead Zarina Unique99, phone 0123000222, assign to agent Zhi Hong");
  await sleep(500);
  after = await snapshotLeads();
  trackCreated(before, after);
  const newOnes3 = [...after.keys()].filter((id) => !before.has(id));
  check("S3: exactly one lead created", newOnes3.length === 1, `created ${newOnes3.length}`);
  if (newOnes3.length === 1) {
    const lead = after.get(newOnes3[0]);
    check("S3: the NEW lead got an agent assigned", !!lead.agent, `agent=${lead.agent}`);
  }
  // No previously-existing lead's agent may have changed.
  let collateral = false;
  for (const [id, oldAgent] of agentsBefore) {
    const now = after.get(id);
    if (now && (now.agent || null) !== (oldAgent || null)) collateral = true;
  }
  check("S3: no other lead's agent changed", !collateral, "an unrelated lead's agent changed");
  assertNoPhantom("S3", r3);

  // ---------------------------------------------------------------------------
  // SCENARIO 4 — Bug A part 2: update_lead must refuse a hallucinated number
  // (model cannot update without listing first; harness verifies via no-change)
  // ---------------------------------------------------------------------------
  console.log("SCENARIO 4 — duplicate phone must NOT create a second lead (Bug C dup guard)");
  before = await snapshotLeads();
  const r4 = await agent("New lead: Ahmad Test again, phone 0123000111");
  await sleep(400);
  after = await snapshotLeads();
  trackCreated(before, after);
  const newOnes4 = [...after.keys()].filter((id) => !before.has(id));
  check("S4: duplicate phone did NOT create a new lead", newOnes4.length === 0, `created ${newOnes4.length}`);
  assertNoPhantom("S4", r4);

  // ---------------------------------------------------------------------------
  // SCENARIO 5 — admin tools must be unavailable to a non-admin phone
  // ---------------------------------------------------------------------------
  console.log("SCENARIO 5 — non-admin cannot use admin tools");
  const r5 = await agent("ee-admin");
  await sleep(300);
  const usedAdmin = (r5.toolTrace || []).some((t) => t.name.startsWith("admin_") && t.status === "success");
  check("S5: no admin tool succeeded for non-admin", !usedAdmin, `tools=${JSON.stringify((r5.toolTrace || []).map((t) => t.name + ":" + t.status))}`);
  assertNoPhantom("S5", r5);

  // ---- summary ----
  console.log("\n" + "=".repeat(70));
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log("  - " + f);
  }
  if (createdLeadIds.size) {
    const ids = [...createdLeadIds].join(",");
    console.log(`\nTest leads created (ids): ${ids}`);
    console.log("Cleanup SQL (run manually with approval):");
    console.log(`  DELETE FROM customer WHERE customer_id IN (SELECT linked_invoice FROM referral WHERE id IN (${ids}));`);
    console.log(`  DELETE FROM referral WHERE id IN (${ids});`);
  }
  console.log("=".repeat(70));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });

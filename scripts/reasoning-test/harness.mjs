/**
 * Reasoning-test harness core: runs real V2 agent turns (real LLM, real DB
 * through the SQL proxy), mimicking exactly what the processor does around
 * the flow (appendConversation after each turn). WhatsApp is unplugged by
 * env.mjs before any src module loads.
 *
 * All test data is namespaced so it can be wiped:
 *   - every phone starts with TEST_PHONE_PREFIX (60110000 + 4 digits)
 *   - every human name starts with "ZZTEST"
 */
import { runWhatsappAgentTurnV2 } from "../../src/lib/agent/whatsapp-flow-v2.ts";
import {
  appendConversation,
  listWhatsappAgents,
  listWhatsappReferralsByReferrerPhone,
  searchReferrerByPhone,
  createReferrerOnBehalf,
  runWhatsappAgentSql,
  ensureChannelSession,
  getWhatsappAgentRuntimeConfig,
} from "../../src/lib/agent/whatsapp-data.ts";

export const TEST_PHONE_PREFIX = "60110000";
export const TEST_NAME_PREFIX = "ZZTEST";

// ---------------------------------------------------------------------------
// Turn runner
// ---------------------------------------------------------------------------

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms).unref?.()),
  ]);
}

export async function runTurn(phone, text, { timeoutMs = 120_000 } = {}) {
  const started = Date.now();
  const result = await withTimeout(runWhatsappAgentTurnV2({ senderPhone: phone, text }), timeoutMs, "agent turn");
  // Mimic the processor: the flow itself does not persist conversation turns.
  const now = new Date().toISOString();
  await appendConversation(phone, [
    { role: "user", text, time: now },
    { role: "assistant", text: result.reply, time: now },
  ]);
  return { ...result, say: text, ms: Date.now() - started };
}

// ---------------------------------------------------------------------------
// Check DSL — each check gets (turnResult, ctx) and may be async
// ---------------------------------------------------------------------------

export const check = (label, fn) => ({ label, fn });

const summarizeTools = (t) => t.toolTrace.map((c) => `${c.name}:${c.status}`).join(", ") || "(no tools)";

export const toolCalled = (name, inputPred) =>
  check(`tool ${name} succeeded${inputPred ? " with expected input" : ""}`, (t) => {
    const calls = t.toolTrace.filter((c) => c.name === name && c.status === "success");
    if (calls.length === 0) return { pass: false, note: summarizeTools(t) };
    if (inputPred && !calls.some((c) => inputPred(c.input, c.result))) {
      return { pass: false, note: `inputs: ${JSON.stringify(calls.map((c) => c.input))}` };
    }
    return { pass: true };
  });

export const toolNotCalled = (name) =>
  check(`tool ${name} NOT successfully called`, (t) => {
    const hit = t.toolTrace.some((c) => c.name === name && c.status === "success");
    return hit ? { pass: false, note: summarizeTools(t) } : { pass: true };
  });

export const replyMatches = (re, why = "") =>
  check(`reply matches ${re}${why ? ` (${why})` : ""}`, (t) =>
    re.test(t.reply) ? { pass: true } : { pass: false, note: `reply: ${t.reply.slice(0, 220)}` });

export const replyNotMatches = (re, why = "") =>
  check(`reply does NOT match ${re}${why ? ` (${why})` : ""}`, (t) =>
    re.test(t.reply) ? { pass: false, note: `reply: ${t.reply.slice(0, 220)}` } : { pass: true });

export const anyOf = (...checks) =>
  check(`any of: ${checks.map((c) => c.label).join(" | ")}`, async (t, ctx) => {
    const notes = [];
    for (const c of checks) {
      const r = await c.fn(t, ctx);
      const pass = typeof r === "boolean" ? r : r.pass;
      if (pass) return { pass: true, note: `satisfied: ${c.label}` };
      notes.push(`${c.label}: ${typeof r === "object" && r.note ? r.note : "no"}`);
    }
    return { pass: false, note: notes.join(" // ") };
  });

export const dbCheck = (label, fn) => check(`DB: ${label}`, (t, ctx) => fn(ctx, t));

// ---------------------------------------------------------------------------
// DB helpers for assertions and seeding
// ---------------------------------------------------------------------------

export async function leadsOf(referrerPhone) {
  return listWhatsappReferralsByReferrerPhone(referrerPhone, 50);
}

export async function referrerOf(phone) {
  return searchReferrerByPhone(phone);
}

export async function seedReferrer(name, phone) {
  return createReferrerOnBehalf({ name, phone, createdBy: "reasoning_test" });
}

/**
 * Pick a real sales agent from the live roster (read-only) to use in
 * assignment scenarios. Prefers one whose first name token is unique on the
 * roster so a first-name fragment resolves to exactly one agent.
 */
export async function pickAgent() {
  const agents = await listWhatsappAgents();
  if (agents.length === 0) throw new Error("No sales agents found in the user table.");

  const firstTokenCounts = new Map();
  for (const agent of agents) {
    const token = agent.name.trim().split(/\s+/)[0]?.toLowerCase() || "";
    firstTokenCounts.set(token, (firstTokenCounts.get(token) || 0) + 1);
  }

  const preferred = agents.find((agent) => {
    const tokens = agent.name.trim().split(/\s+/);
    const first = tokens[0]?.toLowerCase() || "";
    return tokens.length >= 2 && first.length >= 3 && firstTokenCounts.get(first) === 1;
  });

  const agent = preferred || agents[0];
  const frag = agent.name.trim().split(/\s+/)[0];
  return { agent, frag, rosterSize: agents.length };
}

// ---------------------------------------------------------------------------
// Scenario runner
// ---------------------------------------------------------------------------

export async function runScenario(scenario, ctx, log = () => {}) {
  const turns = [];

  if (scenario.seed) await scenario.seed(ctx);

  for (let i = 0; i < scenario.turns.length; i++) {
    const turn = scenario.turns[i];
    const say = typeof turn.say === "function" ? turn.say(ctx) : turn.say;
    if (say === null || say === undefined) {
      turns.push({ turn: i + 1, skipped: true });
      continue;
    }

    const phone = turn.phone ? turn.phone(ctx) : ctx.phone;
    let result;
    try {
      result = await runTurn(phone, say);
    } catch (error) {
      turns.push({ turn: i + 1, say, error: String(error), checks: [] });
      log(`    turn ${i + 1} ERROR: ${error}`);
      break;
    }

    const checks = [];
    for (const c of turn.expect || []) {
      let outcome;
      try {
        const r = await c.fn(result, ctx);
        outcome = typeof r === "boolean" ? { pass: r } : r;
      } catch (error) {
        outcome = { pass: false, note: `check threw: ${error}` };
      }
      checks.push({ label: c.label, ...outcome });
      log(`    turn ${i + 1} ${outcome.pass ? "PASS" : "FAIL"}  ${c.label}${outcome.note ? ` — ${outcome.note}` : ""}`);
    }

    if (turn.after) await turn.after(result, ctx);

    turns.push({
      turn: i + 1,
      say,
      reply: result.reply,
      ms: result.ms,
      toolTrace: result.toolTrace.map((c) => ({ name: c.name, status: c.status, input: c.input })),
      checks,
    });
  }

  const allChecks = turns.flatMap((t) => t.checks || []);
  return {
    name: scenario.name,
    passed: allChecks.length > 0 && allChecks.every((c) => c.pass) && !turns.some((t) => t.error),
    checkTotal: allChecks.length,
    checkPassed: allChecks.filter((c) => c.pass).length,
    turns,
  };
}

// ---------------------------------------------------------------------------
// Cleanup — removes ONLY prefixed test data
// ---------------------------------------------------------------------------

export async function cleanupTestData() {
  const referrals = await runWhatsappAgentSql(
    `
      DELETE FROM referral
      WHERE name LIKE '${TEST_NAME_PREFIX}%'
         OR mobile_number LIKE '${TEST_PHONE_PREFIX}%'
         OR linked_customer_profile IN (
              SELECT customer_id FROM customer
              WHERE phone LIKE '${TEST_PHONE_PREFIX}%' OR name LIKE '${TEST_NAME_PREFIX}%'
            )
      RETURNING id
    `,
  );

  const customers = await runWhatsappAgentSql(
    `
      DELETE FROM customer
      WHERE phone LIKE '${TEST_PHONE_PREFIX}%' OR name LIKE '${TEST_NAME_PREFIX}%'
      RETURNING id
    `,
  );

  // Session metadata: agent state + conversation keys for test phones, and
  // debug-log entries. Targeted jsonb ops only — never a full-metadata
  // overwrite, since prod writes to the same row concurrently.
  const config = getWhatsappAgentRuntimeConfig();
  const session = await ensureChannelSession();
  const metadata = session.metadata || {};
  const testKeys = new Set(
    [...Object.keys(metadata.agentStates || {}), ...Object.keys(metadata.conversations || {})].filter((key) =>
      key.startsWith(TEST_PHONE_PREFIX),
    ),
  );

  for (const key of testKeys) {
    await runWhatsappAgentSql(
      `
        UPDATE et_channel_sessions
        SET metadata = (metadata #- ARRAY['agentStates', $3::text]) #- ARRAY['conversations', $3::text],
            updated_at = NOW()
        WHERE tenant_id = $1 AND channel_type = 'whatsapp' AND session_identifier = $2
      `,
      [config.tenantId, config.sessionId, key],
    );
  }

  await runWhatsappAgentSql(
    `
      UPDATE et_channel_sessions
      SET metadata = jsonb_set(
            metadata,
            '{agentDebugLog}',
            COALESCE(
              (
                SELECT jsonb_agg(entry)
                FROM jsonb_array_elements(COALESCE(metadata->'agentDebugLog', '[]'::jsonb)) entry
                WHERE NOT ((entry->>'phone') LIKE '${TEST_PHONE_PREFIX}%')
              ),
              '[]'::jsonb
            )
          ),
          updated_at = NOW()
      WHERE tenant_id = $1 AND channel_type = 'whatsapp' AND session_identifier = $2
        AND metadata->'agentDebugLog' IS NOT NULL
    `,
    [config.tenantId, config.sessionId],
  );

  return {
    referralsDeleted: referrals.length,
    customersDeleted: customers.length,
    sessionKeysCleared: testKeys.size,
  };
}

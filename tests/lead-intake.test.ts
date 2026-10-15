import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { createApiLead, type LeadSqlExecutor } from "../src/lib/lead-intake.ts";
import { LeadApiError, leadApiInputSchema } from "../src/lib/lead-api.ts";
import { assignedUserJoin, assignedUserMatch } from "../src/lib/referral-agent-sql.ts";

const db = new PGlite();
const execute: LeadSqlExecutor = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const input = (referrer = "Google Ads", agent: string | number | null = "42") => leadApiInputSchema.parse({
  leadName: "Ali Ahmad", leadMobileNumber: "0123456789", referrer, assignedAgentId: agent ?? undefined,
  leadState: "Selangor", leadCity: "Kajang", leadAddress: "1 Jalan Test", remark: "Interested in solar",
});

before(async () => {
  await db.exec(`
    CREATE TABLE customer (
      id serial PRIMARY KEY, customer_id text UNIQUE NOT NULL, name text NOT NULL, phone text,
      state text, city text, address text,
      lead_source text CHECK (lead_source IS NULL OR lead_source IN ('referral', 'bni', 'roadshow', 'digital_ads', 'own_network', 'other')),
      remark text, notes text,
      created_by text, updated_by text, linked_referrer text
    );
    CREATE TABLE "user" (id serial PRIMARY KEY, bubble_id text UNIQUE, name text, access_level text[]);
    CREATE TABLE referral (
      id serial PRIMARY KEY, bubble_id text UNIQUE NOT NULL, linked_customer_profile text NOT NULL,
      name text NOT NULL, relationship text, mobile_number text, status text, linked_invoice text,
      project_type text, linked_agent text, assigned_agent text, lead_state text, lead_city text, lead_address text
    );
    CREATE TABLE activity_log (
      id serial PRIMARY KEY, app text NOT NULL, app_env text NOT NULL, source_url text, actor_kind text NOT NULL,
      actor_ref text, actor_name text, actor_role text, action text NOT NULL, entity_type text NOT NULL,
      entity_id text NOT NULL, entity_label text, description text, fields text[], status text NOT NULL,
      metadata jsonb, occurred_at timestamptz NOT NULL
    );
  `);
});
beforeEach(async () => {
  await db.exec(`
    TRUNCATE customer, "user", referral, activity_log RESTART IDENTITY;
    INSERT INTO "user" (id, bubble_id, name, access_level) VALUES
      (42, 'sales_agent_42', 'Agent A', ARRAY['Sales']), (43, 'hr_43', 'HR User', ARRAY['HR']);
  `);
});
after(async () => { await db.close(); });

test("creates advertising lead and canonical assigned user with source attribution visible to existing joins", async () => {
  const result = await createApiLead(input(), execute);
  assert.equal(result.status, "Assigned");
  assert.equal(result.assignedAgentId, "sales_agent_42");
  const [saved] = await execute<Record<string, unknown>>(`
    SELECT c.phone, c.lead_source, c.state, c.notes, r.assigned_agent, r.linked_agent, r.status,
      source.name AS referrer_name, source.remark AS source_marker, source.phone AS source_phone,
      u.name AS agent_name, a.actor_kind, a.metadata
    FROM referral r
    JOIN customer c ON c.customer_id = r.linked_invoice
    JOIN customer source ON source.customer_id = r.linked_customer_profile
    JOIN "user" u ON u.bubble_id = r.assigned_agent
    JOIN activity_log a ON a.entity_id = r.id::text
    WHERE r.id = $1
  `, [result.referralId]);
  assert.equal(saved.phone, "60123456789");
  assert.equal(saved.lead_source, "digital_ads");
  assert.equal(saved.referrer_name, "Google Ads");
  assert.equal(saved.source_marker, "LEAD_SOURCE_ACCOUNT");
  assert.equal(saved.source_phone, null);
  assert.equal(saved.agent_name, "Agent A");
  assert.equal(saved.linked_agent, null);
  assert.equal(saved.actor_kind, "api");
  assert.equal(JSON.parse(String(saved.notes)).remark, "Interested in solar");
  assert.equal((saved.metadata as Record<string, unknown>).assignedAgentId, "sales_agent_42");
});

test("reuses a source across case and spacing variants and supports Facebook Ads", async () => {
  const first = await createApiLead(input(" google   ads ", "sales_agent_42"), execute);
  const second = await createApiLead(input("GOOGLE ADS"), execute);
  assert.equal(first.referrer.customerId, second.referrer.customerId);
  const facebook = await createApiLead(input("facebook Ads"), execute);
  assert.equal(facebook.referrer.name, "Facebook Ads");
  assert.notEqual(facebook.referrer.customerId, first.referrer.customerId);
  assert.equal((await execute<{ count: number }>("SELECT COUNT(*)::int AS count FROM customer WHERE remark = 'LEAD_SOURCE_ACCOUNT'"))[0].count, 2);
});

test("creates a Pending lead without an assigned user", async () => {
  const result = await createApiLead(input("Facebook Ads", null), execute);
  assert.equal(result.status, "Pending");
  assert.equal(result.assignedAgentId, null);
  const [row] = await execute<{ assigned_agent: string | null }>("SELECT assigned_agent FROM referral");
  assert.equal(row.assigned_agent, null);
});

test("existing dashboard queries resolve both Bubble and numeric assignments for the logged-in user", async () => {
  const created = await createApiLead(input(), execute);
  const sql = `SELECT r.id, assigned_agent.id::text AS assigned_agent_id, assigned_agent.name
    FROM referral r ${assignedUserJoin("r.assigned_agent", "assigned_agent")}
    WHERE ${assignedUserMatch("r.assigned_agent", 1)}`;
  for (const id of ["42", "sales_agent_42"]) {
    const rows = await execute<{ id: number; assigned_agent_id: string; name: string }>(sql, [id]);
    assert.deepEqual(rows, [{ id: created.referralId, assigned_agent_id: "42", name: "Agent A" }]);
  }
  assert.deepEqual(await execute(sql, ["43"]), []);
  await execute("UPDATE referral SET assigned_agent = '42' WHERE id = $1", [created.referralId]);
  assert.equal((await execute(sql, ["sales_agent_42"])).length, 1);
});

test("an existing person remains the introducer while a sales user receives the lead", async () => {
  await execute("INSERT INTO customer (customer_id, name, remark) VALUES ($1, $2, $3)", ["person_1", "Ahmad", "REFERRAL_ACCOUNT"]);
  const result = await createApiLead({ ...input(), referrer: { customerId: "person_1" } }, execute);
  assert.deepEqual(result.referrer, { customerId: "person_1", name: "Ahmad", type: "person" });
  assert.equal(result.assignedAgentId, "sales_agent_42");
  assert.equal((await execute<{ lead_source: string }>("SELECT lead_source FROM customer WHERE customer_id = $1", [result.leadCustomerId]))[0].lead_source, "referral");
});

test("rejects missing and non-sales agents and unknown people before writing anything", async () => {
  for (const agent of ["missing_agent", "43", "9999999999999999999999999999"]) {
    await assert.rejects(createApiLead(input("Google Ads", agent), execute), (e: unknown) => e instanceof LeadApiError && e.code === "INVALID_AGENT");
  }
  await assert.rejects(createApiLead({ ...input(), referrer: { customerId: "missing_person" } }, execute), (e: unknown) => e instanceof LeadApiError && e.code === "INVALID_REFERRER");
  assert.equal((await execute<{ count: number }>("SELECT COUNT(*)::int AS count FROM customer"))[0].count, 0);
});

test("an audit insertion failure rolls back the source, customer and referral together", async () => {
  await db.exec("ALTER TABLE activity_log ADD CONSTRAINT reject_test_audit CHECK (status <> 'success')");
  try {
    await assert.rejects(createApiLead(input(), execute));
    for (const table of ["customer", "referral", "activity_log"]) {
      assert.equal((await execute<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${table}`))[0].count, 0);
    }
  } finally {
    await db.exec("ALTER TABLE activity_log DROP CONSTRAINT reject_test_audit");
  }
});

test("reports unavailable assignment storage instead of silently dropping the assignment", async () => {
  await db.exec("ALTER TABLE referral DROP COLUMN assigned_agent");
  try {
    await assert.rejects(createApiLead(input(), execute), (e: unknown) => e instanceof LeadApiError && e.code === "ASSIGNMENT_NOT_CONFIGURED");
    assert.equal((await execute<{ count: number }>("SELECT COUNT(*)::int AS count FROM customer"))[0].count, 0);
    const unassigned = await createApiLead(input("Google Ads", null), execute);
    assert.equal(unassigned.assignedAgentId, null);
  } finally {
    await db.exec("ALTER TABLE referral ADD COLUMN assigned_agent text");
  }
});

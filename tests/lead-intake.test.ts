import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { createApiLead, listApiAgents, listApiLeads, listApiSources, type LeadSqlExecutor } from "../src/lib/lead-intake.ts";
import { createLeadApiHandler, createListLeadsApiHandler, LeadApiError, leadApiInputSchema, leadSourceCustomerId } from "../src/lib/lead-api.ts";
import { KNOWN_AD_SOURCES, normalizeAdSourceName } from "../src/lib/referral-options.ts";

const db = new PGlite();
const execute: LeadSqlExecutor = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const input = (referrer: string | { customerId: string } = "Google Ads", agent: string | number | null = "42") => leadApiInputSchema.parse({
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

/**
 * Test-only fixture. createApiLead() is retired (webchat is the only add-lead method),
 * so listing tests seed rows directly with the same column layout the API used to write.
 */
async function seedLead(lead: ReturnType<typeof input>) {
  const referrerKey = typeof lead.referrer === "string" ? lead.referrer : lead.referrer.customerId;
  const person = (await execute<{ customer_id: string; name: string }>(
    "SELECT customer_id, name FROM customer WHERE customer_id = $1 AND remark = 'REFERRAL_ACCOUNT'", [referrerKey]))[0];
  const referrer = person
    ? { customerId: person.customer_id, name: person.name, type: "person" as const }
    : (() => {
        const customerId = referrerKey.startsWith("lead_source_") ? referrerKey : leadSourceCustomerId(referrerKey);
        const known = KNOWN_AD_SOURCES.find((name) => leadSourceCustomerId(name) === customerId);
        return { customerId, name: known ?? normalizeAdSourceName(referrerKey), type: "source" as const };
      })();
  if (referrer.type === "source") {
    await execute(`INSERT INTO customer (customer_id, name, lead_source, remark) VALUES ($1, $2, 'other', 'LEAD_SOURCE_ACCOUNT') ON CONFLICT (customer_id) DO NOTHING`, [referrer.customerId, referrer.name]);
  }
  const agent = lead.assignedAgentId
    ? (await execute<{ bubble_id: string }>(`SELECT bubble_id FROM "user" WHERE bubble_id = $1 OR id::text = $1`, [lead.assignedAgentId]))[0]?.bubble_id ?? null
    : null;
  const leadCustomerId = `cust_seed_${Math.random().toString(36).slice(2, 10)}`;
  const notes = JSON.stringify({ relationship: lead.relationship, projectType: lead.projectType, leadState: lead.leadState,
    leadCity: lead.leadCity, leadAddress: lead.leadAddress, remark: lead.remark, createdAt: new Date().toISOString() });
  await execute(`INSERT INTO customer (customer_id, name, phone, state, city, address, lead_source, remark, notes)
    VALUES ($1, $2, $3, $4, $5, $6, 'other', $7, $8)`, [leadCustomerId, lead.leadName, lead.leadMobileNumber, lead.leadState || null,
    lead.leadCity || null, lead.leadAddress || null, lead.relationship, notes]);
  const status = agent ? "Assigned" : "Pending";
  const [row] = await execute<{ id: number }>(`INSERT INTO referral (bubble_id, linked_customer_profile, name, relationship, mobile_number, status,
    linked_invoice, project_type, assigned_agent, lead_state, lead_city, lead_address)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [`reflead_seed_${Math.random().toString(36).slice(2, 10)}`, referrer.customerId, lead.leadName, lead.relationship, lead.leadMobileNumber,
     status, leadCustomerId, lead.projectType, agent, lead.leadState || null, lead.leadCity || null, lead.leadAddress || null]);
  return { referralId: row.id, leadCustomerId, leadName: lead.leadName, leadMobileNumber: lead.leadMobileNumber,
    referrer, assignedAgentId: agent, status };
}

test("createApiLead is retired: it throws 410 and writes nothing", async () => {
  await assert.rejects(
    createApiLead(input(), execute),
    (e: unknown) => e instanceof LeadApiError && e.status === 410 && e.code === "LEAD_METHOD_RETIRED" && e.message.includes("/webchat"),
  );
  for (const table of ["customer", "referral", "activity_log"]) {
    assert.equal((await execute<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${table}`))[0].count, 0);
  }
});

test("POST /api/leads handler answers 410 with the webchat address and writes nothing", async () => {
  const handler = createLeadApiHandler({ getApiKey: () => "test-key", createLead: (lead) => createApiLead(lead, execute) });
  const response = await handler(new Request("http://localhost/api/leads", {
    method: "POST",
    headers: { Authorization: "Bearer test-key", "Content-Type": "application/json" },
    body: JSON.stringify(input()),
  }));
  assert.equal(response.status, 410);
  const body = await response.json();
  assert.equal(body.code, "LEAD_METHOD_RETIRED");
  assert.ok(String(body.error).includes("https://referral.atap.solar/webchat"));
  assert.equal((await execute<{ count: number }>("SELECT COUNT(*)::int AS count FROM referral"))[0].count, 0);
});

test("listApiAgents returns only users with sales in access_level and formats agent options", async () => {
  await db.exec(`
    INSERT INTO "user" (id, bubble_id, name, access_level) VALUES
      (44, 'sales_agent_44', 'Bob Sales', ARRAY['Direct Sales']),
      (45, 'blank_user', 'No Sales', ARRAY['Finance']);
  `);

  const agents = await listApiAgents(execute);
  assert.equal(agents.length, 2);
  assert.deepEqual(agents, [
    {
      id: "sales_agent_42",
      name: "Agent A",
      bubbleId: "sales_agent_42",
      numericId: 42,
      accessLevels: ["Sales"],
    },
    {
      id: "sales_agent_44",
      name: "Bob Sales",
      bubbleId: "sales_agent_44",
      numericId: 44,
      accessLevels: ["Direct Sales"],
    },
  ]);
});

test("listApiSources returns configured ad sources including Meta Ads Leon and Google Ads Gan", async () => {
  const sources = await listApiSources(execute);
  const names = sources.map((s) => s.name);
  assert.ok(names.includes("Meta Ads Leon"));
  assert.ok(names.includes("Google Ads Gan"));
  assert.ok(names.includes("Facebook Ads"));
  assert.ok(names.includes("Google Ads"));

  const metaLeon = sources.find((s) => s.name === "Meta Ads Leon");
  assert.equal(metaLeon?.id, leadSourceCustomerId("Meta Ads Leon"));
  assert.equal(metaLeon?.type, "ads");
});

test("retrieves complete leads by exact source name or ID without mixing sources or person referrals", async () => {
  const leon = await seedLead(input("Meta Ads Leon"));
  const gan = await seedLead(input("Google Ads Gan", null));
  const other = await seedLead(input("TikTok Ads Mei"));
  await seedLead(input("Meta Ads Leon Extra"));
  await execute("INSERT INTO customer (customer_id, name, remark) VALUES ('person_1', 'Meta Ads Leon', 'REFERRAL_ACCOUNT')");
  await seedLead(input({ customerId: "person_1" }));
  await execute("UPDATE referral SET status = 'Contacted' WHERE id = $1", [leon.referralId]);

  for (const referrer of [" meta   ads LEON ", leon.referrer.customerId]) {
    const result = await listApiLeads({ referrer, limit: 100, offset: 0 }, execute);
    assert.deepEqual(result.pagination, { total: 1, limit: 100, offset: 0, hasMore: false });
    const [lead] = result.leads;
    assert.deepEqual(lead, {
      ...leon, status: "Contacted", leadState: "Selangor", leadCity: "Kajang", leadAddress: "1 Jalan Test",
      relationship: "Other", projectType: "OTHERS", remark: "Interested in solar", createdAt: lead.createdAt,
    });
    assert.ok(lead.createdAt && !Number.isNaN(Date.parse(lead.createdAt)));
    assert.ok(!("notes" in lead));
  }
  for (const [referrer, expected] of [["google ads gan", gan], ["tiktok ads mei", other]] as const) {
    const result = await listApiLeads({ referrer, limit: 100, offset: 0 }, execute);
    assert.deepEqual(result.leads.map((lead) => lead.referralId), [expected.referralId]);
    assert.equal(result.leads[0].assignedAgentId, expected.assignedAgentId);
  }
  for (const referrer of ["No Such Ads", "Meta Ads%", "Meta Ads Leon' OR 1=1 --"]) {
    assert.deepEqual(await listApiLeads({ referrer, limit: 100, offset: 0 }, execute), {
      leads: [], pagination: { total: 0, limit: 100, offset: 0, hasMore: false },
    });
  }
});

test("source lead listing paginates all results in descending referral ID order and keeps totals for empty pages", async () => {
  const first = await seedLead(input("Meta Ads Leon"));
  const second = await seedLead(input("Google Ads Gan"));
  const third = await seedLead(input("Roadshow"));
  const page1 = await listApiLeads({ limit: 2, offset: 0 }, execute);
  assert.deepEqual(page1.leads.map((lead) => lead.referralId), [third.referralId, second.referralId]);
  assert.deepEqual(page1.pagination, { total: 3, limit: 2, offset: 0, hasMore: true });
  const page2 = await listApiLeads({ limit: 2, offset: 2 }, execute);
  assert.deepEqual(page2.leads.map((lead) => lead.referralId), [first.referralId]);
  assert.deepEqual(page2.pagination, { total: 3, limit: 2, offset: 2, hasMore: false });
  const empty = await listApiLeads({ limit: 2, offset: 10 }, execute);
  assert.deepEqual(empty, { leads: [], pagination: { total: 3, limit: 2, offset: 10, hasMore: false } });
});

test("listing supports legacy optional columns, plain notes, and referrals without a linked lead customer", async () => {
  const saved = await seedLead(input("Meta Ads Leon", null));
  await db.exec("ALTER TABLE referral DROP COLUMN assigned_agent, DROP COLUMN project_type, DROP COLUMN lead_state, DROP COLUMN lead_city, DROP COLUMN lead_address");
  try {
    const query = { referrer: "Meta Ads Leon", limit: 100, offset: 0 };
    const [lead] = (await listApiLeads(query, execute)).leads;
    assert.equal(lead.leadState, "Selangor");
    assert.equal(lead.projectType, "OTHERS");
    assert.equal(lead.remark, "Interested in solar");
    assert.equal(lead.assignedAgentId, null);
    await execute("UPDATE customer SET notes = 'legacy plain text' WHERE customer_id = $1", [saved.leadCustomerId]);
    assert.equal((await listApiLeads(query, execute)).leads[0].remark, "");
    await execute("DELETE FROM customer WHERE customer_id = $1", [saved.leadCustomerId]);
    const orphan = (await listApiLeads(query, execute)).leads[0];
    assert.equal(orphan.referralId, saved.referralId);
    assert.equal(orphan.leadName, saved.leadName);
  } finally {
    await db.exec("ALTER TABLE referral ADD COLUMN assigned_agent text, ADD COLUMN project_type text, ADD COLUMN lead_state text, ADD COLUMN lead_city text, ADD COLUMN lead_address text");
  }
});

test("authenticated GET handler retrieves stored source leads through the SQL executor", async () => {
  const saved = await seedLead(input("Google Ads Gan"));
  const handler = createListLeadsApiHandler({ getApiKey: () => "test-key", listLeads: (query) => listApiLeads(query, execute) });
  const response = await handler(new Request("http://localhost/api/leads?referrer=google%20ads%20gan&limit=1", {
    headers: { Authorization: "Bearer test-key" },
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.leads[0].referralId, saved.referralId);
  assert.deepEqual(body.pagination, { total: 1, limit: 1, offset: 0, hasMore: false });
});

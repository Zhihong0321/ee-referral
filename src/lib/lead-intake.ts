import { randomUUID } from "node:crypto";

import {
  LeadApiError,
  leadApiInputSchema,
  leadSourceCustomerId,
  type ApiAgentOption,
  type ApiLeadSource,
  type CreatedApiLead,
  type LeadApiInput,
} from "./lead-api.ts";
import { isDigitalAdSource, KNOWN_AD_SOURCES, normalizeAdSourceName } from "./referral-options.ts";

export type LeadSqlExecutor = <T>(sql: string, params?: unknown[]) => Promise<T[]>;

type Capabilities = {
  has_assigned_agent: boolean;
  has_linked_agent: boolean;
  has_linked_referrer: boolean;
  has_project_type: boolean;
  has_lead_state: boolean;
  has_lead_city: boolean;
  has_lead_address: boolean;
  has_user_table: boolean;
  has_access_level: boolean;
};

export async function listApiAgents(execute: LeadSqlExecutor): Promise<ApiAgentOption[]> {
  const [caps] = await execute<{ has_user_table: boolean; has_access_level: boolean }>(`
    SELECT
      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user') AS has_user_table,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'access_level') AS has_access_level
  `);

  if (!caps?.has_user_table) {
    return [];
  }

  const salesFilter = caps.has_access_level
    ? "AND EXISTS (SELECT 1 FROM unnest(u.access_level) AS level WHERE LOWER(level) LIKE '%sales%')"
    : "";

  const rows = await execute<{
    id: number | string;
    bubble_id: string | null;
    name: string | null;
    access_level: string[] | null;
  }>(`
    SELECT
      u.id,
      u.bubble_id,
      u.name,
      ${caps.has_access_level ? "u.access_level" : "ARRAY[]::text[] AS access_level"}
    FROM "user" u
    WHERE u.name IS NOT NULL
      AND BTRIM(u.name) <> ''
      AND u.bubble_id IS NOT NULL
      AND BTRIM(u.bubble_id) <> ''
      ${salesFilter}
    ORDER BY u.name ASC, u.id ASC
  `);

  return rows.map((row) => ({
    id: (row.bubble_id || "").trim(),
    name: (row.name || "").trim(),
    bubbleId: (row.bubble_id || "").trim(),
    numericId: Number(row.id),
    accessLevels: Array.isArray(row.access_level)
      ? row.access_level.map((level) => String(level).trim()).filter(Boolean)
      : [],
  }));
}

export async function listApiSources(execute: LeadSqlExecutor): Promise<ApiLeadSource[]> {
  const sourcesMap = new Map<string, ApiLeadSource>();

  // 1. Seed with known/configured ad sources (e.g. Meta Ads Leon, Google Ads Gan, Facebook Ads, Google Ads)
  for (const name of KNOWN_AD_SOURCES) {
    const id = leadSourceCustomerId(name);
    sourcesMap.set(id, {
      id,
      name,
      type: "ads",
    });
  }

  // 2. Fetch any other lead source accounts already in the database
  try {
    const rows = await execute<{ customer_id: string; name: string | null }>(`
      SELECT customer_id, name
      FROM customer
      WHERE remark = 'LEAD_SOURCE_ACCOUNT'
      ORDER BY name ASC
    `);

    for (const row of rows) {
      if (!row.customer_id) continue;
      const id = row.customer_id.trim();
      const rawName = (row.name || "").trim() || id;
      const name = normalizeAdSourceName(rawName);
      if (!sourcesMap.has(id)) {
        sourcesMap.set(id, {
          id,
          name,
          type: isDigitalAdSource(name) ? "ads" : "other",
        });
      }
    }
  } catch {
    // If customer table does not exist yet (e.g. mock/sandbox), return configured sources
  }

  return Array.from(sourcesMap.values());
}

export async function createApiLead(input: LeadApiInput, execute: LeadSqlExecutor): Promise<CreatedApiLead> {
  // Revalidate at the persistence boundary as well as the HTTP boundary.
  const parsed = leadApiInputSchema.safeParse(input);
  if (!parsed.success) throw new LeadApiError(400, "INVALID_INPUT", "Invalid lead details.");
  const lead = parsed.data;

  const [caps] = await execute<Capabilities>(`
    SELECT
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'referral' AND column_name = 'assigned_agent') AS has_assigned_agent,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'referral' AND column_name = 'linked_agent') AS has_linked_agent,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customer' AND column_name = 'linked_referrer') AS has_linked_referrer,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'referral' AND column_name = 'project_type') AS has_project_type,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'referral' AND column_name = 'lead_state') AS has_lead_state,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'referral' AND column_name = 'lead_city') AS has_lead_city,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'referral' AND column_name = 'lead_address') AS has_lead_address,
      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user') AS has_user_table,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'access_level') AS has_access_level
  `);
  if (!caps) throw new Error("Unable to inspect lead storage.");

  let assignedAgentId: string | null = null;
  if (lead.assignedAgentId) {
    if (!caps.has_assigned_agent) {
      throw new LeadApiError(503, "ASSIGNMENT_NOT_CONFIGURED", "Run sql/20260313_add_assignment_and_location_to_referral.sql before assigning leads.");
    }
    if (caps.has_user_table) {
      const [agent] = await execute<{ bubble_id: string | null }>(`
        SELECT u.bubble_id FROM "user" u
        WHERE (u.bubble_id = $1 OR u.id::text = $1)
          AND NULLIF(BTRIM(u.bubble_id), '') IS NOT NULL
          ${caps.has_access_level ? "AND EXISTS (SELECT 1 FROM unnest(u.access_level) AS level WHERE LOWER(level) LIKE '%sales%')" : ""}
        ORDER BY CASE WHEN u.bubble_id = $1 THEN 0 ELSE 1 END, u.id
        LIMIT 1
      `, [lead.assignedAgentId]);
      assignedAgentId = agent?.bubble_id?.trim() || null;
    }
    if (!assignedAgentId) {
      throw new LeadApiError(422, "INVALID_AGENT", "Assigned agent was not found or is not in sales.");
    }
  }

  let referrer: CreatedApiLead["referrer"];
  if (typeof lead.referrer === "string") {
    const rawReferrer = lead.referrer.trim();
    // Check if it directly matches a known ad source ID
    const knownById = KNOWN_AD_SOURCES.find((n) => leadSourceCustomerId(n) === rawReferrer);
    if (knownById) {
      referrer = { customerId: leadSourceCustomerId(knownById), name: knownById, type: "source" };
    } else {
      // Check if it matches an existing LEAD_SOURCE_ACCOUNT customer_id in DB
      const [existingSource] = await execute<{ customer_id: string; name: string | null }>(`
        SELECT customer_id, name FROM customer
        WHERE customer_id = $1 AND remark = 'LEAD_SOURCE_ACCOUNT'
        LIMIT 1
      `, [rawReferrer]);
      if (existingSource) {
        referrer = {
          customerId: existingSource.customer_id,
          name: normalizeAdSourceName(existingSource.name || rawReferrer),
          type: "source",
        };
      } else {
        const normalized = normalizeAdSourceName(rawReferrer);
        referrer = { customerId: leadSourceCustomerId(normalized), name: normalized, type: "source" };
      }
    }
  } else {
    const rawId = lead.referrer.customerId.trim();
    const knownById = KNOWN_AD_SOURCES.find((n) => leadSourceCustomerId(n) === rawId || n.toLowerCase() === rawId.toLowerCase());
    if (knownById) {
      referrer = { customerId: leadSourceCustomerId(knownById), name: knownById, type: "source" };
    } else {
      const [record] = await execute<{ customer_id: string; name: string | null; remark: string | null }>(`
        SELECT customer_id, name, remark FROM customer
        WHERE customer_id = $1 AND remark = ANY($2::text[])
        LIMIT 1
      `, [rawId, ["REFERRAL_ACCOUNT", "REFERRER_ACCOUNT", "LEAD_SOURCE_ACCOUNT"]]);

      if (!record) {
        throw new LeadApiError(422, "INVALID_REFERRER", "Referrer account was not found.");
      }

      if (record.remark === "LEAD_SOURCE_ACCOUNT") {
        referrer = {
          customerId: record.customer_id,
          name: normalizeAdSourceName(record.name || "Ad Source"),
          type: "source",
        };
      } else {
        referrer = { customerId: record.customer_id, name: record.name || "Referral", type: "person" };
      }
    }
  }

  const status = assignedAgentId ? "Assigned" : "Pending";
  const leadCustomerId = `cust_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const referralBubbleId = `reflead_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const params: unknown[] = [];
  const bind = (value: unknown) => { params.push(value); return `$${params.length}`; };
  const referrerIdParam = bind(referrer.customerId);
  const referrerNameParam = bind(referrer.name);
  const referrerSql = referrer.type === "source" ? `
    INSERT INTO customer (customer_id, name, lead_source, remark, notes, created_by, updated_by)
    VALUES (${referrerIdParam}, ${referrerNameParam}, 'other', 'LEAD_SOURCE_ACCOUNT',
      ${bind(JSON.stringify({ sourceType: "marketing", sourceName: referrer.name, createdBy: "lead_api" }))}, 'lead_api', 'lead_api')
    ON CONFLICT (customer_id) DO UPDATE SET customer_id = EXCLUDED.customer_id
    RETURNING customer_id, name
  ` : `SELECT ${referrerIdParam}::text AS customer_id, ${referrerNameParam}::text AS name`;

  const leadSource = referrer.type === "source"
    ? (isDigitalAdSource(referrer.name) ? "digital_ads" : "other")
    : "referral";
  const metadata = {
    relationship: lead.relationship,
    projectType: lead.projectType,
    leadState: lead.leadState,
    leadCity: lead.leadCity,
    leadAddress: lead.leadAddress,
    linkedReferrer: referrer.customerId,
    referrerType: referrer.type,
    sourceName: referrer.type === "source" ? referrer.name : null,
    assignedAgentId,
    syncedFromReferralPortal: true,
    remark: lead.remark,
    createdAt: new Date().toISOString(),
    createdBy: "lead_api",
  };
  const customerColumns = ["customer_id", "name", "phone", "state", "city", "address", "lead_source", "remark", "notes", "created_by", "updated_by"];
  const customerValues = [
    bind(leadCustomerId), bind(lead.leadName), bind(lead.leadMobileNumber), bind(lead.leadState || null),
    bind(lead.leadCity || null), bind(lead.leadAddress || null), bind(leadSource), bind(lead.relationship),
    bind(JSON.stringify(metadata)), "'lead_api'", "'lead_api'",
  ];
  if (caps.has_linked_referrer) {
    customerColumns.push("linked_referrer");
    customerValues.push("referrer.customer_id");
  }
  const referralColumns = ["bubble_id", "linked_customer_profile", "name", "relationship", "mobile_number", "status", "linked_invoice"];
  const referralValues = [bind(referralBubbleId), "referrer.customer_id", bind(lead.leadName), bind(lead.relationship), bind(lead.leadMobileNumber), bind(status), "inserted_customer.customer_id"];
  const optionalColumns: [boolean, string, unknown][] = [
    [caps.has_assigned_agent, "assigned_agent", assignedAgentId],
    [caps.has_linked_agent, "linked_agent", null],
    [caps.has_project_type, "project_type", lead.projectType],
    [caps.has_lead_state, "lead_state", lead.leadState || null],
    [caps.has_lead_city, "lead_city", lead.leadCity || null],
    [caps.has_lead_address, "lead_address", lead.leadAddress || null],
  ];
  for (const [available, column, value] of optionalColumns) {
    if (available) { referralColumns.push(column); referralValues.push(bind(value)); }
  }

  // One PostgreSQL statement is atomic through either pg or the SQL proxy.
  // An audit failure rolls back the source, customer, and referral as well.
  const [created] = await execute<{ id: number; referrer_name: string }>(`
    WITH referrer AS (${referrerSql}),
    inserted_customer AS (\n      INSERT INTO customer (${customerColumns.join(", ")})
      SELECT ${customerValues.join(", ")} FROM referrer
      RETURNING customer_id
    ),
    inserted_referral AS (
      INSERT INTO referral (${referralColumns.join(", ")})
      SELECT ${referralValues.join(", ")} FROM referrer CROSS JOIN inserted_customer
      RETURNING id, name
    ),
    audit AS (
      INSERT INTO activity_log (
        app, app_env, source_url, actor_kind, actor_ref, actor_name, actor_role,
        action, entity_type, entity_id, entity_label, description, fields, status, metadata, occurred_at
      )
      SELECT 'ee-referral', ${bind(process.env.VERCEL_ENV || process.env.NODE_ENV || "development")},
        '/api/leads', 'api', 'lead_api', 'Lead API', 'integration', 'create', 'referral',
        inserted_referral.id::text, inserted_referral.name, 'Lead created through the API.',
        ${bind(["leadName", "leadMobileNumber", "referrer", "assignedAgentId", "leadState", "leadCity", "leadAddress", "relationship", "projectType", "remark"])}::text[],
        'success', ${bind(JSON.stringify({ channel: "lead_api", ...metadata }))}::jsonb, NOW()
      FROM inserted_referral
      RETURNING entity_id
    )
    SELECT inserted_referral.id, referrer.name AS referrer_name
    FROM inserted_referral CROSS JOIN referrer CROSS JOIN audit
  `, params);
  if (!created) throw new Error("Lead creation returned no record.");

  return {
    referralId: created.id,
    leadCustomerId,
    leadName: lead.leadName,
    leadMobileNumber: lead.leadMobileNumber,
    referrer: { ...referrer, name: created.referrer_name },
    assignedAgentId,
    status,
  };
}

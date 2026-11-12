import {
  LeadApiError,
  leadSourceCustomerId,
  listLeadsQuerySchema,
  type ApiAgentOption,
  type ApiLeadList,
  type ApiLeadSource,
  type CreatedApiLead,
  type LeadApiInput,
  type ListLeadsQuery,
} from "./lead-api.ts";
import { isDigitalAdSource, KNOWN_AD_SOURCES, normalizeAdSourceName } from "./referral-options.ts";
import { RETIRED_LEAD_MESSAGE, recordRetiredLeadAttempt } from "./lead-write-policy.ts";

export type LeadSqlExecutor = <T>(sql: string, params?: unknown[]) => Promise<T[]>;

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

export async function listApiLeads(input: ListLeadsQuery, execute: LeadSqlExecutor): Promise<ApiLeadList> {
  const parsed = listLeadsQuerySchema.safeParse({
    ...input,
    limit: String(input.limit),
    offset: String(input.offset),
  });
  if (!parsed.success) throw new LeadApiError(400, "INVALID_INPUT", "Invalid lead query.");
  const { referrer, limit, offset } = parsed.data;

  type LeadRow = {
    id: number;
    lead_customer_id: string | null;
    name: string;
    mobile_number: string | null;
    referrer_id: string;
    referrer_name: string;
    assigned_agent: string | null;
    status: string;
    lead_state: string | null;
    lead_city: string | null;
    lead_address: string | null;
    relationship: string | null;
    project_type: string | null;
    notes: string | null;
    created_at: string | null;
  };

  // Match source accounts through the referral's introducer, never by agent or
  // by the broad digital_ads category. Keep totals and the page in one snapshot.
  const [result] = await execute<{ total: string; leads: LeadRow[] }>(`
    WITH filtered AS (
      SELECT r.id, r.linked_invoice AS lead_customer_id, r.name, r.mobile_number,
        source.customer_id AS referrer_id, COALESCE(NULLIF(BTRIM(source.name), ''), source.customer_id) AS referrer_name,
        to_jsonb(r)->>'assigned_agent' AS assigned_agent,
        COALESCE(NULLIF(r.status, ''), 'Pending') AS status,
        COALESCE(NULLIF(to_jsonb(r)->>'lead_state', ''), c.state) AS lead_state,
        COALESCE(NULLIF(to_jsonb(r)->>'lead_city', ''), c.city) AS lead_city,
        COALESCE(NULLIF(to_jsonb(r)->>'lead_address', ''), c.address) AS lead_address,
        r.relationship, to_jsonb(r)->>'project_type' AS project_type,
        c.notes, to_jsonb(r)->>'created_at' AS created_at
      FROM referral r
      JOIN customer source ON source.customer_id = r.linked_customer_profile
      LEFT JOIN customer c ON c.customer_id = r.linked_invoice
      WHERE source.remark = 'LEAD_SOURCE_ACCOUNT'
        AND ($1::text IS NULL OR source.customer_id = $1
          OR LOWER(REGEXP_REPLACE(BTRIM(source.name), '\\s+', ' ', 'g')) = LOWER($1))
    ), page AS (
      SELECT * FROM filtered ORDER BY id DESC LIMIT $2 OFFSET $3
    )
    SELECT (SELECT COUNT(*)::text FROM filtered) AS total,
      COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY id DESC) FROM page), '[]'::jsonb) AS leads
  `, [referrer ?? null, limit, offset]);
  if (!result) throw new Error("Lead query returned no result.");

  const leads = result.leads.map((row) => {
    let metadata: Record<string, unknown> = {};
    try {
      const notes: unknown = JSON.parse(row.notes || "{}");
      if (notes && typeof notes === "object" && !Array.isArray(notes)) metadata = notes as Record<string, unknown>;
    } catch { /* Legacy notes can be plain text. */ }
    const text = (key: string) => typeof metadata[key] === "string" ? metadata[key] as string : "";
    return {
      referralId: row.id,
      leadCustomerId: row.lead_customer_id,
      leadName: row.name,
      leadMobileNumber: row.mobile_number,
      referrer: { customerId: row.referrer_id, name: normalizeAdSourceName(row.referrer_name), type: "source" as const },
      assignedAgentId: row.assigned_agent,
      status: row.status,
      leadState: row.lead_state || text("leadState"),
      leadCity: row.lead_city || text("leadCity"),
      leadAddress: row.lead_address || text("leadAddress"),
      relationship: row.relationship || text("relationship") || "Other",
      projectType: row.project_type || text("projectType") || "OTHERS",
      remark: text("remark"),
      createdAt: row.created_at || text("createdAt") || null,
    };
  });
  const total = Number(result.total);
  return { leads, pagination: { total, limit, offset, hasMore: offset + leads.length < total } };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function createApiLead(_input: LeadApiInput, _execute: LeadSqlExecutor): Promise<CreatedApiLead> {
  // Retired: the webchat is the only allowed add-lead method (see lead-write-policy.ts).
  recordRetiredLeadAttempt("api");
  throw new LeadApiError(410, "LEAD_METHOD_RETIRED", RETIRED_LEAD_MESSAGE);
}

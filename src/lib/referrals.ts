import { z } from "zod";
import type { PoolClient, QueryResultRow } from "pg";

import type { AuthHubUser } from "@/lib/auth";
import { getPool, query } from "@/lib/db";

const REFERRAL_MARKER = "REFERRAL_ACCOUNT";
const LEGACY_REFERRER_MARKER = "REFERRER_ACCOUNT";
const REFERRAL_ACCOUNT_NAME = "Referral";
const APP_ACTOR = "referral_portal";

export const REFERRAL_STATUSES = [
  "Pending",
  "Assigned",
  "Contacted",
  "Qualified",
  "Successful",
  "Rejected",
] as const;
export const RELATIONSHIP_OPTIONS = [
  "Family",
  "Friend",
  "Colleague",
  "Neighbor",
  "Business Partner",
  "Existing Customer",
  "Community Contact",
  "Other",
] as const;
export const PROJECT_TYPE_OPTIONS = ["RESIDENTIAL (2%)", "SHOP-LOT (2%)", "FACTORY (1%)", "OTHERS"] as const;

export type RelationshipOption = (typeof RELATIONSHIP_OPTIONS)[number];
export type ProjectTypeOption = (typeof PROJECT_TYPE_OPTIONS)[number];
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

const preferredAgentIdSchema = z
  .string()
  .trim()
  .max(20, "Preferred agent is invalid")
  .refine((value) => value === "" || /^\d+$/.test(value), "Preferred agent is invalid");

const assignedAgentIdSchema = z
  .string()
  .trim()
  .max(20, "Assigned agent is invalid")
  .refine((value) => value === "" || /^\d+$/.test(value), "Assigned agent is invalid");

const referralInputSchema = z.object({
  leadName: z.string().trim().min(2, "Lead name is required"),
  leadMobileNumber: z.string().trim().min(6, "Lead mobile number is required"),
  leadState: z.string().trim().min(2, "Lead state is required"),
  leadCity: z.string().trim().max(120, "Lead city is too long").optional().default(""),
  leadAddress: z.string().trim().max(500, "Lead address is too long").optional().default(""),
  relationship: z.enum(RELATIONSHIP_OPTIONS),
  projectType: z.enum(PROJECT_TYPE_OPTIONS),
  preferredAgentId: preferredAgentIdSchema.optional().default(""),
});

const referralEditSchema = referralInputSchema.extend({
  referralId: z.coerce.number().int().positive(),
});

const managerReferralUpdateSchema = z.object({
  referralId: z.coerce.number().int().positive(),
  assignedAgentId: assignedAgentIdSchema.optional().default(""),
  status: z.enum(REFERRAL_STATUSES),
});

const referrerProfileSchema = z.object({
  displayName: z.string().trim().min(2, "Name is required").max(80, "Name is too long"),
  profilePicture: z
    .string()
    .trim()
    .max(500, "Profile picture URL is too long")
    .refine((value) => value === "" || URL.canParse(value), "Profile picture must be a valid URL"),
  bankAccount: z.string().trim().max(80, "Banking account is too long").optional().default(""),
  bankerName: z.string().trim().max(80, "Banker name is too long").optional().default(""),
});

export class ReferralError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferralError";
  }
}

export type ReferrerAccount = {
  customerId: string;
  name: string;
  phone: string;
  profilePicture: string | null;
  bankAccount: string;
  bankerName: string;
};

export type ReferralRow = {
  id: number;
  bubbleId: string;
  leadName: string;
  leadMobile: string | null;
  leadState: string | null;
  leadCity: string | null;
  leadAddress: string | null;
  relationship: string | null;
  projectType: string | null;
  status: string | null;
  leadCustomerId: string | null;
  preferredAgentId: string | null;
  preferredAgentName: string | null;
  assignedAgentId: string | null;
  assignedAgentName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ManagerReferralRow = ReferralRow & {
  referrerCustomerId: string;
  referrerCustomerName: string | null;
};

export type ManagerReferralFilters = {
  search?: string;
  assignment?: "assigned" | "unassigned" | "";
  status?: string;
  preferredAgentId?: string;
  assignedAgentId?: string;
};

export type AgentOption = {
  id: string;
  name: string;
};

type CustomerCapabilities = {
  hasLinkedReferrer: boolean;
  hasReferralProjectType: boolean;
  hasReferralLinkedAgent: boolean;
  hasReferralPreferredAgentLog: boolean;
  hasReferralAssignedAgent: boolean;
  hasReferralLeadState: boolean;
  hasReferralLeadCity: boolean;
  hasReferralLeadAddress: boolean;
  hasAgentTable: boolean;
  hasAgentLinkedUserLogin: boolean;
  hasUserTable: boolean;
  hasUserAccessLevel: boolean;
};

type Queryable = {
  query<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

type ReferrerAccountRow = {
  customer_id: string;
  name: string | null;
  phone: string | null;
  profile_picture: string | null;
  notes: string | null;
  remark: string | null;
};

type ReferrerNotes = {
  bankAccount?: string;
  bankerName?: string;
  [key: string]: unknown;
};

let cachedCustomerCapabilities: CustomerCapabilities | null = null;

function randomId(prefix: string) {
  const segment = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${prefix}_${segment}`;
}

function normalizePhone(phone: string) {
  return phone.replace(/\s+/g, "").trim();
}

function parseReferrerNotes(notes: string | null): ReferrerNotes {
  if (!notes) {
    return {};
  }

  try {
    const parsed = JSON.parse(notes) as unknown;

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ReferrerNotes;
    }
  } catch {
    return {};
  }

  return {};
}

function buildReferrerAccount(row: ReferrerAccountRow, fallbackPhone: string): ReferrerAccount {
  const noteData = parseReferrerNotes(row.notes);

  return {
    customerId: row.customer_id,
    name: row.name?.trim() || REFERRAL_ACCOUNT_NAME,
    phone: row.phone?.trim() || fallbackPhone,
    profilePicture: row.profile_picture,
    bankAccount: typeof noteData.bankAccount === "string" ? noteData.bankAccount : "",
    bankerName: typeof noteData.bankerName === "string" ? noteData.bankerName : "",
  };
}

async function getCustomerCapabilities(executor: Queryable): Promise<CustomerCapabilities> {
  if (cachedCustomerCapabilities) {
    return cachedCustomerCapabilities;
  }

  const result = await executor.query<{
    has_linked_referrer: boolean;
    has_referral_project_type: boolean;
    has_referral_linked_agent: boolean;
    has_referral_preferred_agent_log: boolean;
    has_referral_assigned_agent: boolean;
    has_referral_lead_state: boolean;
    has_referral_lead_city: boolean;
    has_referral_lead_address: boolean;
    has_agent_table: boolean;
    has_agent_linked_user_login: boolean;
    has_user_table: boolean;
    has_user_access_level: boolean;
  }>(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'customer'
        AND column_name = 'linked_referrer'
    ) AS has_linked_referrer,
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'referral'
        AND column_name = 'project_type'
    ) AS has_referral_project_type,
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'referral'
        AND column_name = 'linked_agent'
    ) AS has_referral_linked_agent,
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'referral'
        AND column_name = 'preferred_agent_log'
    ) AS has_referral_preferred_agent_log,
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'referral'
        AND column_name = 'assigned_agent'
    ) AS has_referral_assigned_agent,
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'referral'
        AND column_name = 'lead_state'
    ) AS has_referral_lead_state,
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'referral'
        AND column_name = 'lead_city'
    ) AS has_referral_lead_city,
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'referral'
        AND column_name = 'lead_address'
    ) AS has_referral_lead_address,
    EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'agent'
    ) AS has_agent_table,
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'agent'
        AND column_name = 'linked_user_login'
    ) AS has_agent_linked_user_login,
    EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'user'
    ) AS has_user_table,
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'user'
        AND column_name = 'access_level'
    ) AS has_user_access_level
  `);

  cachedCustomerCapabilities = {
    hasLinkedReferrer: result.rows[0]?.has_linked_referrer ?? false,
    hasReferralProjectType: result.rows[0]?.has_referral_project_type ?? false,
    hasReferralLinkedAgent: result.rows[0]?.has_referral_linked_agent ?? false,
    hasReferralPreferredAgentLog: result.rows[0]?.has_referral_preferred_agent_log ?? false,
    hasReferralAssignedAgent: result.rows[0]?.has_referral_assigned_agent ?? false,
    hasReferralLeadState: result.rows[0]?.has_referral_lead_state ?? false,
    hasReferralLeadCity: result.rows[0]?.has_referral_lead_city ?? false,
    hasReferralLeadAddress: result.rows[0]?.has_referral_lead_address ?? false,
    hasAgentTable: result.rows[0]?.has_agent_table ?? false,
    hasAgentLinkedUserLogin: result.rows[0]?.has_agent_linked_user_login ?? false,
    hasUserTable: result.rows[0]?.has_user_table ?? false,
    hasUserAccessLevel: result.rows[0]?.has_user_access_level ?? false,
  };

  return cachedCustomerCapabilities;
}

function buildLeadStateSelect(capabilities: CustomerCapabilities) {
  if (capabilities.hasReferralLeadState) {
    return "COALESCE(NULLIF(r.lead_state, ''), c.state) AS lead_state";
  }

  return "c.state AS lead_state";
}

function buildLeadCitySelect(capabilities: CustomerCapabilities) {
  if (capabilities.hasReferralLeadCity) {
    return "COALESCE(NULLIF(r.lead_city, ''), c.city) AS lead_city";
  }

  return "c.city AS lead_city";
}

function buildLeadAddressSelect(capabilities: CustomerCapabilities) {
  if (capabilities.hasReferralLeadAddress) {
    return "COALESCE(NULLIF(r.lead_address, ''), c.address) AS lead_address";
  }

  return "c.address AS lead_address";
}

async function normalizeAgentId(
  client: PoolClient,
  agentId: string,
  errorLabel: "Preferred agent" | "Assigned agent",
): Promise<string | null> {
  const capabilities = await getCustomerCapabilities(client);
  const normalized = agentId.trim();

  if (!normalized) {
    return null;
  }

  if (!capabilities.hasAgentTable) {
    return null;
  }

  const canFilterSales =
    capabilities.hasAgentLinkedUserLogin && capabilities.hasUserTable && capabilities.hasUserAccessLevel;

  const existing = await client.query<{ id: number }>(
    `
      SELECT a.id
      FROM agent a
      ${canFilterSales ? 'JOIN "user" u ON u.bubble_id = a.linked_user_login' : ""}
      WHERE a.id = $1
        ${canFilterSales ? "AND EXISTS (SELECT 1 FROM unnest(u.access_level) AS x WHERE LOWER(x) LIKE '%sales%')" : ""}
      LIMIT 1
    `,
    [Number(normalized)],
  );

  if (existing.rows.length === 0) {
    throw new ReferralError(`${errorLabel} was not found or is not in sales.`);
  }

  return normalized;
}

async function getAgentLabel(client: PoolClient, agentId: string | null): Promise<string> {
  if (!agentId) {
    return "unassigned";
  }

  const result = await client.query<{ name: string | null }>(
    `
      SELECT a.name
      FROM agent a
      WHERE a.id = $1
      LIMIT 1
    `,
    [Number(agentId)],
  );

  return result.rows[0]?.name?.trim() || agentId;
}

function buildPreferredAgentLogEntry(actorName: string, preferredAgentLabel: string): string {
  const actorLabel = actorName.trim() || "Unknown";
  const agentLabel = preferredAgentLabel.trim() || "unassigned";

  return `${new Date().toISOString()} | ${actorLabel} set preferred agent = ${agentLabel}`;
}

function mapReferralRow(
  row: {
    id: number;
    bubble_id: string;
    lead_name: string;
    lead_mobile: string | null;
    lead_state: string | null;
    lead_city: string | null;
    lead_address: string | null;
    relationship: string | null;
    project_type: string | null;
    status: string | null;
    lead_customer_id: string | null;
    preferred_agent_id: string | null;
    preferred_agent_name: string | null;
    assigned_agent_id: string | null;
    assigned_agent_name: string | null;
    created_at: string | null;
    updated_at: string | null;
    referrer_customer_id?: string;
    referrer_customer_name?: string | null;
  },
): ManagerReferralRow {
  return {
    id: row.id,
    bubbleId: row.bubble_id,
    leadName: row.lead_name,
    leadMobile: row.lead_mobile,
    leadState: row.lead_state,
    leadCity: row.lead_city,
    leadAddress: row.lead_address,
    relationship: row.relationship,
    projectType: row.project_type,
    status: row.status,
    leadCustomerId: row.lead_customer_id,
    preferredAgentId: row.preferred_agent_id,
    preferredAgentName: row.preferred_agent_name,
    assignedAgentId: row.assigned_agent_id,
    assignedAgentName: row.assigned_agent_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    referrerCustomerId: row.referrer_customer_id ?? "",
    referrerCustomerName: row.referrer_customer_name ?? null,
  };
}

export async function findOrCreateReferrerAccount(authUser: AuthHubUser): Promise<ReferrerAccount> {
  const phone = normalizePhone(authUser.phone);

  if (!phone) {
    throw new ReferralError("Your WhatsApp phone is missing from the auth token.");
  }

  const existing = await query<ReferrerAccountRow>(
    `
      SELECT customer_id, name, phone, profile_picture, notes, remark
      FROM customer
      WHERE phone = $1
        AND remark = ANY($2::text[])
      ORDER BY id DESC
      LIMIT 1
    `,
    [phone, [REFERRAL_MARKER, LEGACY_REFERRER_MARKER]],
  );

  if (existing.rows.length > 0) {
    const current = existing.rows[0];

    if (!current.name?.trim() || current.phone !== phone || current.remark !== REFERRAL_MARKER) {
      await query(
        `
          UPDATE customer
          SET
            name = COALESCE(NULLIF(name, ''), $1),
            phone = $2,
            remark = $3,
            updated_by = $4,
            updated_at = NOW()
          WHERE customer_id = $5
        `,
        [REFERRAL_ACCOUNT_NAME, phone, REFERRAL_MARKER, APP_ACTOR, current.customer_id],
      );

      current.name = current.name?.trim() || REFERRAL_ACCOUNT_NAME;
      current.phone = phone;
      current.remark = REFERRAL_MARKER;
    }

    return buildReferrerAccount(current, phone);
  }

  const generatedCustomerId = randomId("ref");
  const notes = JSON.stringify({
    kind: "referral_account",
    source: "whatsapp_auth",
    bankAccount: "",
    bankerName: "",
    createdAt: new Date().toISOString(),
  });

  const inserted = await query<ReferrerAccountRow>(
    `
      INSERT INTO customer (
        customer_id,
        name,
        phone,
        lead_source,
        remark,
        notes,
        created_by,
        updated_by
      )
      VALUES ($1, $2, $3, 'other', $4, $5, $6, $6)
      RETURNING customer_id, name, phone, profile_picture, notes, remark
    `,
    [generatedCustomerId, REFERRAL_ACCOUNT_NAME, phone, REFERRAL_MARKER, notes, APP_ACTOR],
  );

  return buildReferrerAccount(inserted.rows[0], phone);
}

export async function updateReferrerProfile(
  referrer: ReferrerAccount,
  input: z.input<typeof referrerProfileSchema>,
): Promise<void> {
  const parsed = referrerProfileSchema.safeParse(input);

  if (!parsed.success) {
    throw new ReferralError(parsed.error.issues[0]?.message || "Invalid profile input");
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query<{ notes: string | null }>(
      `
        SELECT notes
        FROM customer
        WHERE customer_id = $1
          AND remark = ANY($2::text[])
        FOR UPDATE
      `,
      [referrer.customerId, [REFERRAL_MARKER, LEGACY_REFERRER_MARKER]],
    );

    if (existing.rows.length === 0) {
      throw new ReferralError("Referral account not found.");
    }

    const mergedNotes: ReferrerNotes = {
      ...parseReferrerNotes(existing.rows[0].notes),
      kind: "referral_account",
      bankAccount: parsed.data.bankAccount,
      bankerName: parsed.data.bankerName,
      updatedAt: new Date().toISOString(),
    };

    await client.query(
      `
        UPDATE customer
        SET
          name = $1,
          profile_picture = $2,
          notes = $3,
          remark = $4,
          updated_by = $5,
          updated_at = NOW()
        WHERE customer_id = $6
      `,
      [
        parsed.data.displayName,
        parsed.data.profilePicture || null,
        JSON.stringify(mergedNotes),
        REFERRAL_MARKER,
        referrer.customerId,
        referrer.customerId,
      ],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");

    if (error instanceof ReferralError) {
      throw error;
    }

    throw new ReferralError("Unable to update your profile right now.");
  } finally {
    client.release();
  }
}

export async function listReferralsByReferrer(referrerCustomerId: string): Promise<ReferralRow[]> {
  const capabilities = await getCustomerCapabilities({ query });
  const projectTypeSelect = capabilities.hasReferralProjectType ? "r.project_type" : "NULL::text AS project_type";
  const preferredAgentIdSelect = capabilities.hasReferralLinkedAgent
    ? "r.linked_agent AS preferred_agent_id"
    : "NULL::text AS preferred_agent_id";
  const preferredAgentNameSelect =
    capabilities.hasReferralLinkedAgent && capabilities.hasAgentTable
      ? "preferred_agent.name AS preferred_agent_name"
      : "NULL::text AS preferred_agent_name";
  const preferredAgentJoin =
    capabilities.hasReferralLinkedAgent && capabilities.hasAgentTable
      ? "LEFT JOIN agent preferred_agent ON preferred_agent.id::text = r.linked_agent"
      : "";
  const assignedAgentIdSelect = capabilities.hasReferralAssignedAgent
    ? "r.assigned_agent AS assigned_agent_id"
    : "NULL::text AS assigned_agent_id";
  const assignedAgentNameSelect =
    capabilities.hasReferralAssignedAgent && capabilities.hasAgentTable
      ? "assigned_agent.name AS assigned_agent_name"
      : "NULL::text AS assigned_agent_name";
  const assignedAgentJoin =
    capabilities.hasReferralAssignedAgent && capabilities.hasAgentTable
      ? "LEFT JOIN agent assigned_agent ON assigned_agent.id::text = r.assigned_agent"
      : "";

  const result = await query<{
    id: number;
    bubble_id: string;
    lead_name: string;
    lead_mobile: string | null;
    lead_state: string | null;
    lead_city: string | null;
    lead_address: string | null;
    relationship: string | null;
    project_type: string | null;
    status: string | null;
    lead_customer_id: string | null;
    preferred_agent_id: string | null;
    preferred_agent_name: string | null;
    assigned_agent_id: string | null;
    assigned_agent_name: string | null;
    created_at: string | null;
    updated_at: string | null;
  }>(
    `
      SELECT
        r.id,
        r.bubble_id,
        r.name AS lead_name,
        r.mobile_number AS lead_mobile,
        ${buildLeadStateSelect(capabilities)},
        ${buildLeadCitySelect(capabilities)},
        ${buildLeadAddressSelect(capabilities)},
        r.relationship,
        ${projectTypeSelect},
        COALESCE(NULLIF(r.status, ''), 'Pending') AS status,
        r.linked_invoice AS lead_customer_id,
        ${preferredAgentIdSelect},
        ${preferredAgentNameSelect},
        ${assignedAgentIdSelect},
        ${assignedAgentNameSelect},
        r.created_at::text AS created_at,
        r.updated_at::text AS updated_at
      FROM referral r
      LEFT JOIN customer c ON c.customer_id = r.linked_invoice
      ${preferredAgentJoin}
      ${assignedAgentJoin}
      WHERE r.linked_customer_profile = $1
      ORDER BY r.created_at DESC NULLS LAST, r.id DESC
    `,
    [referrerCustomerId],
  );

  return result.rows.map((row) => {
    const mapped = mapReferralRow({
      ...row,
      referrer_customer_id: referrerCustomerId,
      referrer_customer_name: null,
    });

    return {
      id: mapped.id,
      bubbleId: mapped.bubbleId,
      leadName: mapped.leadName,
      leadMobile: mapped.leadMobile,
      leadState: mapped.leadState,
      leadCity: mapped.leadCity,
      leadAddress: mapped.leadAddress,
      relationship: mapped.relationship,
      projectType: mapped.projectType,
      status: mapped.status,
      leadCustomerId: mapped.leadCustomerId,
      preferredAgentId: mapped.preferredAgentId,
      preferredAgentName: mapped.preferredAgentName,
      assignedAgentId: mapped.assignedAgentId,
      assignedAgentName: mapped.assignedAgentName,
      createdAt: mapped.createdAt,
      updatedAt: mapped.updatedAt,
    };
  });
}

export async function listManagerReferralLeads(filters: ManagerReferralFilters = {}): Promise<ManagerReferralRow[]> {
  const capabilities = await getCustomerCapabilities({ query });
  const projectTypeSelect = capabilities.hasReferralProjectType ? "r.project_type" : "NULL::text AS project_type";
  const preferredAgentIdSelect = capabilities.hasReferralLinkedAgent
    ? "r.linked_agent AS preferred_agent_id"
    : "NULL::text AS preferred_agent_id";
  const preferredAgentNameSelect =
    capabilities.hasReferralLinkedAgent && capabilities.hasAgentTable
      ? "preferred_agent.name AS preferred_agent_name"
      : "NULL::text AS preferred_agent_name";
  const preferredAgentJoin =
    capabilities.hasReferralLinkedAgent && capabilities.hasAgentTable
      ? "LEFT JOIN agent preferred_agent ON preferred_agent.id::text = r.linked_agent"
      : "";
  const assignedAgentIdSelect = capabilities.hasReferralAssignedAgent
    ? "r.assigned_agent AS assigned_agent_id"
    : "NULL::text AS assigned_agent_id";
  const assignedAgentNameSelect =
    capabilities.hasReferralAssignedAgent && capabilities.hasAgentTable
      ? "assigned_agent.name AS assigned_agent_name"
      : "NULL::text AS assigned_agent_name";
  const assignedAgentJoin =
    capabilities.hasReferralAssignedAgent && capabilities.hasAgentTable
      ? "LEFT JOIN agent assigned_agent ON assigned_agent.id::text = r.assigned_agent"
      : "";

  const whereClauses: string[] = [];
  const values: unknown[] = [];

  if (filters.assignment === "assigned") {
    if (capabilities.hasReferralAssignedAgent) {
      whereClauses.push("r.assigned_agent IS NOT NULL AND BTRIM(r.assigned_agent) <> ''");
    } else {
      whereClauses.push("FALSE");
    }
  } else if (filters.assignment === "unassigned") {
    if (capabilities.hasReferralAssignedAgent) {
      whereClauses.push("(r.assigned_agent IS NULL OR BTRIM(r.assigned_agent) = '')");
    }
  }

  if (filters.status?.trim()) {
    values.push(filters.status.trim());
    whereClauses.push(`COALESCE(NULLIF(r.status, ''), 'Pending') = $${values.length}`);
  }

  if (filters.preferredAgentId?.trim() && capabilities.hasReferralLinkedAgent) {
    values.push(filters.preferredAgentId.trim());
    whereClauses.push(`r.linked_agent = $${values.length}`);
  }

  if (filters.assignedAgentId?.trim()) {
    if (capabilities.hasReferralAssignedAgent) {
      values.push(filters.assignedAgentId.trim());
      whereClauses.push(`r.assigned_agent = $${values.length}`);
    } else {
      whereClauses.push("FALSE");
    }
  }

  if (filters.search?.trim()) {
    values.push(`%${filters.search.trim()}%`);
    const searchParam = `$${values.length}`;
    whereClauses.push(`(
      r.name ILIKE ${searchParam}
      OR COALESCE(r.mobile_number, '') ILIKE ${searchParam}
    )`);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const result = await query<{
    id: number;
    bubble_id: string;
    lead_name: string;
    lead_mobile: string | null;
    lead_state: string | null;
    lead_city: string | null;
    lead_address: string | null;
    relationship: string | null;
    project_type: string | null;
    status: string | null;
    lead_customer_id: string | null;
    preferred_agent_id: string | null;
    preferred_agent_name: string | null;
    assigned_agent_id: string | null;
    assigned_agent_name: string | null;
    created_at: string | null;
    updated_at: string | null;
    referrer_customer_id: string;
    referrer_customer_name: string | null;
  }>(
    `
      SELECT
        r.id,
        r.bubble_id,
        r.name AS lead_name,
        r.mobile_number AS lead_mobile,
        ${buildLeadStateSelect(capabilities)},
        ${buildLeadCitySelect(capabilities)},
        ${buildLeadAddressSelect(capabilities)},
        r.relationship,
        ${projectTypeSelect},
        COALESCE(NULLIF(r.status, ''), 'Pending') AS status,
        r.linked_invoice AS lead_customer_id,
        ${preferredAgentIdSelect},
        ${preferredAgentNameSelect},
        ${assignedAgentIdSelect},
        ${assignedAgentNameSelect},
        r.created_at::text AS created_at,
        r.updated_at::text AS updated_at,
        r.linked_customer_profile AS referrer_customer_id,
        referrer.name AS referrer_customer_name
      FROM referral r
      LEFT JOIN customer c ON c.customer_id = r.linked_invoice
      LEFT JOIN customer referrer ON referrer.customer_id = r.linked_customer_profile
      ${preferredAgentJoin}
      ${assignedAgentJoin}
      ${whereSql}
      ORDER BY r.created_at DESC NULLS LAST, r.id DESC
    `,
    values,
  );

  return result.rows.map((row) => mapReferralRow(row));
}

export async function listAssignedReferrals(agentId: string): Promise<ManagerReferralRow[]> {
  return listManagerReferralLeads({
    assignedAgentId: agentId,
  });
}

export async function listAgentOptions(): Promise<AgentOption[]> {
  const capabilities = await getCustomerCapabilities({ query });

  if (!capabilities.hasAgentTable) {
    return [];
  }

  const canFilterSales =
    capabilities.hasAgentLinkedUserLogin && capabilities.hasUserTable && capabilities.hasUserAccessLevel;

  const result = await query<{
    id: number;
    name: string | null;
  }>(
    `
      SELECT a.id, a.name
      FROM agent a
      ${canFilterSales ? 'JOIN "user" u ON u.bubble_id = a.linked_user_login' : ""}
      WHERE a.name IS NOT NULL
        ${canFilterSales ? "AND EXISTS (SELECT 1 FROM unnest(u.access_level) AS x WHERE LOWER(x) LIKE '%sales%')" : ""}
        AND BTRIM(a.name) <> ''
      ORDER BY a.name ASC
    `,
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    name: row.name!.trim(),
  }));
}

export async function createReferral(
  referrer: ReferrerAccount,
  input: z.input<typeof referralInputSchema>,
): Promise<void> {
  const parsed = referralInputSchema.safeParse(input);

  if (!parsed.success) {
    throw new ReferralError(parsed.error.issues[0]?.message || "Invalid referral input");
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const capabilities = await getCustomerCapabilities(client);
    const leadCustomerId = randomId("cust");
    const referralBubbleId = randomId("reflead");
    const preferredAgentId = await normalizeAgentId(client, parsed.data.preferredAgentId, "Preferred agent");
    const metadata = {
      relationship: parsed.data.relationship,
      projectType: parsed.data.projectType,
      leadState: parsed.data.leadState,
      leadCity: parsed.data.leadCity,
      leadAddress: parsed.data.leadAddress,
      preferredAgentId,
      linkedReferrer: referrer.customerId,
      syncedFromReferralPortal: true,
      createdAt: new Date().toISOString(),
    };

    const customerColumns = [
      "customer_id",
      "name",
      "phone",
      "state",
      "city",
      "address",
      "lead_source",
      "remark",
      "notes",
      "created_by",
      "updated_by",
    ];
    const customerValues: unknown[] = [
      leadCustomerId,
      parsed.data.leadName,
      parsed.data.leadMobileNumber,
      parsed.data.leadState,
      parsed.data.leadCity || null,
      parsed.data.leadAddress || null,
      "referral",
      parsed.data.relationship,
      JSON.stringify(metadata),
      referrer.customerId,
      referrer.customerId,
    ];

    if (capabilities.hasLinkedReferrer) {
      customerColumns.push("linked_referrer");
      customerValues.push(referrer.customerId);
    }

    await client.query(
      `
        INSERT INTO customer (${customerColumns.join(", ")})
        VALUES (${customerValues.map((_, index) => `$${index + 1}`).join(", ")})
      `,
      customerValues,
    );

    const referralColumns = [
      "bubble_id",
      "linked_customer_profile",
      "name",
      "relationship",
      "mobile_number",
      "status",
      "linked_invoice",
    ];
    const referralValues: unknown[] = [
      referralBubbleId,
      referrer.customerId,
      parsed.data.leadName,
      parsed.data.relationship,
      parsed.data.leadMobileNumber,
      "Pending",
      leadCustomerId,
    ];

    if (capabilities.hasReferralProjectType) {
      referralColumns.push("project_type");
      referralValues.push(parsed.data.projectType);
    }

    if (capabilities.hasReferralLinkedAgent) {
      referralColumns.push("linked_agent");
      referralValues.push(preferredAgentId);
    }

    if (capabilities.hasReferralAssignedAgent) {
      referralColumns.push("assigned_agent");
      referralValues.push(null);
    }

    if (capabilities.hasReferralLeadState) {
      referralColumns.push("lead_state");
      referralValues.push(parsed.data.leadState);
    }

    if (capabilities.hasReferralLeadCity) {
      referralColumns.push("lead_city");
      referralValues.push(parsed.data.leadCity || null);
    }

    if (capabilities.hasReferralLeadAddress) {
      referralColumns.push("lead_address");
      referralValues.push(parsed.data.leadAddress || null);
    }

    await client.query(
      `
        INSERT INTO referral (${referralColumns.join(", ")})
        VALUES (${referralValues.map((_, index) => `$${index + 1}`).join(", ")})
      `,
      referralValues,
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");

    if (error instanceof ReferralError) {
      throw error;
    }

    throw new ReferralError("Unable to add this referral right now.");
  } finally {
    client.release();
  }
}

async function updateLeadRecord(
  client: PoolClient,
  leadCustomerId: string,
  referrerCustomerId: string,
  input: z.infer<typeof referralEditSchema>,
) {
  const capabilities = await getCustomerCapabilities(client);
  const preferredAgentId = await normalizeAgentId(client, input.preferredAgentId, "Preferred agent");
  const metadata = {
    relationship: input.relationship,
    projectType: input.projectType,
    leadState: input.leadState,
    leadCity: input.leadCity,
    leadAddress: input.leadAddress,
    preferredAgentId,
    linkedReferrer: referrerCustomerId,
    syncedFromReferralPortal: true,
    updatedAt: new Date().toISOString(),
  };

  const setClauses = [
    "name = $1",
    "phone = $2",
    "state = $3",
    "city = $4",
    "address = $5",
    "remark = $6",
    "notes = $7",
    "updated_by = $8",
    "updated_at = NOW()",
  ];
  const values: unknown[] = [
    input.leadName,
    input.leadMobileNumber,
    input.leadState,
    input.leadCity || null,
    input.leadAddress || null,
    input.relationship,
    JSON.stringify(metadata),
    referrerCustomerId,
  ];

  if (capabilities.hasLinkedReferrer) {
    setClauses.push(`linked_referrer = $${values.length + 1}`);
    values.push(referrerCustomerId);
  }

  values.push(leadCustomerId, referrerCustomerId);
  const leadCustomerIdParam = values.length - 1;
  const referrerParam = values.length;

  await client.query(
    `
      UPDATE customer
      SET ${setClauses.join(", ")}
      WHERE customer_id = $${leadCustomerIdParam}
        AND (
          lead_source = 'referral'
          OR notes LIKE '%"syncedFromReferralPortal":true%'
        )
        AND (
          created_by = $${referrerParam}
          OR notes LIKE $${referrerParam + 1}
        )
    `,
    [...values, `%"linkedReferrer":"${referrerCustomerId}"%`],
  );
}

export async function updateReferral(
  referrer: ReferrerAccount,
  input: z.input<typeof referralEditSchema>,
): Promise<void> {
  const parsed = referralEditSchema.safeParse(input);

  if (!parsed.success) {
    throw new ReferralError(parsed.error.issues[0]?.message || "Invalid referral update");
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const capabilities = await getCustomerCapabilities(client);
    const existing = await client.query<{
      id: number;
      linked_customer_profile: string;
      linked_invoice: string | null;
    }>(
      `
        SELECT id, linked_customer_profile, linked_invoice
        FROM referral
        WHERE id = $1
        FOR UPDATE
      `,
      [parsed.data.referralId],
    );

    if (existing.rows.length === 0) {
      throw new ReferralError("Referral record not found.");
    }

    if (existing.rows[0].linked_customer_profile !== referrer.customerId) {
      throw new ReferralError("You can only edit your own referrals.");
    }

    const preferredAgentId = await normalizeAgentId(client, parsed.data.preferredAgentId, "Preferred agent");
    const preferredAgentLabel = await getAgentLabel(client, preferredAgentId);
    const preferredAgentLogEntry = buildPreferredAgentLogEntry(referrer.name, preferredAgentLabel);
    const setClauses = ["name = $1", "mobile_number = $2", "relationship = $3"];
    const values: unknown[] = [parsed.data.leadName, parsed.data.leadMobileNumber, parsed.data.relationship];

    if (capabilities.hasReferralProjectType) {
      setClauses.push(`project_type = $${values.length + 1}`);
      values.push(parsed.data.projectType);
    }

    if (capabilities.hasReferralLinkedAgent) {
      setClauses.push(`linked_agent = $${values.length + 1}`);
      values.push(preferredAgentId);
    }

    if (capabilities.hasReferralPreferredAgentLog) {
      setClauses.push(`preferred_agent_log = CASE
        WHEN preferred_agent_log IS NULL OR BTRIM(preferred_agent_log) = '' THEN $${values.length + 1}
        ELSE preferred_agent_log || E'\\n' || $${values.length + 1}
      END`);
      values.push(preferredAgentLogEntry);
    }

    if (capabilities.hasReferralLeadState) {
      setClauses.push(`lead_state = $${values.length + 1}`);
      values.push(parsed.data.leadState);
    }

    if (capabilities.hasReferralLeadCity) {
      setClauses.push(`lead_city = $${values.length + 1}`);
      values.push(parsed.data.leadCity || null);
    }

    if (capabilities.hasReferralLeadAddress) {
      setClauses.push(`lead_address = $${values.length + 1}`);
      values.push(parsed.data.leadAddress || null);
    }

    setClauses.push("updated_at = NOW()");
    values.push(parsed.data.referralId);

    await client.query(
      `
        UPDATE referral
        SET ${setClauses.join(", ")}
        WHERE id = $${values.length}
      `,
      values,
    );

    if (existing.rows[0].linked_invoice) {
      await updateLeadRecord(client, existing.rows[0].linked_invoice, referrer.customerId, parsed.data);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");

    if (error instanceof ReferralError) {
      throw error;
    }

    throw new ReferralError("Unable to update this referral right now.");
  } finally {
    client.release();
  }
}

export async function updateReferralManagerWorkflow(input: z.input<typeof managerReferralUpdateSchema>): Promise<void> {
  const parsed = managerReferralUpdateSchema.safeParse(input);

  if (!parsed.success) {
    throw new ReferralError(parsed.error.issues[0]?.message || "Invalid referral workflow update");
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const capabilities = await getCustomerCapabilities(client);

    if (!capabilities.hasReferralAssignedAgent) {
      throw new ReferralError("Referral assignment columns are not available yet. Run the latest migration first.");
    }

    const assignedAgentId = await normalizeAgentId(client, parsed.data.assignedAgentId, "Assigned agent");

    await client.query(
      `
        UPDATE referral
        SET
          assigned_agent = $1,
          status = $2,
          updated_at = NOW()
        WHERE id = $3
      `,
      [assignedAgentId, parsed.data.status, parsed.data.referralId],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");

    if (error instanceof ReferralError) {
      throw error;
    }

    throw new ReferralError("Unable to update the referral workflow right now.");
  } finally {
    client.release();
  }
}

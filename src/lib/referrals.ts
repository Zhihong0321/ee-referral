import { z } from "zod";
import type { PoolClient, QueryResultRow } from "pg";

import type { AuthHubUser } from "@/lib/auth";
import { getPool, query } from "@/lib/db";

const REFERRAL_MARKER = "REFERRAL_ACCOUNT";
const LEGACY_REFERRER_MARKER = "REFERRER_ACCOUNT";
const REFERRAL_ACCOUNT_NAME = "Referral";
const APP_ACTOR = "referral_portal";

export const REFERRAL_STATUSES = ["Pending", "Qualified", "Proposal", "Won", "Lost"] as const;
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
export type RelationshipOption = (typeof RELATIONSHIP_OPTIONS)[number];
export const PROJECT_TYPE_OPTIONS = ["RESIDENTIAL (2%)", "SHOP-LOT (2%)", "FACTORY (1%)", "OTHERS"] as const;
export type ProjectTypeOption = (typeof PROJECT_TYPE_OPTIONS)[number];

const preferredAgentIdSchema = z
  .string()
  .trim()
  .max(20, "Preferred agent is invalid")
  .refine((value) => value === "" || /^\d+$/.test(value), "Preferred agent is invalid");

const referralInputSchema = z.object({
  leadName: z.string().trim().min(2, "Lead name is required"),
  leadMobileNumber: z.string().trim().min(6, "Lead mobile number is required"),
  livingRegion: z.string().trim().min(2, "Living region is required"),
  relationship: z.enum(RELATIONSHIP_OPTIONS),
  projectType: z.enum(PROJECT_TYPE_OPTIONS),
  preferredAgentId: preferredAgentIdSchema.optional().default(""),
});

const referralUpdateSchema = referralInputSchema.extend({
  referralId: z.coerce.number().int().positive(),
  status: z.enum(REFERRAL_STATUSES),
});

const referrerProfileSchema = z.object({
  displayName: z.string().trim().min(2, "Name is required").max(80, "Name is too long"),
  profilePicture: z
    .string()
    .trim()
    .max(500, "Profile picture URL is too long")
    .refine((value) => value === "" || URL.canParse(value), "Profile picture must be a valid URL"),
  bankAccount: z
    .string()
    .trim()
    .min(4, "Banking account is required")
    .max(80, "Banking account is too long"),
  bankerName: z.string().trim().min(2, "Banker name is required").max(80, "Banker name is too long"),
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
  livingRegion: string | null;
  relationship: string | null;
  projectType: string | null;
  status: string | null;
  leadCustomerId: string | null;
  preferredAgentId: string | null;
  preferredAgentName: string | null;
  createdAt: string | null;
};

export type AgentOption = {
  id: string;
  name: string;
};

type CustomerCapabilities = {
  hasLinkedReferrer: boolean;
  hasReferralProjectType: boolean;
  hasReferralLinkedAgent: boolean;
  hasAgentTable: boolean;
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
    has_agent_table: boolean;
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
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'agent'
    ) AS has_agent_table
  `);

  const capabilities = {
    hasLinkedReferrer: result.rows[0]?.has_linked_referrer ?? false,
    hasReferralProjectType: result.rows[0]?.has_referral_project_type ?? false,
    hasReferralLinkedAgent: result.rows[0]?.has_referral_linked_agent ?? false,
    hasAgentTable: result.rows[0]?.has_agent_table ?? false,
  };

  cachedCustomerCapabilities = capabilities;
  return capabilities;
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
        [
          REFERRAL_ACCOUNT_NAME,
          phone,
          REFERRAL_MARKER,
          APP_ACTOR,
          current.customer_id,
        ],
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

    const existing = await client.query<{
      notes: string | null;
    }>(
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
      ? "a.name AS preferred_agent_name"
      : "NULL::text AS preferred_agent_name";
  const agentJoin =
    capabilities.hasReferralLinkedAgent && capabilities.hasAgentTable ? "LEFT JOIN agent a ON a.id::text = r.linked_agent" : "";

  const result = await query<{
    id: number;
    bubble_id: string;
    lead_name: string;
    lead_mobile: string | null;
    living_region: string | null;
    relationship: string | null;
    project_type: string | null;
    status: string | null;
    lead_customer_id: string | null;
    preferred_agent_id: string | null;
    preferred_agent_name: string | null;
    created_at: string | null;
  }>(
    `
      SELECT
        r.id,
        r.bubble_id,
        r.name AS lead_name,
        r.mobile_number AS lead_mobile,
        c.state AS living_region,
        r.relationship,
        ${projectTypeSelect},
        r.status,
        r.linked_invoice AS lead_customer_id,
        ${preferredAgentIdSelect},
        ${preferredAgentNameSelect},
        r.created_at::text AS created_at
      FROM referral r
      LEFT JOIN customer c ON c.customer_id = r.linked_invoice
      ${agentJoin}
      WHERE r.linked_customer_profile = $1
      ORDER BY r.created_at DESC, r.id DESC
    `,
    [referrerCustomerId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    bubbleId: row.bubble_id,
    leadName: row.lead_name,
    leadMobile: row.lead_mobile,
    livingRegion: row.living_region,
    relationship: row.relationship,
    projectType: row.project_type,
    status: row.status,
    leadCustomerId: row.lead_customer_id,
    preferredAgentId: row.preferred_agent_id,
    preferredAgentName: row.preferred_agent_name,
    createdAt: row.created_at,
  }));
}

export async function listAgentOptions(): Promise<AgentOption[]> {
  const capabilities = await getCustomerCapabilities({ query });

  if (!capabilities.hasAgentTable) {
    return [];
  }

  const result = await query<{
    id: number;
    name: string | null;
  }>(
    `
      SELECT id, name
      FROM agent
      WHERE name IS NOT NULL
        AND BTRIM(name) <> ''
      ORDER BY name ASC
    `,
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    name: row.name!.trim(),
  }));
}

async function normalizePreferredAgentId(client: PoolClient, preferredAgentId: string): Promise<string | null> {
  const capabilities = await getCustomerCapabilities(client);
  const normalized = preferredAgentId.trim();

  if (!normalized) {
    return null;
  }

  if (!capabilities.hasAgentTable) {
    return null;
  }

  const existing = await client.query<{ id: number }>(
    `
      SELECT id
      FROM agent
      WHERE id = $1
      LIMIT 1
    `,
    [Number(normalized)],
  );

  if (existing.rows.length === 0) {
    throw new ReferralError("Preferred agent was not found.");
  }

  return normalized;
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
    const preferredAgentId = await normalizePreferredAgentId(client, parsed.data.preferredAgentId);
    const metadata = {
      relationship: parsed.data.relationship,
      projectType: parsed.data.projectType,
      livingRegion: parsed.data.livingRegion,
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
      parsed.data.livingRegion,
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

    const placeholders = customerValues.map((_, index) => `$${index + 1}`).join(", ");

    await client.query(
      `
        INSERT INTO customer (${customerColumns.join(", ")})
        VALUES (${placeholders})
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

    const referralPlaceholders = referralValues.map((_, index) => `$${index + 1}`).join(", ");

    await client.query(
      `
        INSERT INTO referral (${referralColumns.join(", ")})
        VALUES (${referralPlaceholders})
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
  input: z.infer<typeof referralUpdateSchema>,
) {
  const capabilities = await getCustomerCapabilities(client);
  const preferredAgentId = await normalizePreferredAgentId(client, input.preferredAgentId);
  const metadata = {
    relationship: input.relationship,
    projectType: input.projectType,
    livingRegion: input.livingRegion,
    preferredAgentId,
    linkedReferrer: referrerCustomerId,
    syncedFromReferralPortal: true,
    updatedAt: new Date().toISOString(),
  };

  const setClauses = [
    "name = $1",
    "phone = $2",
    "state = $3",
    "remark = $4",
    "notes = $5",
    "updated_by = $6",
    "updated_at = NOW()",
  ];

  const values: unknown[] = [
    input.leadName,
    input.leadMobileNumber,
    input.livingRegion,
    input.relationship,
    JSON.stringify(metadata),
    referrerCustomerId,
  ];

  if (capabilities.hasLinkedReferrer) {
    setClauses.push("linked_referrer = $7");
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
  input: z.input<typeof referralUpdateSchema>,
): Promise<void> {
  const parsed = referralUpdateSchema.safeParse(input);

  if (!parsed.success) {
    throw new ReferralError(parsed.error.issues[0]?.message || "Invalid referral update");
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

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

    const setClauses = ["name = $1", "mobile_number = $2", "relationship = $3", "status = $4"];
    const values: unknown[] = [
      parsed.data.leadName,
      parsed.data.leadMobileNumber,
      parsed.data.relationship,
      parsed.data.status,
    ];

    if ((await getCustomerCapabilities(client)).hasReferralProjectType) {
      setClauses.push(`project_type = $${values.length + 1}`);
      values.push(parsed.data.projectType);
    }

    if ((await getCustomerCapabilities(client)).hasReferralLinkedAgent) {
      setClauses.push(`linked_agent = $${values.length + 1}`);
      values.push(await normalizePreferredAgentId(client, parsed.data.preferredAgentId));
    }

    setClauses.push("updated_at = NOW()");
    values.push(parsed.data.referralId);

    await client.query(
      `
        UPDATE referral
        SET
          ${setClauses.join(", ")}
        WHERE id = $${values.length}
      `,
      values,
    );

    if (existing.rows[0].linked_invoice) {
      await updateLeadRecord(
        client,
        existing.rows[0].linked_invoice,
        referrer.customerId,
        parsed.data,
      );
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

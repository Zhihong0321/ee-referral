import { z } from "zod";
import type { PoolClient, QueryResultRow } from "pg";

import type { AuthHubUser } from "@/lib/auth";
import { getPool, query } from "@/lib/db";

const REFERRAL_MARKER = "REFERRAL_ACCOUNT";
const LEGACY_REFERRER_MARKER = "REFERRER_ACCOUNT";
const REFERRAL_ACCOUNT_NAME = "Referral";
const APP_ACTOR = "referral_portal";

export const REFERRAL_STATUSES = ["Pending", "Qualified", "Proposal", "Won", "Lost"] as const;

const referralInputSchema = z.object({
  leadName: z.string().trim().min(2, "Lead name is required"),
  leadMobileNumber: z.string().trim().min(6, "Lead mobile number is required"),
  livingRegion: z.string().trim().min(2, "Living region is required"),
  relationship: z.string().trim().min(2, "Relationship is required"),
});

const referralUpdateSchema = referralInputSchema.extend({
  referralId: z.coerce.number().int().positive(),
  status: z.enum(REFERRAL_STATUSES),
});

export class ReferralError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferralError";
  }
}

export type ReferrerAccount = {
  customerId: string;
  name: string | null;
  phone: string | null;
};

export type ReferralRow = {
  id: number;
  bubbleId: string;
  leadName: string;
  leadMobile: string | null;
  livingRegion: string | null;
  relationship: string | null;
  status: string | null;
  leadCustomerId: string | null;
  createdAt: string | null;
};

type CustomerCapabilities = {
  hasLinkedReferrer: boolean;
};

type Queryable = {
  query<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

let cachedCustomerCapabilities: CustomerCapabilities | null = null;

function randomId(prefix: string) {
  const segment = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${prefix}_${segment}`;
}

function normalizePhone(phone: string) {
  return phone.replace(/\s+/g, "").trim();
}

async function getCustomerCapabilities(executor: Queryable): Promise<CustomerCapabilities> {
  if (cachedCustomerCapabilities) {
    return cachedCustomerCapabilities;
  }

  const result = await executor.query<{ has_linked_referrer: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'customer'
        AND column_name = 'linked_referrer'
    ) AS has_linked_referrer
  `);

  const capabilities = {
    hasLinkedReferrer: result.rows[0]?.has_linked_referrer ?? false,
  };

  cachedCustomerCapabilities = capabilities;
  return capabilities;
}

export async function findOrCreateReferrerAccount(authUser: AuthHubUser): Promise<ReferrerAccount> {
  const phone = normalizePhone(authUser.phone);

  if (!phone) {
    throw new ReferralError("Your WhatsApp phone is missing from the auth token.");
  }

  const existing = await query<{
    customer_id: string;
    name: string | null;
    phone: string | null;
  }>(
    `
      SELECT customer_id, name, phone
      FROM customer
      WHERE phone = $1
        AND remark = ANY($2::text[])
      ORDER BY id DESC
      LIMIT 1
    `,
    [phone, [REFERRAL_MARKER, LEGACY_REFERRER_MARKER]],
  );

  if (existing.rows.length > 0) {
    if (existing.rows[0].name !== REFERRAL_ACCOUNT_NAME || existing.rows[0].phone !== phone) {
      await query(
        `
          UPDATE customer
          SET
            name = $1,
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
          existing.rows[0].customer_id,
        ],
      );
    }

    return {
      customerId: existing.rows[0].customer_id,
      name: REFERRAL_ACCOUNT_NAME,
      phone,
    };
  }

  const generatedCustomerId = randomId("ref");
  const fallbackName = REFERRAL_ACCOUNT_NAME;
  const notes = JSON.stringify({
    kind: "referral_account",
    source: "whatsapp_auth",
    createdAt: new Date().toISOString(),
  });

  const inserted = await query<{
    customer_id: string;
    name: string | null;
    phone: string | null;
  }>(
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
      RETURNING customer_id, name, phone
    `,
    [generatedCustomerId, fallbackName, phone, REFERRAL_MARKER, notes, APP_ACTOR],
  );

  return {
    customerId: inserted.rows[0].customer_id,
    name: inserted.rows[0].name,
    phone: inserted.rows[0].phone,
  };
}

export async function listReferralsByReferrer(referrerCustomerId: string): Promise<ReferralRow[]> {
  const result = await query<{
    id: number;
    bubble_id: string;
    lead_name: string;
    lead_mobile: string | null;
    living_region: string | null;
    relationship: string | null;
    status: string | null;
    lead_customer_id: string | null;
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
        r.status,
        r.linked_invoice AS lead_customer_id,
        r.created_at::text AS created_at
      FROM referral r
      LEFT JOIN customer c ON c.customer_id = r.linked_invoice
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
    status: row.status,
    leadCustomerId: row.lead_customer_id,
    createdAt: row.created_at,
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
    const metadata = {
      relationship: parsed.data.relationship,
      livingRegion: parsed.data.livingRegion,
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

    await client.query(
      `
        INSERT INTO referral (
          bubble_id,
          linked_customer_profile,
          name,
          relationship,
          mobile_number,
          status,
          linked_invoice
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        referralBubbleId,
        referrer.customerId,
        parsed.data.leadName,
        parsed.data.relationship,
        parsed.data.leadMobileNumber,
        "Pending",
        leadCustomerId,
      ],
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
  const metadata = {
    relationship: input.relationship,
    livingRegion: input.livingRegion,
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

    await client.query(
      `
        UPDATE referral
        SET
          name = $1,
          mobile_number = $2,
          relationship = $3,
          status = $4,
          updated_at = NOW()
        WHERE id = $5
      `,
      [
        parsed.data.leadName,
        parsed.data.leadMobileNumber,
        parsed.data.relationship,
        parsed.data.status,
        parsed.data.referralId,
      ],
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

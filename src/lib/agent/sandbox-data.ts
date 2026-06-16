import {
  findReferrerAccountByPhone,
  listReferralsByReferrer,
  type ReferralRow,
  type ReferrerAccount,
} from "@/lib/referrals";

const REFERRAL_MARKER = "REFERRAL_ACCOUNT";
const LEGACY_REFERRER_MARKER = "REFERRER_ACCOUNT";
const REFERRAL_ACCOUNT_NAME = "Referral";
const APP_ACTOR = "referral_portal";

type ProxySqlResponse<T> = {
  rows: T[];
  rowCount?: number;
};

type ProxyReferrerRow = {
  customer_id: string;
  name: string | null;
  phone: string | null;
  profile_picture: string | null;
  notes: string | null;
  remark: string | null;
};

type ProxyReferralRow = {
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
  lead_notes: string | null;
};

type LeadCreateInput = {
  phone: string;
  leadName: string;
  leadMobileNumber: string;
  leadState: string;
  leadCity: string;
  leadAddress: string;
  relationship: string;
  projectType: string;
  preferredAgentId: string;
  remark: string;
};

function randomId(prefix: string) {
  const segment = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${prefix}_${segment}`;
}

function normalizePhone(phone: string) {
  return phone.replace(/\s+/g, "").trim();
}

function parseNotes(notes: string | null) {
  if (!notes) {
    return {};
  }

  try {
    const parsed = JSON.parse(notes) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}

  return {};
}

function buildReferrerAccount(row: ProxyReferrerRow, fallbackPhone: string): ReferrerAccount {
  const noteData = parseNotes(row.notes);

  return {
    customerId: row.customer_id,
    name: row.name?.trim() || REFERRAL_ACCOUNT_NAME,
    phone: row.phone?.trim() || fallbackPhone,
    profilePicture: row.profile_picture,
    bankAccount: typeof noteData.bankAccount === "string" ? noteData.bankAccount : "",
    bankerName: typeof noteData.bankerName === "string" ? noteData.bankerName : "",
  };
}

function buildReferralRow(row: ProxyReferralRow): ReferralRow {
  const leadNotes = parseNotes(row.lead_notes);
  const remark = typeof leadNotes.remark === "string" && leadNotes.remark ? leadNotes.remark : null;

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
    remark,
  };
}

function getProxyConfig() {
  const baseUrl = process.env.SANDBOX_PROXY_URL?.trim();
  const authorization = process.env.SANDBOX_PROXY_AUTH?.trim();
  const dbName = process.env.SANDBOX_PROXY_DB_NAME?.trim();

  if (!baseUrl || !authorization || !dbName) {
    return null;
  }

  return {
    sqlUrl: `${baseUrl.replace(/\/$/, "")}/api/sql`,
    authorization,
    dbName,
  };
}

export function hasSandboxProxyConfig() {
  return Boolean(getProxyConfig());
}

async function runProxySql<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const config = getProxyConfig();

  if (!config) {
    throw new Error("Sandbox proxy is not configured.");
  }

  const response = await fetch(config.sqlUrl, {
    method: "POST",
    headers: {
      Authorization: config.authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      db_name: config.dbName,
      sql,
      params,
    }),
    cache: "no-store",
  });

  const payload = (await response.json()) as ProxySqlResponse<T> & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || "Sandbox proxy query failed.");
  }

  return payload.rows || [];
}

export async function getSandboxReferrerByPhone(phoneInput: string): Promise<ReferrerAccount | null> {
  const phone = normalizePhone(phoneInput);

  if (!phone) {
    return null;
  }

  if (!hasSandboxProxyConfig()) {
    return findReferrerAccountByPhone(phone);
  }

  const rows = await runProxySql<ProxyReferrerRow>(
    `
      SELECT customer_id, name, phone, profile_picture, notes, remark
      FROM customer
      WHERE phone = $1
        AND remark IN ($2, $3)
      ORDER BY id DESC
      LIMIT 1
    `,
    [phone, REFERRAL_MARKER, LEGACY_REFERRER_MARKER],
  );

  if (rows.length === 0) {
    return null;
  }

  return buildReferrerAccount(rows[0], phone);
}

export async function ensureSandboxReferrerByPhone(phoneInput: string): Promise<ReferrerAccount> {
  const phone = normalizePhone(phoneInput);

  if (!phone) {
    throw new Error("Sandbox phone is required.");
  }

  if (!hasSandboxProxyConfig()) {
    const existing = await findReferrerAccountByPhone(phone);
    if (!existing) {
      throw new Error("Sandbox write mode requires SANDBOX proxy configuration when no DATABASE_URL is present.");
    }
    return existing;
  }

  const generatedCustomerId = randomId("ref");
  const notes = JSON.stringify({
    kind: "referral_account",
    source: "sandbox_phone_identity",
    bankAccount: "",
    bankerName: "",
    createdAt: new Date().toISOString(),
  });

  const rows = await runProxySql<ProxyReferrerRow>(
    `
      WITH existing AS (
        SELECT customer_id, name, phone, profile_picture, notes, remark
        FROM customer
        WHERE phone = $1
          AND remark IN ($2, $3)
        ORDER BY id DESC
        LIMIT 1
      ),
      inserted AS (
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
        SELECT $4, $5, $1, 'other', $2, $6, $7, $7
        WHERE NOT EXISTS (SELECT 1 FROM existing)
        RETURNING customer_id, name, phone, profile_picture, notes, remark
      )
      SELECT customer_id, name, phone, profile_picture, notes, remark FROM existing
      UNION ALL
      SELECT customer_id, name, phone, profile_picture, notes, remark FROM inserted
      LIMIT 1
    `,
    [phone, REFERRAL_MARKER, LEGACY_REFERRER_MARKER, generatedCustomerId, REFERRAL_ACCOUNT_NAME, notes, APP_ACTOR],
  );

  return buildReferrerAccount(rows[0], phone);
}

export async function listSandboxReferralsByReferrer(referrerCustomerId: string): Promise<ReferralRow[]> {
  if (!hasSandboxProxyConfig()) {
    return listReferralsByReferrer(referrerCustomerId);
  }

  const rows = await runProxySql<ProxyReferralRow>(
    `
      SELECT
        r.id,
        r.bubble_id,
        r.name AS lead_name,
        r.mobile_number AS lead_mobile,
        c.state AS lead_state,
        c.city AS lead_city,
        c.address AS lead_address,
        r.relationship,
        r.project_type,
        COALESCE(NULLIF(r.status, ''), 'Pending') AS status,
        r.linked_invoice AS lead_customer_id,
        r.linked_agent AS preferred_agent_id,
        preferred_agent.name AS preferred_agent_name,
        NULL::text AS assigned_agent_id,
        NULL::text AS assigned_agent_name,
        r.created_at::text AS created_at,
        r.updated_at::text AS updated_at,
        c.notes AS lead_notes
      FROM referral r
      LEFT JOIN customer c ON c.customer_id = r.linked_invoice
      LEFT JOIN "user" preferred_agent ON preferred_agent.id::text = r.linked_agent
      WHERE r.linked_customer_profile = $1
      ORDER BY r.created_at DESC NULLS LAST, r.id DESC
    `,
    [referrerCustomerId],
  );

  return rows.map((row) => buildReferralRow(row));
}

export async function createSandboxReferral(input: LeadCreateInput): Promise<{ referralId: number; referrer: ReferrerAccount }> {
  if (!hasSandboxProxyConfig()) {
    throw new Error("Sandbox lead creation requires SANDBOX proxy configuration in this environment.");
  }

  const referrer = await ensureSandboxReferrerByPhone(input.phone);
  const leadCustomerId = randomId("cust");
  const referralBubbleId = randomId("reflead");
  const metadata = JSON.stringify({
    relationship: input.relationship,
    projectType: input.projectType,
    leadState: input.leadState,
    leadCity: input.leadCity,
    leadAddress: input.leadAddress,
    preferredAgentId: input.preferredAgentId || "",
    linkedReferrer: referrer.customerId,
    syncedFromReferralPortal: true,
    remark: input.remark,
    createdAt: new Date().toISOString(),
    createdBy: "agent_sandbox",
  });

  const rows = await runProxySql<{ id: number }>(
    `
      WITH inserted_customer AS (
        INSERT INTO customer (
          customer_id,
          name,
          phone,
          state,
          city,
          address,
          lead_source,
          remark,
          notes,
          created_by,
          updated_by
        )
        VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''), 'referral', $7, $8, $9, $9)
        RETURNING customer_id
      )
      INSERT INTO referral (
        bubble_id,
        linked_customer_profile,
        name,
        relationship,
        mobile_number,
        status,
        linked_invoice,
        project_type,
        linked_agent
      )
      SELECT
        $10,
        $11,
        $2,
        $7,
        $3,
        'Pending',
        inserted_customer.customer_id,
        $12,
        NULLIF($13, '')
      FROM inserted_customer
      RETURNING id
    `,
    [
      leadCustomerId,
      input.leadName,
      input.leadMobileNumber,
      input.leadState,
      input.leadCity,
      input.leadAddress,
      input.relationship,
      metadata,
      referrer.customerId,
      referralBubbleId,
      referrer.customerId,
      input.projectType,
      input.preferredAgentId,
    ],
  );

  return {
    referralId: rows[0].id,
    referrer,
  };
}

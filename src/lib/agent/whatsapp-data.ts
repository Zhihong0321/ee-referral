import { PROJECT_TYPE_OPTIONS, RELATIONSHIP_OPTIONS, type ProjectTypeOption, type ReferralRow, type RelationshipOption } from "@/lib/referrals";
import { buildPhoneMatchCandidates, toCanonicalMalaysiaPhone } from "@/lib/phone-normalization";
import { query } from "@/lib/db";

const DEFAULT_TENANT_ID = 1;
const REFERRAL_MARKER = "REFERRAL_ACCOUNT";
const LEGACY_REFERRER_MARKER = "REFERRER_ACCOUNT";
const REFERRAL_ACCOUNT_NAME = "Referral";
const APP_ACTOR = "whatsapp_agent";

export type WhatsappAgentState = {
  mode: "idle" | "collecting_lead" | "confirming_lead" | "selecting_update_lead" | "selecting_update_field" | "collecting_update_value" | "confirming_update";
  draft: Partial<WhatsappLeadDraft>;
  nextField: WhatsappLeadField | null;
  update?: Partial<WhatsappUpdateDraft>;
  lastLeadList?: Array<{ index: number; referralId: number; leadName: string }>;
};

export type WhatsappLeadDraft = {
  leadName: string;
  leadMobileNumber: string;
  leadState: string;
  leadCity: string;
  leadAddress: string;
  relationship: RelationshipOption;
  projectType: ProjectTypeOption;
  remark: string;
};

export type WhatsappLeadField = keyof WhatsappLeadDraft;

export type WhatsappUpdateField = WhatsappLeadField;

export type WhatsappUpdateDraft = {
  referralId: number;
  field: WhatsappUpdateField;
  value: string;
};

export const EMPTY_WHATSAPP_AGENT_STATE: WhatsappAgentState = {
  mode: "idle",
  draft: {},
  nextField: null,
};

export type WhatsappInboundRow = {
  id: string;
  session_identifier: string;
  external_message_id: string;
  sender_jid: string;
  sender_phone: string | null;
  recipient_phone: string | null;
  message_type: string | null;
  raw_payload: Record<string, unknown>;
  media_url: string | null;
  process_status: string;
  process_attempts: number;
  created_at: string;
};

export type WhatsappReferrerAccount = {
  customerId: string;
  name: string;
  phone: string;
};

export type WhatsappAdminReferralRow = ReferralRow & {
  referrerCustomerId: string;
  referrerName: string | null;
  referrerPhone: string | null;
};

type ProxySqlResponse<T> = {
  rows?: T[];
  rowCount?: number;
  error?: string;
};

type ReferrerRow = {
  customer_id: string;
  name: string | null;
  phone: string | null;
  match_rank: number;
  match_index: number;
  is_generic_name: boolean;
};

type ReferralSelectRow = {
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

type AdminReferralSelectRow = ReferralSelectRow & {
  referrer_customer_id: string;
  referrer_name: string | null;
  referrer_phone: string | null;
};

function getAgentConfig() {
  const proxyUrl = process.env.WHATSAPP_AGENT_PROXY_URL?.trim() || process.env.SANDBOX_PROXY_URL?.trim();
  const proxyAuth = process.env.WHATSAPP_AGENT_PROXY_AUTH?.trim() || process.env.SANDBOX_PROXY_AUTH?.trim();
  const dbName = process.env.WHATSAPP_AGENT_PROXY_DB_NAME?.trim() || process.env.SANDBOX_PROXY_DB_NAME?.trim();
  const baileysBaseUrl = (process.env.WHATSAPP_AGENT_BAILEYS_BASE_URL?.trim() || "https://ee-baileys-2.up.railway.app").replace(/\/$/, "");
  const sessionId = process.env.WHATSAPP_AGENT_BAILEYS_SESSION_ID?.trim() || "0182920127";
  const tenantId = Number(process.env.WHATSAPP_AGENT_TENANT_ID || DEFAULT_TENANT_ID);

  return {
    sqlUrl: proxyUrl ? `${proxyUrl.replace(/\/$/, "")}/api/sql` : "",
    proxyAuth: proxyAuth || "",
    dbName: dbName || "",
    baileysBaseUrl,
    sessionId,
    tenantId: Number.isFinite(tenantId) ? tenantId : DEFAULT_TENANT_ID,
  };
}

export async function runWhatsappAgentSql<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const proxyUrl = process.env.WHATSAPP_AGENT_PROXY_URL?.trim() || process.env.SANDBOX_PROXY_URL?.trim();
  const proxyAuth = process.env.WHATSAPP_AGENT_PROXY_AUTH?.trim() || process.env.SANDBOX_PROXY_AUTH?.trim();
  const dbName = process.env.WHATSAPP_AGENT_PROXY_DB_NAME?.trim() || process.env.SANDBOX_PROXY_DB_NAME?.trim();

  if (!proxyUrl || !proxyAuth || !dbName) {
    const result = await query(sql, params);
    return result.rows as T[];
  }

  const config = getAgentConfig();
  const response = await fetch(config.sqlUrl, {
    method: "POST",
    headers: {
      Authorization: config.proxyAuth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      db_name: config.dbName,
      sql,
      params,
    }),
    cache: "no-store",
  });
  const payload = (await response.json()) as ProxySqlResponse<T>;

  if (!response.ok || payload.error) {
    throw new Error(payload.error || "WhatsApp agent SQL query failed.");
  }

  return payload.rows || [];
}

export function getWhatsappAgentRuntimeConfig() {
  return getAgentConfig();
}

export function isWhatsappSuperAdminPhone(phone: string) {
  const configured = (process.env.WHATSAPP_AGENT_SUPER_ADMIN_PHONES || "601121000099")
    .split(",")
    .map((value) => toCanonicalMalaysiaPhone(value.trim()))
    .filter(Boolean);
  const canonical = toCanonicalMalaysiaPhone(phone);

  return configured.includes(canonical);
}

export function extractTextFromPayload(rawPayload: Record<string, unknown>) {
  const message = rawPayload.message as Record<string, unknown> | undefined;
  const conversation = message?.conversation;
  const extendedText = (message?.extendedTextMessage as Record<string, unknown> | undefined)?.text;

  if (typeof conversation === "string" && conversation.trim()) {
    return conversation.trim();
  }

  if (typeof extendedText === "string" && extendedText.trim()) {
    return extendedText.trim();
  }

  return "";
}

export async function listPendingWhatsappInbound(limit: number, afterId = 0, includeFailed = false) {
  const config = getAgentConfig();

  return runWhatsappAgentSql<WhatsappInboundRow>(
    `
      SELECT
        id::text,
        session_identifier,
        external_message_id,
        sender_jid,
        sender_phone,
        recipient_phone,
        message_type,
        raw_payload,
        media_url,
        process_status,
        process_attempts,
        created_at::text
      FROM wa_inbound_inbox
      WHERE session_identifier = $1
        AND (
          process_status = 'pending'
          OR ($4::boolean = true AND process_status = 'failed')
        )
        AND id > $3::bigint
      ORDER BY created_at ASC, id ASC
      LIMIT $2
    `,
    [config.sessionId, limit, afterId, includeFailed],
  );
}

export async function getLatestWhatsappInboundId() {
  const config = getAgentConfig();
  const rows = await runWhatsappAgentSql<{ max_id: string | number }>(
    `
      SELECT COALESCE(MAX(id), 0) AS max_id
      FROM wa_inbound_inbox
      WHERE session_identifier = $1
    `,
    [config.sessionId],
  );

  return Number(rows[0]?.max_id || 0);
}

export async function ensureChannelSession() {
  const config = getAgentConfig();
  const rows = await runWhatsappAgentSql<{ id: number; metadata: Record<string, unknown> }>(
    `
      WITH existing AS (
        SELECT id, metadata
        FROM et_channel_sessions
        WHERE tenant_id = $1
          AND channel_type = 'whatsapp'
          AND session_identifier = $2
        ORDER BY id ASC
        LIMIT 1
      ),
      inserted AS (
        INSERT INTO et_channel_sessions (tenant_id, channel_type, session_identifier, metadata)
        SELECT $1, 'whatsapp', $2, '{}'::jsonb
        WHERE NOT EXISTS (SELECT 1 FROM existing)
        RETURNING id, metadata
      )
      SELECT id, metadata FROM existing
      UNION ALL
      SELECT id, metadata FROM inserted
      LIMIT 1
    `,
    [config.tenantId, config.sessionId],
  );

  if (!rows[0]) {
    throw new Error("Unable to ensure WhatsApp channel session.");
  }

  return rows[0];
}

export async function loadAgentState(senderPhone: string): Promise<WhatsappAgentState> {
  const session = await ensureChannelSession();
  const metadata = session.metadata || {};
  const states = metadata.agentStates as Record<string, WhatsappAgentState> | undefined;
  const canonicalPhone = toCanonicalMalaysiaPhone(senderPhone);
  const state = states?.[canonicalPhone];

  if (!state || !state.mode) {
    return EMPTY_WHATSAPP_AGENT_STATE;
  }

  return {
    mode: state.mode,
    draft: state.draft || {},
    nextField: state.nextField || null,
    update: state.update || {},
    lastLeadList: state.lastLeadList || [],
  };
}

export async function saveAgentState(senderPhone: string, state: WhatsappAgentState) {
  const config = getAgentConfig();
  const canonicalPhone = toCanonicalMalaysiaPhone(senderPhone);

  await ensureChannelSession();
  await runWhatsappAgentSql(
    `
      UPDATE et_channel_sessions
      SET
        metadata = jsonb_set(
          jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            '{agentStates}',
            COALESCE(metadata->'agentStates', '{}'::jsonb),
            true
          ),
          ARRAY['agentStates', $3],
          $4::jsonb,
          true
        ),
        updated_at = NOW()
      WHERE tenant_id = $1
        AND channel_type = 'whatsapp'
        AND session_identifier = $2
    `,
    [config.tenantId, config.sessionId, canonicalPhone, JSON.stringify(state)],
  );
}

export async function resolveOrCreateReferrerByWhatsappPhone(senderPhone: string): Promise<WhatsappReferrerAccount> {
  const candidates = buildPhoneMatchCandidates(senderPhone);
  const values = candidates.map((candidate) => candidate.value);

  const rows = await runWhatsappAgentSql<ReferrerRow>(
    `
      WITH candidates AS (
        SELECT value, rank, ordinality::int AS match_index
        FROM unnest($1::text[], $2::int[]) WITH ORDINALITY AS c(value, rank, ordinality)
      )
      SELECT
        c.customer_id,
        c.name,
        c.phone,
        candidates.rank AS match_rank,
        candidates.match_index,
        lower(COALESCE(NULLIF(c.name, ''), $5)) = lower($5) AS is_generic_name
      FROM customer c
      JOIN candidates ON c.phone = candidates.value
      WHERE c.remark IN ($3, $4)
      ORDER BY
        candidates.rank ASC,
        candidates.match_index ASC,
        is_generic_name ASC,
        c.created_at ASC NULLS LAST,
        c.id ASC
      LIMIT 1
    `,
    [values, candidates.map((candidate) => candidate.rank), REFERRAL_MARKER, LEGACY_REFERRER_MARKER, REFERRAL_ACCOUNT_NAME],
  );

  if (rows[0]) {
    return {
      customerId: rows[0].customer_id,
      name: rows[0].name?.trim() || REFERRAL_ACCOUNT_NAME,
      phone: rows[0].phone || senderPhone,
    };
  }

  const canonicalPhone = toCanonicalMalaysiaPhone(senderPhone);
  const generatedCustomerId = `ref_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const notes = JSON.stringify({
    kind: "referral_account",
    source: "whatsapp_agent",
    originalWhatsappPhone: senderPhone,
    canonicalPhone,
    createdAt: new Date().toISOString(),
  });

  const inserted = await runWhatsappAgentSql<ReferrerRow>(
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
      RETURNING customer_id, name, phone, 0 AS match_rank, 0 AS match_index, true AS is_generic_name
    `,
    [generatedCustomerId, REFERRAL_ACCOUNT_NAME, canonicalPhone, REFERRAL_MARKER, notes, APP_ACTOR],
  );

  return {
    customerId: inserted[0].customer_id,
    name: inserted[0].name?.trim() || REFERRAL_ACCOUNT_NAME,
    phone: inserted[0].phone || canonicalPhone,
  };
}

function parseNotes(notes: string | null) {
  if (!notes) return {};

  try {
    const parsed = JSON.parse(notes) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function mapReferral(row: ReferralSelectRow): ReferralRow {
  const notes = parseNotes(row.lead_notes);

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
    remark: typeof notes.remark === "string" ? notes.remark : null,
  };
}

function mapAdminReferral(row: AdminReferralSelectRow): WhatsappAdminReferralRow {
  return {
    ...mapReferral(row),
    referrerCustomerId: row.referrer_customer_id,
    referrerName: row.referrer_name,
    referrerPhone: row.referrer_phone,
  };
}

export async function listWhatsappReferrals(referrerCustomerId: string) {
  const rows = await runWhatsappAgentSql<ReferralSelectRow>(
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

  return rows.map(mapReferral);
}

export async function listAllWhatsappReferrals(limit = 30) {
  const rows = await runWhatsappAgentSql<AdminReferralSelectRow>(
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
        c.notes AS lead_notes,
        referrer.customer_id AS referrer_customer_id,
        referrer.name AS referrer_name,
        referrer.phone AS referrer_phone
      FROM referral r
      LEFT JOIN customer c ON c.customer_id = r.linked_invoice
      LEFT JOIN customer referrer ON referrer.customer_id = r.linked_customer_profile
      LEFT JOIN "user" preferred_agent ON preferred_agent.id::text = r.linked_agent
      ORDER BY r.created_at DESC NULLS LAST, r.id DESC
      LIMIT $1
    `,
    [limit],
  );

  return rows.map(mapAdminReferral);
}

export async function listWhatsappReferralsByReferrerPhone(phone: string, limit = 30) {
  const candidates = buildPhoneMatchCandidates(phone);
  const values = candidates.map((candidate) => candidate.value);
  const ranks = candidates.map((candidate) => candidate.rank);

  const rows = await runWhatsappAgentSql<AdminReferralSelectRow>(
    `
      WITH candidates AS (
        SELECT value, rank, ordinality::int AS match_index
        FROM unnest($1::text[], $2::int[]) WITH ORDINALITY AS c(value, rank, ordinality)
      ),
      matched_referrer AS (
        SELECT c.customer_id, c.name, c.phone
        FROM customer c
        JOIN candidates ON c.phone = candidates.value
        WHERE c.remark IN ($3, $4)
        ORDER BY candidates.rank ASC, candidates.match_index ASC, c.created_at ASC NULLS LAST, c.id ASC
        LIMIT 1
      )
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
        c.notes AS lead_notes,
        matched_referrer.customer_id AS referrer_customer_id,
        matched_referrer.name AS referrer_name,
        matched_referrer.phone AS referrer_phone
      FROM matched_referrer
      JOIN referral r ON r.linked_customer_profile = matched_referrer.customer_id
      LEFT JOIN customer c ON c.customer_id = r.linked_invoice
      LEFT JOIN "user" preferred_agent ON preferred_agent.id::text = r.linked_agent
      ORDER BY r.created_at DESC NULLS LAST, r.id DESC
      LIMIT $5
    `,
    [values, ranks, REFERRAL_MARKER, LEGACY_REFERRER_MARKER, limit],
  );

  return rows.map(mapAdminReferral);
}

export async function createWhatsappReferral(referrer: WhatsappReferrerAccount, draft: WhatsappLeadDraft) {
  const leadCustomerId = `cust_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const referralBubbleId = `reflead_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const metadata = JSON.stringify({
    relationship: draft.relationship,
    projectType: draft.projectType,
    leadState: draft.leadState,
    leadCity: draft.leadCity,
    leadAddress: draft.leadAddress,
    linkedReferrer: referrer.customerId,
    syncedFromReferralPortal: true,
    remark: draft.remark,
    createdAt: new Date().toISOString(),
    createdBy: APP_ACTOR,
  });

  const rows = await runWhatsappAgentSql<{ id: number }>(
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
        NULL
      FROM inserted_customer
      RETURNING id
    `,
    [
      leadCustomerId,
      draft.leadName,
      draft.leadMobileNumber,
      draft.leadState,
      draft.leadCity,
      draft.leadAddress,
      draft.relationship,
      metadata,
      referrer.customerId,
      referralBubbleId,
      referrer.customerId,
      draft.projectType,
    ],
  );

  return rows[0].id;
}

export async function updateWhatsappReferral(
  referrer: WhatsappReferrerAccount,
  update: WhatsappUpdateDraft,
) {
  const fieldMap: Record<WhatsappUpdateField, { referralColumn?: string; customerColumn?: string; noteKey?: string }> = {
    leadName: { referralColumn: "name", customerColumn: "name" },
    leadMobileNumber: { referralColumn: "mobile_number", customerColumn: "phone" },
    leadState: { customerColumn: "state", noteKey: "leadState" },
    leadCity: { customerColumn: "city", noteKey: "leadCity" },
    leadAddress: { customerColumn: "address", noteKey: "leadAddress" },
    relationship: { referralColumn: "relationship", customerColumn: "remark", noteKey: "relationship" },
    projectType: { referralColumn: "project_type", noteKey: "projectType" },
    remark: { noteKey: "remark" },
  };
  const mapping = fieldMap[update.field];

  if (!mapping) {
    throw new Error("Unsupported update field.");
  }

  const rows = await runWhatsappAgentSql<{ id: number; lead_customer_id: string | null; lead_name: string }>(
    `
      SELECT id, linked_invoice AS lead_customer_id, name AS lead_name
      FROM referral
      WHERE id = $1
        AND linked_customer_profile = $2
      LIMIT 1
    `,
    [update.referralId, referrer.customerId],
  );
  const existing = rows[0];

  if (!existing) {
    throw new Error("Lead not found under this WhatsApp referrer account.");
  }

  if (mapping.referralColumn) {
    await runWhatsappAgentSql(
      `
        UPDATE referral
        SET ${mapping.referralColumn} = $1,
            updated_at = NOW()
        WHERE id = $2
          AND linked_customer_profile = $3
      `,
      [update.value || null, update.referralId, referrer.customerId],
    );
  }

  if (existing.lead_customer_id && mapping.customerColumn) {
    await runWhatsappAgentSql(
      `
        UPDATE customer
        SET ${mapping.customerColumn} = $1,
            updated_by = $2,
            updated_at = NOW()
        WHERE customer_id = $3
      `,
      [update.value || null, referrer.customerId, existing.lead_customer_id],
    );
  }

  if (existing.lead_customer_id && mapping.noteKey) {
    await runWhatsappAgentSql(
      `
        UPDATE customer
        SET notes = jsonb_set(
              COALESCE(NULLIF(notes, '')::jsonb, '{}'::jsonb),
              ARRAY[$1],
              to_jsonb($2::text),
              true
            )::text,
            updated_by = $3,
            updated_at = NOW()
        WHERE customer_id = $4
      `,
      [mapping.noteKey, update.value || "", referrer.customerId, existing.lead_customer_id],
    );
  }

  return {
    referralId: update.referralId,
    leadName: update.field === "leadName" ? update.value : existing.lead_name,
  };
}

export async function markInboundProcessed(id: string, reply: string) {
  await runWhatsappAgentSql(
    `
      UPDATE wa_inbound_inbox
      SET process_status = 'processed',
          processed_at = NOW(),
          locked_at = NULL,
          last_error = NULL,
          updated_at = NOW()
      WHERE id = $1::bigint
    `,
    [id],
  );

  return reply;
}

export async function markInboundFailed(id: string, error: string) {
  await runWhatsappAgentSql(
    `
      UPDATE wa_inbound_inbox
      SET process_status = 'failed',
          process_attempts = process_attempts + 1,
          last_error = $2,
          last_error_at = NOW(),
          locked_at = NULL,
          updated_at = NOW()
      WHERE id = $1::bigint
    `,
    [id, error.slice(0, 1000)],
  );
}

export async function insertEtMessage(input: {
  externalMessageId: string;
  direction: "inbound" | "outbound";
  messageType: string;
  textContent: string;
  rawPayload: unknown;
  senderPhone: string | null;
  recipientPhone: string | null;
  channelSessionId: number;
}) {
  const config = getAgentConfig();

  await runWhatsappAgentSql(
    `
      INSERT INTO et_messages (
        tenant_id,
        channel_session_id,
        channel,
        external_message_id,
        direction,
        message_type,
        text_content,
        raw_payload,
        delivery_status,
        sender_phone,
        recipient_phone
      )
      VALUES ($1, $2, 'whatsapp', $3, $4, $5, NULLIF($6, ''), $7::jsonb, $8, $9, $10)
      ON CONFLICT DO NOTHING
    `,
    [
      config.tenantId,
      input.channelSessionId,
      input.externalMessageId,
      input.direction,
      input.messageType,
      input.textContent,
      JSON.stringify(input.rawPayload || {}),
      input.direction === "outbound" ? "sent" : "received",
      input.senderPhone,
      input.recipientPhone,
    ],
  );
}

export async function hasEtMessage(externalMessageId: string, direction?: "inbound" | "outbound") {
  const rows = await runWhatsappAgentSql<{ id: number }>(
    `
      SELECT id
      FROM et_messages
      WHERE external_message_id = $1
        AND ($2::text IS NULL OR direction = $2)
      LIMIT 1
    `,
    [externalMessageId, direction || null],
  );

  return Boolean(rows[0]);
}

export async function sendWhatsappText(toPhone: string, text: string) {
  const config = getAgentConfig();
  const payloads = [
    { sessionId: config.sessionId, to: toPhone, text },
    { sessionId: config.sessionId, jid: `${toPhone}@s.whatsapp.net`, text },
    { sessionId: config.sessionId, recipient: toPhone, message: text },
  ];
  let lastError = "";

  for (const payload of payloads) {
    const response = await fetch(`${config.baileysBaseUrl}/messages/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const responseText = await response.text();

    if (response.ok) {
      return { payload, response: responseText ? JSON.parse(responseText) : null };
    }

    lastError = responseText || response.statusText;
  }

  throw new Error(`Baileys send failed: ${lastError}`);
}

export function isAllowedRelationship(value: string): value is RelationshipOption {
  return RELATIONSHIP_OPTIONS.includes(value as RelationshipOption);
}

export function isAllowedProjectType(value: string): value is ProjectTypeOption {
  return PROJECT_TYPE_OPTIONS.includes(value as ProjectTypeOption);
}

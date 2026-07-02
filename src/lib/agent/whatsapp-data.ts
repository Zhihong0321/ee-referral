import { PROJECT_TYPE_OPTIONS, RELATIONSHIP_OPTIONS, type ProjectTypeOption, type ReferralRow, type RelationshipOption } from "@/lib/referrals";
import { toCanonicalMalaysiaPhone, toPhoneMatchKey } from "@/lib/phone-normalization";
import { query } from "@/lib/db";

const DEFAULT_TENANT_ID = 1;
const REFERRAL_MARKER = "REFERRAL_ACCOUNT";
const LEGACY_REFERRER_MARKER = "REFERRER_ACCOUNT";
const REFERRAL_ACCOUNT_NAME = "Referral";
const APP_ACTOR = "whatsapp_agent";

// Normalizes customer.phone (DB side) to the "national significant number" —
// digits only, country code / leading zero stripped — so lookups match
// regardless of legacy formatting noise (spaces, dashes, +, 60-vs-0 prefix
// inconsistency). Must stay in sync with toPhoneMatchKey()'s JS-side logic.
// Every phone lookup in this file uses this ONE definition of "same phone" —
// previously searchReferrerByPhone/resolveOrCreateReferrerByWhatsappPhone did
// exact-string matching against un-normalized DB values (silently failing on
// any legacy row with stray formatting), while only the fuzzy admin search
// normalized the DB side. That split caused real referrers to become
// unfindable by phone and get duplicate accounts created under them.
const PHONE_MATCH_KEY_SQL = `(CASE
    WHEN regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g') LIKE '60%'
      THEN substring(regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g') FROM 3)
    WHEN regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g') LIKE '0%'
      THEN substring(regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g') FROM 2)
    ELSE regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g')
  END)`;

/**
 * Deterministic memory of the entities the V2 agent last worked on. Written
 * ONLY by application code after successful tool writes (never by the LLM),
 * injected into the system prompt so pronouns ("it", "him", "that lead")
 * keep an authoritative antecedent even after the raw turns age out of the
 * 20-turn history window. Entries older than one hour are ignored.
 */
export type WhatsappEntityLedger = {
  activeLead?: { referralId: number; leadName: string; leadPhone: string };
  lastAgentDiscussed?: { agentName: string };
  lastAction?: string;
  updatedAt: string;
};

export type WhatsappAgentState = {
  mode:
    | "idle"
    | "onboarding_name"
    | "onboarding_bank"
    | "collecting_lead"
    | "selecting_update_lead"
    | "selecting_update_field"
    | "collecting_update_value"
    | "confirming_update"
    | "awaiting_preferred_agent"
    | "admin_idle"
    | "admin_searching_referrer"
    | "admin_creating_referrer_name"
    | "admin_creating_referrer_phone"
    | "admin_selecting_referrer"
    | "admin_adding_lead"
    | "admin_awaiting_preferred_agent";
  draft: Partial<WhatsappLeadDraft>;
  nextField: WhatsappLeadField | null;
  update?: Partial<WhatsappUpdateDraft>;
  onboarding?: { name?: string };
  activeLead?: { referralId: number; leadName: string; leadMobile: string; area: string };
  updatedAt?: string;
  lastLeadList?: Array<{ index: number; referralId: number; leadName: string }>;
  entityLedger?: WhatsappEntityLedger;
  adminContext?: {
    adminPhone: string;
    targetReferrer?: WhatsappReferrerAccount | null;
    targetReferrerSearchResults?: Array<{ customerId: string; name: string | null; phone: string | null }>;
    newReferrerName?: string;
    pendingLead?: WhatsappLeadDraft & { preferredAgentText?: string };
    /**
     * Deterministic, timestamped capture of the last lead-like data (image
     * OCR, contact card, explicit text) seen in THIS admin session. Unlike
     * WhatsappEntityLedger, this is written from raw inbound text (via
     * parseLeadCandidate), not from a successful tool result — admin mode
     * has no equivalent of "THEIR LEADS" to ground a vague "this lead"
     * reference against, so without a short freshness window the model can
     * (and did, in production) reach back into old conversation history and
     * present a day-old image extraction as if it were just sent. Expires
     * after ADMIN_PENDING_LEAD_TTL_MS — short by design, just long enough to
     * cover the immediate clarification back-and-forth after one image.
     */
    pendingLeadCapture?: {
      leadName: string;
      leadMobileNumber: string;
      area: string;
      preferredAgentText: string;
      capturedAt: string;
    };
  };
};

// Minimal lead: only the contact number is strictly required. Name is collected
// for usefulness; area is optional. Relationship/project type are not asked —
// they default to "Other"/"OTHERS" at save time so managers can triage later.
export type WhatsappLeadDraft = {
  leadName: string;
  leadMobileNumber: string;
  area: string;
};

export type WhatsappLeadField = keyof WhatsappLeadDraft;

export type WhatsappUpdateField = "leadName" | "leadMobileNumber" | "area" | "preferredAgent";

export type WhatsappUpdateDraft = {
  referralId: number;
  field: WhatsappUpdateField;
  value: string;
};

export type WhatsappAgentNotificationResult = {
  sent: boolean;
  agentPhone: string;
  reason?: string;
};

export type PreferredAgentNotificationProcessResult = WhatsappAgentNotificationResult & {
  eventId: string;
  referralId: number;
  agentId: string;
  status: "sent" | "failed" | "skipped";
};

export const EMPTY_WHATSAPP_AGENT_STATE: WhatsappAgentState = {
  mode: "idle",
  draft: {},
  nextField: null,
};

export type WhatsappReferrerAccount = {
  customerId: string;
  name: string;
  phone: string;
  bankAccount: string;
  // true once the referrer has a real name AND a payout bank account on file.
  registered: boolean;
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
  notes: string | null;
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
  const baileysBaseUrl = (process.env.WHATSAPP_AGENT_BAILEYS_BASE_URL?.trim() || "").replace(/\/$/, "");
  const sessionId = process.env.WHATSAPP_AGENT_BAILEYS_SESSION_ID?.trim() || "";
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
  const configured = (process.env.WHATSAPP_AGENT_SUPER_ADMIN_PHONES || "")
    .split(",")
    .map((value) => toCanonicalMalaysiaPhone(value.trim()))
    .filter(Boolean);
  const canonical = toCanonicalMalaysiaPhone(phone);

  return configured.includes(canonical);
}

export async function ensureChannelSession() {
  const config = getAgentConfig();
  if (!config.sessionId) {
    throw new Error("WHATSAPP_AGENT_BAILEYS_SESSION_ID is not configured.");
  }
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
    onboarding: state.onboarding || {},
    activeLead: state.activeLead,
    updatedAt: state.updatedAt,
    lastLeadList: state.lastLeadList || [],
    entityLedger: state.entityLedger,
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

export type ConversationTurn = { role: "user" | "assistant"; text: string; time?: string };

const MAX_CONVERSATION_TURNS = 30;

// Conversation memory for the LLM agent. Stored in et_channel_sessions.metadata
// (proven reliable) rather than relying on et_messages reads.
export async function loadConversation(senderPhone: string): Promise<ConversationTurn[]> {
  const session = await ensureChannelSession();
  const metadata = (session.metadata || {}) as Record<string, unknown>;
  const conversations = (metadata.conversations || {}) as Record<string, unknown>;
  const canonicalPhone = toCanonicalMalaysiaPhone(senderPhone);
  const turns = conversations[canonicalPhone];

  if (!Array.isArray(turns)) {
    return [];
  }

  return turns
    .filter((turn): turn is ConversationTurn => Boolean(turn) && typeof (turn as ConversationTurn).text === "string")
    .map((turn) => ({ role: turn.role === "assistant" ? ("assistant" as const) : ("user" as const), text: turn.text.trim(), time: turn.time }))
    .filter((turn) => turn.text);
}

export async function appendConversation(senderPhone: string, newTurns: ConversationTurn[]) {
  if (newTurns.length === 0) return;

  const config = getAgentConfig();
  const canonicalPhone = toCanonicalMalaysiaPhone(senderPhone);
  const existing = await loadConversation(senderPhone);
  const combined = [...existing, ...newTurns].slice(-MAX_CONVERSATION_TURNS);

  await ensureChannelSession();
  await runWhatsappAgentSql(
    `
      UPDATE et_channel_sessions
      SET
        metadata = jsonb_set(
          jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            '{conversations}',
            COALESCE(metadata->'conversations', '{}'::jsonb),
            true
          ),
          ARRAY['conversations', $3],
          $4::jsonb,
          true
        ),
        updated_at = NOW()
      WHERE tenant_id = $1
        AND channel_type = 'whatsapp'
        AND session_identifier = $2
    `,
    [config.tenantId, config.sessionId, canonicalPhone, JSON.stringify(combined)],
  );
}

// ---- Agent debug log (prod observability) ------------------------------------
// A global ring buffer of recent agent turns, stored in
// et_channel_sessions.metadata.agentDebugLog. Lets us inspect the agent's
// reasoning in prod (did the tool fire? did the phantom-guard trip?) via
// GET /api/whatsapp-agent/logs — no new table, reuses the proven metadata store.
export type AgentDebugLogEntry = {
  at: string;
  phone: string;
  registered: boolean;
  inbound: string;
  reply: string;
  toolCalls: Array<{ name: string; input: unknown; status: string; agentNotified?: unknown }>;
  wrote: boolean;
  guardTrips: number;
  fallbackUsed: boolean;
  rounds: number;
  ms: number;
};

const MAX_AGENT_DEBUG_ENTRIES = 80;

export async function appendAgentDebugLog(entry: AgentDebugLogEntry) {
  const config = getAgentConfig();
  const session = await ensureChannelSession();
  const metadata = (session.metadata || {}) as Record<string, unknown>;
  const existing = Array.isArray(metadata.agentDebugLog) ? (metadata.agentDebugLog as AgentDebugLogEntry[]) : [];
  const combined = [...existing, entry].slice(-MAX_AGENT_DEBUG_ENTRIES);

  await runWhatsappAgentSql(
    `
      UPDATE et_channel_sessions
      SET
        metadata = jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          ARRAY['agentDebugLog'],
          $3::jsonb,
          true
        ),
        updated_at = NOW()
      WHERE tenant_id = $1
        AND channel_type = 'whatsapp'
        AND session_identifier = $2
    `,
    [config.tenantId, config.sessionId, JSON.stringify(combined)],
  );
}

export async function loadAgentDebugLog(limit = 30, phone?: string): Promise<AgentDebugLogEntry[]> {
  const session = await ensureChannelSession();
  const metadata = (session.metadata || {}) as Record<string, unknown>;
  const entries = Array.isArray(metadata.agentDebugLog) ? (metadata.agentDebugLog as AgentDebugLogEntry[]) : [];
  const filtered = phone
    ? entries.filter((e) => toCanonicalMalaysiaPhone(e.phone) === toCanonicalMalaysiaPhone(phone))
    : entries;
  return filtered.slice(-Math.max(1, Math.min(limit, MAX_AGENT_DEBUG_ENTRIES))).reverse();
}

export type WhatsappAgentOption = { id: string; name: string };

// Sales agents who can be set as a lead's preferred agent. Mirrors the portal's
// listAgentOptions: rows in "user" with a sales access level (when that column
// exists). The preferred agent is stored on referral.linked_agent.
export async function listWhatsappAgents(): Promise<WhatsappAgentOption[]> {
  const caps = await runWhatsappAgentSql<{ has_user_table: boolean; has_access_level: boolean }>(
    `
      SELECT
        EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'user'
        ) AS has_user_table,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'access_level'
        ) AS has_access_level
    `,
  );

  if (!caps[0]?.has_user_table) {
    return [];
  }

  const salesFilter = caps[0]?.has_access_level
    ? "AND EXISTS (SELECT 1 FROM unnest(u.access_level) AS x WHERE LOWER(x) LIKE '%sales%')"
    : "";

  const rows = await runWhatsappAgentSql<{ id: number; name: string | null }>(
    `
      SELECT u.id, u.name
      FROM "user" u
      WHERE u.name IS NOT NULL
        AND BTRIM(u.name) <> ''
        ${salesFilter}
      ORDER BY u.name ASC
    `,
  );

  return rows.map((row) => ({ id: String(row.id), name: (row.name || "").trim() })).filter((agent) => agent.name);
}

// Look up an agent's WhatsApp contact number (user.contact) and normalize it to
// canonical Malaysia 60-form so Baileys can deliver to it.
export async function getWhatsappAgentContact(agentId: string): Promise<string> {
  const id = (agentId || "").trim();
  if (!id) return "";
  const rows = await runWhatsappAgentSql<{ contact: string | null }>(
    `SELECT contact FROM "user" WHERE id::text = $1 LIMIT 1`,
    [id],
  );
  return toCanonicalMalaysiaPhone(rows[0]?.contact || "");
}

// Workflow: when a lead is assigned a preferred agent, WhatsApp that agent so
// they know to follow up. Best-effort by design — callers wrap in try/catch so a
// delivery failure never blocks the lead save or the referrer's reply.
export async function notifyPreferredAgentOfLead(params: {
  agentId: string;
  agentName: string;
  leadName: string;
  leadMobile: string;
  area: string;
  referrerName: string;
  referrerPhone: string;
}): Promise<WhatsappAgentNotificationResult> {
  const agentPhone = await getWhatsappAgentContact(params.agentId);
  if (agentPhone.length < 8) {
    return { sent: false, agentPhone, reason: "agent has no valid contact number on file" };
  }

  const leadMobile = toCanonicalMalaysiaPhone(params.leadMobile) || params.leadMobile;
  const referrerLabel = params.referrerName && params.referrerName !== REFERRAL_ACCOUNT_NAME ? params.referrerName : "a referrer";
  const text = [
    `Hi ${params.agentName}, you have a new referral lead to handle:`,
    "",
    `Name: ${params.leadName || "(not provided)"}`,
    `Mobile: ${leadMobile || "(not provided)"}`,
    params.area ? `Area: ${params.area}` : "",
    "",
    `Referred by: ${referrerLabel}${params.referrerPhone ? ` (${params.referrerPhone})` : ""}`,
    "",
    "Please follow up with this lead. — Referral Assistant",
  ]
    .filter(Boolean)
    .join("\n");

  await sendWhatsappText(agentPhone, text);
  return { sent: true, agentPhone };
}

async function sendPreferredAgentNotificationForReferral(
  referralId: number,
  agentId: string | null | undefined,
): Promise<WhatsappAgentNotificationResult | null> {
  const preferredAgentId = agentId?.trim();
  if (!preferredAgentId) return null;

  try {
    const rows = await runWhatsappAgentSql<{
      agent_name: string | null;
      lead_name: string | null;
      lead_mobile: string | null;
      lead_state: string | null;
      lead_city: string | null;
      referrer_name: string | null;
      referrer_phone: string | null;
    }>(
      `
        SELECT
          preferred_agent.name AS agent_name,
          r.name AS lead_name,
          COALESCE(NULLIF(r.mobile_number, ''), lead_customer.phone, '') AS lead_mobile,
          COALESCE(lead_customer.state, '') AS lead_state,
          COALESCE(lead_customer.city, '') AS lead_city,
          referrer.name AS referrer_name,
          referrer.phone AS referrer_phone
        FROM referral r
        LEFT JOIN customer lead_customer ON lead_customer.customer_id = r.linked_invoice
        LEFT JOIN customer referrer ON referrer.customer_id = r.linked_customer_profile
        LEFT JOIN "user" preferred_agent ON preferred_agent.id::text = $2
        WHERE r.id = $1
        LIMIT 1
      `,
      [referralId, preferredAgentId],
    );
    const row = rows[0];
    if (!row) {
      return { sent: false, agentPhone: "", reason: "referral was not found after preferred agent was set" };
    }

    return await notifyPreferredAgentOfLead({
      agentId: preferredAgentId,
      agentName: row.agent_name?.trim() || "Agent",
      leadName: row.lead_name || "",
      leadMobile: row.lead_mobile || "",
      area: [row.lead_state, row.lead_city].map((value) => value?.trim()).filter(Boolean).join(", "),
      referrerName: row.referrer_name || "",
      referrerPhone: row.referrer_phone || "",
    });
  } catch (error) {
    return {
      sent: false,
      agentPhone: "",
      reason: error instanceof Error ? error.message : "notification failed",
    };
  }
}

export async function processPendingPreferredAgentNotifications(options: {
  limit?: number;
  referralId?: number;
  preferredAgentId?: string | null;
} = {}): Promise<PreferredAgentNotificationProcessResult[]> {
  const limit = Math.max(1, Math.min(options.limit || 10, 50));
  const preferredAgentId = options.preferredAgentId?.trim() || null;

  // The legacy outbox table is no longer used (assignments send directly). If it
  // does not exist, there is nothing to drain — return empty instead of throwing
  // so the worker/process route keeps running.
  const tableExists = await runWhatsappAgentSql<{ tbl: string | null }>(
    `SELECT to_regclass('referral_preferred_agent_notification') AS tbl`,
  );
  if (!tableExists[0]?.tbl) {
    return [];
  }

  const events = await runWhatsappAgentSql<{
    id: string;
    referral_id: number;
    preferred_agent_id: string;
  }>(
    `
      WITH next_events AS (
        SELECT id
        FROM referral_preferred_agent_notification
        WHERE status IN ('pending', 'failed')
          AND attempts < 5
          AND (claimed_at IS NULL OR claimed_at < NOW() - INTERVAL '5 minutes')
          AND ($2::bigint IS NULL OR referral_id = $2::bigint)
          AND ($3::text IS NULL OR preferred_agent_id = $3)
        ORDER BY created_at ASC, id ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE referral_preferred_agent_notification notification
      SET
        status = 'sending',
        claimed_at = NOW(),
        attempts = attempts + 1,
        updated_at = NOW()
      FROM next_events
      WHERE notification.id = next_events.id
      RETURNING
        notification.id::text,
        notification.referral_id::int,
        notification.preferred_agent_id
    `,
    [limit, options.referralId || null, preferredAgentId],
  );

  const results: PreferredAgentNotificationProcessResult[] = [];

  for (const event of events) {
    const notification = await sendPreferredAgentNotificationForReferral(event.referral_id, event.preferred_agent_id);
    const finalStatus: PreferredAgentNotificationProcessResult["status"] = notification?.sent
      ? "sent"
      : notification?.reason === "agent has no valid contact number on file"
        ? "skipped"
        : "failed";
    const error = notification?.sent ? "" : notification?.reason || "notification failed";

    await runWhatsappAgentSql(
      `
        UPDATE referral_preferred_agent_notification
        SET
          status = $2,
          error = NULLIF($3, ''),
          sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END,
          claimed_at = NULL,
          updated_at = NOW()
        WHERE id = $1::bigint
      `,
      [event.id, finalStatus, error],
    );

    results.push({
      eventId: event.id,
      referralId: event.referral_id,
      agentId: event.preferred_agent_id,
      sent: Boolean(notification?.sent),
      agentPhone: notification?.agentPhone || "",
      reason: notification?.reason,
      status: finalStatus,
    });
  }

  return results;
}

async function dispatchPreferredAgentNotificationForReferral(
  referralId: number,
  agentId: string | null | undefined,
): Promise<WhatsappAgentNotificationResult | null> {
  const preferredAgentId = agentId?.trim();
  if (!preferredAgentId) return null;

  // Send the WhatsApp to the agent directly. Best-effort: any failure is caught
  // and returned as a reason so it never blocks the lead save. (No outbox table
  // or DB trigger is involved — the assignment sends the message immediately.)
  try {
    return await sendPreferredAgentNotificationForReferral(referralId, preferredAgentId);
  } catch (error) {
    return {
      sent: false,
      agentPhone: "",
      reason: error instanceof Error ? error.message : "notification dispatch failed",
    };
  }
}

export async function resolveOrCreateReferrerByWhatsappPhone(senderPhone: string): Promise<WhatsappReferrerAccount> {
  const matchKey = toPhoneMatchKey(senderPhone);

  const rows = matchKey
    ? await runWhatsappAgentSql<ReferrerRow>(
        `
          SELECT
            c.customer_id,
            c.name,
            c.phone,
            c.notes,
            lower(COALESCE(NULLIF(c.name, ''), $4)) = lower($4) AS is_generic_name
          FROM customer c
          WHERE c.remark IN ($1, $2)
            AND ${PHONE_MATCH_KEY_SQL} = $3
          ORDER BY
            is_generic_name ASC,
            c.created_at ASC NULLS LAST,
            c.id ASC
          LIMIT 1
        `,
        [REFERRAL_MARKER, LEGACY_REFERRER_MARKER, matchKey, REFERRAL_ACCOUNT_NAME],
      )
    : [];

  if (rows[0]) {
    return buildReferrerAccount(rows[0], senderPhone);
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
      RETURNING customer_id, name, phone, notes, 0 AS match_rank, 0 AS match_index, true AS is_generic_name
    `,
    [generatedCustomerId, REFERRAL_ACCOUNT_NAME, canonicalPhone, REFERRAL_MARKER, notes, APP_ACTOR],
  );

  return buildReferrerAccount(inserted[0], canonicalPhone);
}

function buildReferrerAccount(row: ReferrerRow, fallbackPhone: string): WhatsappReferrerAccount {
  const notes = parseNotes(row.notes);
  const bankAccount = typeof notes.bankAccount === "string" ? notes.bankAccount.trim() : "";
  const trimmedName = row.name?.trim() || "";
  const hasRealName = Boolean(trimmedName) && !row.is_generic_name;

  return {
    customerId: row.customer_id,
    name: trimmedName || REFERRAL_ACCOUNT_NAME,
    phone: row.phone?.trim() || fallbackPhone,
    bankAccount,
    registered: hasRealName && Boolean(bankAccount),
  };
}

// Persist a referrer's name + payout bank account (collected during WhatsApp
// onboarding). Matches how the dashboard portal stores the profile: name in
// customer.name, bank details merged into customer.notes JSON.
export async function saveReferrerProfile(
  referrer: WhatsappReferrerAccount,
  input: { name: string; bankAccount: string; bankerName?: string },
) {
  const existingRows = await runWhatsappAgentSql<{ notes: string | null }>(
    `SELECT notes FROM customer WHERE customer_id = $1 LIMIT 1`,
    [referrer.customerId],
  );
  const mergedNotes = {
    ...parseNotes(existingRows[0]?.notes ?? null),
    kind: "referral_account",
    bankAccount: input.bankAccount,
    bankerName: input.bankerName?.trim() || input.name,
    updatedAt: new Date().toISOString(),
  };

  await runWhatsappAgentSql(
    `
      UPDATE customer
      SET name = $1,
          notes = $2,
          remark = $3,
          updated_by = $4,
          updated_at = NOW()
      WHERE customer_id = $5
    `,
    [input.name, JSON.stringify(mergedNotes), REFERRAL_MARKER, APP_ACTOR, referrer.customerId],
  );

  return {
    ...referrer,
    name: input.name,
    bankAccount: input.bankAccount,
    registered: true,
  };
}

export async function searchReferrerByPhone(phone: string): Promise<WhatsappReferrerAccount | null> {
  const matchKey = toPhoneMatchKey(phone);
  if (!matchKey) return null;

  const rows = await runWhatsappAgentSql<ReferrerRow>(
    `
      SELECT
        c.customer_id,
        c.name,
        c.phone,
        c.notes,
        lower(COALESCE(NULLIF(c.name, ''), $4)) = lower($4) AS is_generic_name
      FROM customer c
      WHERE c.remark IN ($1, $2)
        AND ${PHONE_MATCH_KEY_SQL} = $3
      ORDER BY
        is_generic_name ASC,
        c.created_at ASC NULLS LAST,
        c.id ASC
      LIMIT 1
    `,
    [REFERRAL_MARKER, LEGACY_REFERRER_MARKER, matchKey, REFERRAL_ACCOUNT_NAME],
  );

  if (!rows[0]) return null;
  return buildReferrerAccount(rows[0], phone);
}

export async function searchReferrersByPhonePartial(
  query: string,
  limit = 5,
): Promise<Array<{ customerId: string; name: string | null; phone: string | null }>> {
  const trimmed = (query || "").trim();
  if (!trimmed) return [];

  // Phone fragment: strip a Malaysia prefix so a partial number matches.
  const digits = toPhoneMatchKey(trimmed);
  const phonePattern = digits ? `%${digits}%` : null;

  // Name fragment: anything with a letter is treated as a fuzzy name search.
  const namePattern = /[a-z]/i.test(trimmed) ? `%${trimmed}%` : null;

  // Match by phone OR name. Exclude the generic placeholder account name so a
  // name search does not return every unnamed "Referral" record.
  const rows = await runWhatsappAgentSql<{ customer_id: string; name: string | null; phone: string | null }>(
    `
      SELECT
        c.customer_id,
        c.name,
        c.phone
      FROM customer c
      WHERE c.remark IN ($1, $2)
        AND (
          ($3::text IS NOT NULL AND regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g') LIKE $3)
          OR ($4::text IS NOT NULL AND c.name ILIKE $4 AND lower(COALESCE(c.name, '')) <> lower($5))
        )
      ORDER BY c.created_at DESC NULLS LAST, c.id DESC
      LIMIT $6
    `,
    [REFERRAL_MARKER, LEGACY_REFERRER_MARKER, phonePattern, namePattern, REFERRAL_ACCOUNT_NAME, limit],
  );

  return rows.map((row) => ({ customerId: row.customer_id, name: row.name, phone: row.phone }));
}

export async function createReferrerOnBehalf(input: {
  name: string;
  phone: string;
  createdBy: string;
}): Promise<WhatsappReferrerAccount> {
  const canonicalPhone = toCanonicalMalaysiaPhone(input.phone);
  const generatedCustomerId = `ref_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const notes = JSON.stringify({
    kind: "referral_account",
    source: "whatsapp_admin",
    createdBy: input.createdBy,
    originalWhatsappPhone: input.phone,
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
      RETURNING customer_id, name, phone, notes, 0 AS match_rank, 0 AS match_index, false AS is_generic_name
    `,
    [generatedCustomerId, input.name.trim(), canonicalPhone, REFERRAL_MARKER, notes, APP_ACTOR],
  );

  return buildReferrerAccount(inserted[0], canonicalPhone);
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
  const matchKey = toPhoneMatchKey(phone);
  if (!matchKey) return [];

  const rows = await runWhatsappAgentSql<AdminReferralSelectRow>(
    `
      WITH matched_referrer AS (
        SELECT c.customer_id, c.name, c.phone
        FROM customer c
        WHERE c.remark IN ($1, $2)
          AND ${PHONE_MATCH_KEY_SQL} = $3
        ORDER BY c.created_at ASC NULLS LAST, c.id ASC
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
      LIMIT $4
    `,
    [REFERRAL_MARKER, LEGACY_REFERRER_MARKER, matchKey, limit],
  );

  return rows.map(mapAdminReferral);
}

export async function createWhatsappReferral(
  referrer: WhatsappReferrerAccount,
  draft: WhatsappLeadDraft,
  options: { preferredAgentId?: string | null } = {},
) {
  const leadCustomerId = `cust_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const referralBubbleId = `reflead_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const preferredAgentId = options.preferredAgentId?.trim() || null;
  // Relationship/project type are not collected over WhatsApp; default them to
  // neutral values so the row stays valid and managers can triage later.
  const defaultRelationship = "Other";
  const defaultProjectType = "OTHERS";
  const area = draft.area?.trim() || "";
  const metadata = JSON.stringify({
    relationship: defaultRelationship,
    projectType: defaultProjectType,
    leadState: area,
    leadCity: "",
    leadAddress: "",
    area,
    linkedReferrer: referrer.customerId,
    syncedFromReferralPortal: true,
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
        $13
      FROM inserted_customer
      RETURNING id
    `,
    [
      leadCustomerId,
      draft.leadName,
      draft.leadMobileNumber,
      area,
      "",
      "",
      defaultRelationship,
      metadata,
      referrer.customerId,
      referralBubbleId,
      referrer.customerId,
      defaultProjectType,
      preferredAgentId,
    ],
  );

  const referralId = rows[0].id;
  const preferredAgentNotification = await dispatchPreferredAgentNotificationForReferral(referralId, preferredAgentId);

  return { referralId, preferredAgentNotification };
}

export async function updateWhatsappReferral(
  referrer: WhatsappReferrerAccount,
  update: WhatsappUpdateDraft,
) {
  const fieldMap: Record<WhatsappUpdateField, { referralColumn?: string; customerColumn?: string; noteKey?: string }> = {
    leadName: { referralColumn: "name", customerColumn: "name" },
    leadMobileNumber: { referralColumn: "mobile_number", customerColumn: "phone" },
    area: { customerColumn: "state", noteKey: "leadState" },
    preferredAgent: { referralColumn: "linked_agent" },
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

  const preferredAgentNotification =
    update.field === "preferredAgent"
      ? await dispatchPreferredAgentNotificationForReferral(update.referralId, update.value)
      : null;

  return {
    referralId: update.referralId,
    leadName: update.field === "leadName" ? update.value : existing.lead_name,
    preferredAgentNotification,
  };
}

export async function insertEtMessage(input: {
  externalMessageId: string;
  direction: "inbound" | "outbound";
  messageType: string;
  textContent: string;
  mediaUrl?: string | null;
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
        media_url,
        raw_payload,
        delivery_status,
        sender_phone,
        recipient_phone
      )
      VALUES ($1, $2, 'whatsapp', $3, $4, $5, NULLIF($6, ''), NULLIF($7, ''), $8::jsonb, $9, $10, $11)
      ON CONFLICT DO NOTHING
    `,
    [
      config.tenantId,
      input.channelSessionId,
      input.externalMessageId,
      input.direction,
      input.messageType,
      input.textContent,
      input.mediaUrl || "",
      JSON.stringify(input.rawPayload || {}),
      input.direction === "outbound" ? "sent" : "received",
      input.senderPhone,
      input.recipientPhone,
    ],
  );
}

export type PendingWhatsappInboundMessage = {
  id: string;
  externalMessageId: string;
  messageType: string;
  textContent: string;
  mediaUrl: string;
  senderPhone: string;
  recipientPhone: string;
  rawPayload: Record<string, unknown>;
  createdAt: string;
};

export async function listUnrepliedWhatsappInboundMessages(limit = 10, lookbackMinutes = 60) {
  const rows = await runWhatsappAgentSql<{
    id: string;
    external_message_id: string | null;
    message_type: string | null;
    text_content: string | null;
    media_url: string | null;
    sender_phone: string | null;
    recipient_phone: string | null;
    raw_payload: Record<string, unknown> | null;
    created_at: string | null;
  }>(
    `
      SELECT
        inbound.id::text,
        inbound.external_message_id,
        inbound.message_type,
        inbound.text_content,
        inbound.media_url,
        inbound.sender_phone,
        inbound.recipient_phone,
        COALESCE(inbound.raw_payload, '{}'::jsonb) AS raw_payload,
        inbound.created_at::text AS created_at
      FROM et_messages inbound
      WHERE inbound.channel = 'whatsapp'
        AND inbound.direction = 'inbound'
        AND inbound.sender_phone IS NOT NULL
        AND BTRIM(inbound.sender_phone) <> ''
        AND (inbound.recipient_phone IS NULL OR inbound.sender_phone <> inbound.recipient_phone)
        AND inbound.external_message_id IS NOT NULL
        AND BTRIM(inbound.external_message_id) <> ''
        AND inbound.message_type IN ('text', 'conversation', 'extendedTextMessage', 'audio', 'ptt', 'image', 'video', 'document', 'sticker', 'contact', 'contacts', 'contactMessage', 'contactsArrayMessage')
        AND inbound.created_at >= NOW() - ($2::int * INTERVAL '1 minute')
        -- Give an image/video row a brief grace period if its media_url isn't
        -- populated yet (the ingestion service may still be uploading the
        -- attachment) so the next poll can pick it up once it's ready,
        -- instead of processing it with no media reference. After 20s a
        -- still-missing media_url is treated as genuinely stuck and
        -- processed anyway — prepareWhatsappInboundForAgent then replies
        -- with an explicit "please resend" instead of leaving the admin
        -- with no clear signal at all.
        AND (
          inbound.message_type NOT IN ('image', 'video')
          OR inbound.media_url IS NOT NULL
          OR inbound.created_at < NOW() - INTERVAL '20 seconds'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM et_messages outbound
          WHERE outbound.channel = 'whatsapp'
            AND outbound.direction = 'outbound'
            AND outbound.external_message_id = 'agent_reply_' || inbound.external_message_id
        )
      ORDER BY inbound.created_at ASC NULLS LAST, inbound.id ASC
      LIMIT $1
    `,
    [Math.max(1, Math.min(limit, 50)), Math.max(1, lookbackMinutes)],
  );

  return rows.map((row) => ({
    id: row.id,
    externalMessageId: row.external_message_id || row.id,
    messageType: row.message_type || "text",
    textContent: row.text_content || "",
    mediaUrl: row.media_url || "",
    senderPhone: row.sender_phone || "",
    recipientPhone: row.recipient_phone || "",
    rawPayload: row.raw_payload || {},
    createdAt: row.created_at || "",
  }));
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
  if (!config.baileysBaseUrl) {
    throw new Error("WHATSAPP_AGENT_BAILEYS_BASE_URL is not configured.");
  }
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

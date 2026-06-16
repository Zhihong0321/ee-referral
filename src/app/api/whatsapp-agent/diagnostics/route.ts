import { NextResponse } from "next/server";

import { getWhatsappAgentRuntimeConfig, runWhatsappAgentSql } from "@/lib/agent/whatsapp-data";
import { ensureWhatsappAgentWorker } from "@/lib/agent/worker-start";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
};

type InboundInboxDiagnosticRow = {
  id: string;
  sender_phone: string | null;
  message_type: string | null;
  process_status: string | null;
  created_at: string | null;
  last_error: string | null;
};

async function check(name: string, fn: () => Promise<unknown>): Promise<[string, CheckResult]> {
  try {
    return [name, { ok: true, data: await fn() }];
  } catch (error) {
    return [name, { ok: false, error: error instanceof Error ? error.message : String(error) }];
  }
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const text = await response.text();

  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text.slice(0, 1000);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${typeof payload === "string" ? payload : JSON.stringify(payload)}`);
  }

  return payload;
}

export async function GET() {
  const worker = ensureWhatsappAgentWorker();
  const config = getWhatsappAgentRuntimeConfig();
  const baileysBaseUrl = config.baileysBaseUrl.replace(/\/$/, "");
  const sessionId = config.sessionId;

  const entries = await Promise.all([
    check("env", async () => ({
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
      hasProxyUrl: Boolean(process.env.WHATSAPP_AGENT_PROXY_URL || process.env.SANDBOX_PROXY_URL),
      hasProxyAuth: Boolean(process.env.WHATSAPP_AGENT_PROXY_AUTH || process.env.SANDBOX_PROXY_AUTH),
      hasMiniMaxApiKey: Boolean(process.env.MINIMAX_API_KEY || process.env.MINIMAX_API_SECRET),
      baileysBaseUrl,
      sessionId,
      tenantId: config.tenantId,
      workerPollEnabled: process.env.WHATSAPP_AGENT_BAILEYS_POLL !== "false",
      embeddedWorker: worker,
      watchedPhones: (process.env.WHATSAPP_AGENT_WATCH_PHONES || process.env.WHATSAPP_AGENT_SUPER_ADMIN_PHONES || "601121000099")
        .split(",")
        .map((value) => value.replace(/\D/g, ""))
        .filter(Boolean),
    })),
    check("baileysSessions", async () => fetchJson(`${baileysBaseUrl}/sessions`)),
    check("baileysChats", async () => {
      const payload = await fetchJson(`${baileysBaseUrl}/chats?sessionId=${encodeURIComponent(sessionId)}`);
      const chats = (payload as { chats?: unknown[] }).chats || [];
      return { count: chats.length, latest: chats.slice(0, 10) };
    }),
    check("dbTables", async () =>
      runWhatsappAgentSql(
        `
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN ('wa_inbound_inbox', 'et_messages', 'et_channel_sessions', 'customer', 'referral')
          ORDER BY table_name
        `,
      ),
    ),
    check("dbInboundInbox", async () => {
      const rows = await runWhatsappAgentSql<InboundInboxDiagnosticRow>(
        `
          SELECT id::text, session_identifier, sender_phone, message_type, process_status, process_attempts, created_at::text, last_error
          FROM wa_inbound_inbox
          WHERE session_identifier = $1
          ORDER BY id DESC
          LIMIT 10
        `,
        [sessionId],
      );
      const failedUserTextRows = rows.filter(
        (row) =>
          row.message_type === "text" &&
          row.process_status === "failed" &&
          row.sender_phone !== "60182920127",
      );

      if (failedUserTextRows.length > 0) {
        throw new Error(
          `Recent user text inbound rows failed: ${failedUserTextRows
            .map((row) => `#${row.id} ${row.last_error || "unknown error"}`)
            .join("; ")}`,
        );
      }

      return rows;
    }),
    check("dbRecentMessages", async () =>
      runWhatsappAgentSql(
        `
          SELECT id::text, external_message_id, direction, sender_phone, recipient_phone, left(COALESCE(text_content, ''), 240) AS text_content, created_at::text
          FROM et_messages
          WHERE channel = 'whatsapp'
          ORDER BY id DESC
          LIMIT 20
        `,
      ),
    ),
  ]);

  const checks = Object.fromEntries(entries);
  const ok = entries.every(([, result]) => result.ok);

  return NextResponse.json({
    ok,
    checkedAt: new Date().toISOString(),
    checks,
  });
}

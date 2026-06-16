import { NextResponse } from "next/server";

import { getWhatsappAgentRuntimeConfig, runWhatsappAgentSql } from "@/lib/agent/whatsapp-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
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
  const config = getWhatsappAgentRuntimeConfig();
  const baileysBaseUrl = config.baileysBaseUrl.replace(/\/$/, "");
  const sessionId = config.sessionId;

  const entries = await Promise.all([
    check("env", async () => ({
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
      hasProxyUrl: Boolean(process.env.WHATSAPP_AGENT_PROXY_URL || process.env.SANDBOX_PROXY_URL),
      hasProxyAuth: Boolean(process.env.WHATSAPP_AGENT_PROXY_AUTH || process.env.SANDBOX_PROXY_AUTH),
      hasWebhookVerifyToken: Boolean(process.env.WHATSAPP_AGENT_WEBHOOK_VERIFY_TOKEN),
      hasLlmApiKey: Boolean(process.env.WHATSAPP_AGENT_LLM_API_KEY || process.env.MINIMAX_API_KEY),
      llmModel: process.env.WHATSAPP_AGENT_LLM_MODEL || "MiniMax-M2",
      baileysBaseUrl,
      sessionId,
      tenantId: config.tenantId,
      superAdminPhones: (process.env.WHATSAPP_AGENT_SUPER_ADMIN_PHONES || "601121000099")
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
            AND table_name IN ('et_messages', 'et_channel_sessions', 'customer', 'referral')
          ORDER BY table_name
        `,
      ),
    ),
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

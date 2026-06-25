import { NextResponse } from "next/server";

import { loadAgentDebugLog } from "@/lib/agent/whatsapp-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Prod "EYE": recent agent reasoning traces. Mirrors the diagnostics route's open
// posture so it's one curl to inspect.
//   GET /api/whatsapp-agent/logs            -> last 30 turns
//   GET /api/whatsapp-agent/logs?limit=10   -> last 10 turns
//   GET /api/whatsapp-agent/logs?phone=60127119693  -> turns for one referrer
export async function GET(request: Request) {
  const url = new URL(request.url);
  const phone = url.searchParams.get("phone") || undefined;
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 30, 80));

  try {
    const turns = await loadAgentDebugLog(limit, phone);
    return NextResponse.json({ ok: true, count: turns.length, turns });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

# AGENT.md — WhatsApp Referral Assistant

The WhatsApp agent is a MiniMax-M3 tool-calling agent (NOT a state machine).
Prompt + tools + loop live in [`src/lib/agent/whatsapp-flow.ts`](src/lib/agent/whatsapp-flow.ts);
the DB layer is [`src/lib/agent/whatsapp-data.ts`](src/lib/agent/whatsapp-data.ts).
Deployed on Railway at **https://referral.atap.solar**. See [CLAUDE.md](CLAUDE.md)
for the fuller project guide.

## Debug tools built into prod

### 1. Prod "EYE" — `GET /api/whatsapp-agent/logs`
Last ~80 agent turns (ring buffer in `et_channel_sessions.metadata.agentDebugLog`),
open endpoint. Each turn records `inbound`, `reply`,
`toolCalls[{name,input,status}]`, `wrote`, `guardTrips`, `fallbackUsed`,
`rounds`, `ms`, `registered`. Filters: `?phone=`, `?limit=` (max 80).
**This is the first stop when a lead "doesn't save"** — it shows whether the
write tool fired (`wrote`) and whether the anti-phantom guard tripped
(`guardTrips`/`fallbackUsed`).
```bash
curl "https://referral.atap.solar/api/whatsapp-agent/logs?phone=60127119693&limit=20"
```

### 2. `GET /api/whatsapp-agent/diagnostics`
Env flags, Baileys session/chats, recent `et_messages` + `wa_inbound_inbox`.
Pipeline/health check. (Its message check filters `channel='whatsapp'` — can look
emptier than reality; cross-check `wa_inbound_inbox`.)

### 3. Offline lab — `scripts/agent-sim.mjs`
Real instruction + real tools + MiniMax-M3 + mock in-memory DB. Iterate on
reasoning offline, validate, then transplant the prompt/tools into
`whatsapp-flow.ts`. Pass the MiniMax key from the Hermes vault (id "minimax")
via env — the shell's `MINIMAX_API_KEY` is an invalid key:
```bash
MINIMAX_API_KEY=sk-... node scripts/agent-sim.mjs [S1 S2 ...]   # or --chat
```
Scenarios S1–S13 cover update-by-phone, dedup, namecard add, onboarding,
preferred-agent, and the phantom-save flow.

### Inject a live test (real pipeline)
`POST https://ee-baileys-2.up.railway.app/simulate/inbound`
`{"sessionId":"0182920127","senderPhone":"...","text":"...","messageType":"text"}`.
⚠️ Sends a real WhatsApp reply; use read-only text ("how many leads") to avoid DB
writes. Write tools execute even under `dryRun:true`.

## Anti-phantom guard
MiniMax sometimes claims "Done! Added X" without calling the tool (leads vanish).
The loop detects a save-claim with no write → nudges (≤2×) → honest fallback,
never a false "Done." Verify in prod via the EYE log's `guardTrips`/`fallbackUsed`.

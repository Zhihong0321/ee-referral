# EE Referral — Agent Guide

Next.js app (deployed on Railway at **https://referral.atap.solar**) with a
WhatsApp Referral Assistant: a MiniMax-M3 tool-calling agent (NOT a state
machine) that onboards referrers and manages referral leads over WhatsApp.

Core agent code: [`src/lib/agent/whatsapp-flow.ts`](src/lib/agent/whatsapp-flow.ts)
(prompt + tools + loop) and [`src/lib/agent/whatsapp-data.ts`](src/lib/agent/whatsapp-data.ts)
(DB layer). Inbound flows: WhatsApp → Baileys service → webhook/worker →
`runWhatsappAgentTurn`.

---

## Debug tools built into prod

When something misbehaves, use these instead of guessing. All three were added
to observe and reproduce the agent's reasoning.

### 1. Prod "EYE" — agent reasoning log
`GET https://referral.atap.solar/api/whatsapp-agent/logs` (open, no auth)

Returns the last ~80 agent turns (ring buffer in
`et_channel_sessions.metadata.agentDebugLog`). One curl shows exactly what the
agent did.

- Filters: `?phone=60127119693` (canonical or local form), `?limit=20`.
- Each turn: `at`, `phone`, `registered`, `inbound`, `reply`,
  `toolCalls[{name,input,status}]`, `wrote`, `guardTrips`, `fallbackUsed`,
  `rounds`, `ms`.
- **When a lead "doesn't save":** check `toolCalls` + `wrote` (did the write tool
  fire and return `status:"saved"`?) and `guardTrips`/`fallbackUsed` (did the
  anti-phantom guard trip?).

```bash
curl "https://referral.atap.solar/api/whatsapp-agent/logs?phone=60127119693&limit=20"
```

### 2. Diagnostics — pipeline/health
`GET https://referral.atap.solar/api/whatsapp-agent/diagnostics`

Env flags, Baileys session + chats, recent `et_messages` and `wa_inbound_inbox`
rows. Use to confirm ingestion is alive and which keys/models are configured.
Note: its `dbRecentMessages` check filters `channel='whatsapp'`, which can make
the table look emptier than it is — cross-check `wa_inbound_inbox`.

### 3. Offline reasoning lab — `scripts/agent-sim.mjs`
Runs the **real** instruction + **real** tools + MiniMax-M3 against a **mock
in-memory DB** — no prod pipeline, fast iteration. This is the lab: tweak the
prompt/tools here, validate, then transplant into `whatsapp-flow.ts`.

```bash
# vault id "minimax" holds the working key; the shell env MINIMAX_API_KEY is invalid — pass it explicitly
MINIMAX_API_KEY=sk-... node scripts/agent-sim.mjs            # all scenarios
MINIMAX_API_KEY=sk-... node scripts/agent-sim.mjs S8 S12     # specific
MINIMAX_API_KEY=sk-... node scripts/agent-sim.mjs --chat     # interactive REPL
```
Built-in scenarios (S1–S13) cover update-by-phone, dedup, namecard add,
onboarding, preferred-agent, and the phantom-save flow. Add your own real
failing transcript as a scenario to reproduce a bug deterministically.

### Inject a live test message (real pipeline)
`POST https://ee-baileys-2.up.railway.app/simulate/inbound`
with `{"sessionId":"0182920127","senderPhone":"60127119693","text":"...","messageType":"text"}`.

⚠️ **Sends a real WhatsApp reply.** Use read-only text (e.g. "how many leads do
i have") to avoid DB writes. The agent's write tools execute even when the
processor runs with `dryRun:true` — dryRun only skips the send + `et_messages`
logging, not tool execution.

---

## Reliability: the anti-phantom guard
MiniMax sometimes narrates "Done! Added X" **without** calling the tool, so leads
silently vanish. `runWhatsappAgentTurn` guards against this: a save-claim with no
write this turn → nudge the model to actually call the tool (≤2×) → if it still
won't, send an honest fallback (never a false "Done"). Every turn's `guardTrips`
and `fallbackUsed` are recorded in the prod EYE log, so you can confirm it's
working in production.

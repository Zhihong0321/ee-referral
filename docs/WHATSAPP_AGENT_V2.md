# WhatsApp Agent V2 — LLM-first flow

V2 makes the language model the brain: it always processes the inbound message
and performs all reads/writes through validated tools, instead of the V1
deterministic-workflow-then-LLM-fallback design. V1 remains the default; V2 is
opt-in per number until proven in production.

## Pipeline (unchanged upstream)

```
Baileys webhook
  -> processWhatsappAgentMessages()        (whatsapp-processor.ts)
     -> prepareWhatsappInboundForAgent()   media -> text (image OCR, voice ASR, contact card)
     -> shouldUseV2(senderPhone) ? runWhatsappAgentTurnV2() : runWhatsappAgentTurn()
     -> sendWhatsappText()                  reply out
```

Media conversion happens BEFORE the agent turn, so V2 receives already-OCR'd /
transcribed plain text — identical to V1.

## Routing flag

`shouldUseV2()` in `whatsapp-processor.ts`. Default OFF (production unchanged):

- `WHATSAPP_AGENT_V2_ENABLED=true` — V2 for everyone.
- `WHATSAPP_AGENT_V2_PHONES=60xxxx,60yyyy` — V2 only for these numbers (canonical
  Malaysia format). Use this for a controlled live test of one number while all
  others stay on V1.

## Tools (match the real data layer exactly)

The data layer stores only lead **name, mobile number, area** (area = state).
There is **no** lead email, no separate city, and no delete/cancel-lead
operation. Tools reflect that.

Regular user: `get_my_profile`, `get_my_leads`, `search_agents`,
`save_my_profile`, `create_lead`, `update_lead`.

Admin (only for `WHATSAPP_AGENT_SUPER_ADMIN_PHONES`): `admin_search_referrer`,
`admin_create_referrer`, `admin_add_lead`.

Every tool validates inputs and returns `{success, data|error, hint?}`.

## Guardrails (why V2 is safe)

These were added after live testing surfaced three real failures. They are
enforced in code, not just the prompt:

1. **No phantom writes.** `guardWriteClaims()` replaces any reply that claims an
   action (done/saved/assigned/notified...) when no successful write tool ran
   that turn.
2. **No hallucinated lead numbers.** `update_lead` refuses unless `get_my_leads`
   ran in the same turn, and the targeted position's lead id must match what was
   listed.
3. **No create-vs-update overwrite.** `create_lead` rejects a phone that already
   belongs to an existing lead (surfaces it instead of overwriting a different
   lead). New details from text/image/contact = create, never update.
4. **Real admin gating.** Admin tools are offered only to configured super-admin
   phones; non-admins never receive them.

## Testing

- `scripts/e2e-v2.mjs` — human-readable end-to-end walk-through (text, contact,
  image OCR, admin), prints replies and tool traces.
- `scripts/e2e-v2-assert.mjs` — assertion harness: declares expected prod DB
  state per scenario and fails red on mismatch. Catches the three bugs above
  mechanically. Runs against a dedicated test phone; prints a manual cleanup SQL
  for any rows it creates (prod deletes require explicit approval).

Run the dev server with the correct `MINIMAX_API_KEY` exported into its
environment (a stale OS-level `MINIMAX_API_KEY` will otherwise override
`.env.local` and cause 401s), then:

```
node scripts/e2e-v2-assert.mjs 601199000001
```

## Known gaps before a full production cutover

- `referral_preferred_agent_notification` table is not yet applied in prod, so
  preferred-agent notifications do not fire regardless of V1/V2.
- V2 is text-only at the model layer (it consumes OCR text, not raw pixels),
  same as V1.

# EE Referral — Engineering Guide

The WhatsApp Referral Assistant is intentionally not an autonomous transaction
agent. Database writes are deterministic and validated in application code; the
language model is a read-only conversational layer.

## Execution path

```text
WhatsApp inbound
→ media/contact/voice conversion
→ deterministic intent and workflow
→ validated database write and optional agent notification
→ read-only language model only when no workflow action applies
→ WhatsApp reply
```

Workflow state is stored per referrer and expires after one hour. Agent-selection
state includes the exact referral ID. Conversation text is not used as transaction
state.

## Production configuration

Required:

- `DATABASE_URL` or the configured SQL proxy variables
- `MINIMAX_API_KEY` or `WHATSAPP_AGENT_LLM_API_KEY`
- `WHATSAPP_AGENT_VISION_API_KEY`
- `WHATSAPP_AGENT_PROCESS_SECRET`
- `WHATSAPP_AGENT_DEBUG_SECRET`
- Baileys URL/session settings

No API key may be committed as a source-code fallback.

## Safe diagnostics

The logs and diagnostics routes require:

```text
Authorization: Bearer <WHATSAPP_AGENT_DEBUG_SECRET>
```

`WHATSAPP_AGENT_PROCESS_SECRET` is also accepted. Never expose these routes
without authentication because they contain customer and operational data.

`dryRun:true` prepares and reports normalized inbound content only. It does not
run the workflow, mutate state, write leads, or send WhatsApp messages.

## Verification

```bash
npm test
npm run lint
npm run build
```

The regression tests cover image OCR structure, contact cards, explicit text
leads, duplicate-safe intent detection, agent assignment language, cancellation,
skip handling, and numbered updates.

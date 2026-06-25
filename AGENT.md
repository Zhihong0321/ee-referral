# AGENT.md — WhatsApp Referral Assistant

The assistant uses a hybrid architecture:

1. WhatsApp media is converted into structured text.
2. Deterministic application workflow handles every database-changing action:
   onboarding, lead creation, duplicate detection, preferred-agent assignment,
   cancellation, and explicit numbered updates.
3. The language model is read-only. It handles program questions, lead-list
   questions, and conversational clarification, but cannot perform or claim writes.

Core files:

- `src/lib/agent/whatsapp-intent.ts` — pure parsing and matching
- `src/lib/agent/whatsapp-workflow.ts` — deterministic workflow and writes
- `src/lib/agent/whatsapp-flow.ts` — orchestration and read-only model response
- `src/lib/agent/whatsapp-data.ts` — persistence and WhatsApp delivery
- `src/lib/agent/whatsapp-processor.ts` — media conversion and message processing

## Reliability invariants

- A recognized lead phone from an image/contact card is saved without asking the
  language model to decide.
- Preferred-agent follow-up state stores the exact referral ID; it never guesses
  from chat history.
- A fresh lead overrides stale follow-up state.
- Duplicate phones are compared in canonical Malaysian format.
- The language model receives no write tools.
- `dryRun:true` performs no workflow, state, database, or WhatsApp writes.
- Conversation memory is short and excludes media/system/action artifacts before
  being sent to the model.

## Diagnostics

`GET /api/whatsapp-agent/logs` and
`GET /api/whatsapp-agent/diagnostics` require a bearer token or API-key header
matching `WHATSAPP_AGENT_DEBUG_SECRET` or `WHATSAPP_AGENT_PROCESS_SECRET` in
production.

Run local regression checks with:

```bash
npm test
npm run lint
npm run build
```

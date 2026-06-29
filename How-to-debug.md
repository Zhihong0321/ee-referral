# Debugging Guide for EE Referral (WhatsApp Agent)

This guide covers how to debug and troubleshoot the WhatsApp agent flow in production without requiring extensive manual digging through logs.

## 1. Deep Dive into User Sessions

When a specific user or admin experiences a bug, you can instantly pull their entire state history, tool traces, and raw messages using the dedicated CLI debug script.

**Command:**
```bash
node scratch/prod-whatsapp-debug.cjs <phone_number>
```
*Note: You can pass the phone number with or without the `60` prefix (e.g., `60123456789` or `0123456789`).*

**What this dumps:**
1. **Current State Tree:** The exact `metadata->agentStates` JSON for that user (e.g., whether they are stuck in `admin_awaiting_preferred_agent`, their active `adminContext`, etc.).
2. **Full Debug Log:** An ordered list of their interactions including the `toolTrace` operations (e.g., `admin_mode_entry`, `add_lead`, `admin_my_leads`), AI fallbacks, timings, and exact LLM replies.
3. **Recent Messages:** The last 20 raw webhook payloads to and from that number to verify delivery status.

## 2. General Production Health Check

To check the overall health of the WhatsApp webhook integration and agent queues:

**Command:**
```bash
node scratch/prod-whatsapp-debug.cjs
```
*(Running it without a phone number argument).*

**What this dumps:**
- **Last 30 WhatsApp Messages:** Recent raw messages and delivery statuses.
- **Unreplied Inbound 24h:** Any inbound message from the last 24 hours that does NOT have a corresponding `agent_reply_<id>` outbound message.
- **Message Counts:** Traffic statistics over the last 1 hour and 24 hours.
- **Inbox Tail:** The last 20 entries in the pending message queue.

## 3. Retrying Failed Messages

If a webhook failed or the system crashed before generating a reply, messages remain in the queue or show up in the "Unreplied Inbound" query.

**Command:**
```bash
node scripts/retry-failed.mjs
```

**Setup:**
Before running, you must open `scripts/retry-failed.mjs` and insert the `processSecret` matching your production `WHATSAPP_AGENT_PROCESS_SECRET`.

**What this does:**
It calls the `/api/whatsapp-agent/process` endpoint to force-process the last 7 days of unreplied messages synchronously.

## 4. Key Database Tables

If you need to write custom SQL queries, here are the crucial tables:
- `et_messages`: Stores all raw WhatsApp messages. `external_message_id` matches the webhook ID. AI replies always have `external_message_id` prefixed with `agent_reply_`.
- `et_channel_sessions`: The `metadata` JSONB column holds the active state machines (`agentStates`) and historical trace logs (`agentDebugLog`).
- `wa_inbound_inbox`: Temporary holding table for unprocessed webhooks.

## 5. Testing with Sandbox

If you are developing a new workflow, you can test it locally without triggering real WhatsApp messages using the web Sandbox:
1. Run `npm run dev`
2. Navigate to `http://localhost:3000/agent-sandbox`
3. Enter phone numbers and test the LLM behavior safely.

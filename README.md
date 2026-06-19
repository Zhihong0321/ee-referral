# EE Referral Portal

Next.js landing page + dashboard for a WhatsApp-first referral program.

## What this app does

- Landing page that explains the referral program and 2% commission model.
- Standard Terms & Conditions page for the referral program.
- WhatsApp sign-in via `https://auth.atap.solar` (Auth Hub flow with `auth_token` cookie).
- Creates a referral account in DB (account name is `Referral`) without using the `user` table.
- Referral profile update in dashboard: name, profile picture URL, banking account, banker name.
- Referrer dashboard to add and edit referrals with state, city, address, project type, and preferred agent.
- Manager queue for HR/KC users to filter all referral leads and assign or reassign agents.
- Agent dashboard that only shows referral leads assigned to the logged-in agent.

## Data mapping used

- Referral account:
  - Stored in `customer` with `name='Referral'` and `remark='REFERRAL_ACCOUNT'`.
- Referral lead:
  - Stored in `customer` (`name`, `phone`, `state`, `city`, `address`, `lead_source='referral'`, relationship in `remark`, metadata in `notes`).
- Referral workflow:
  - Stored in `referral` (`name`, `mobile_number`, `relationship`, `status`, `linked_invoice` -> lead `customer.customer_id`, `linked_agent` as preferred agent, `preferred_agent_log` as the append-only audit log for preferred-agent updates, `assigned_agent` as manager-owned assignment, optional denormalized location columns).

## Customer table fit check

Existing `customer` columns already support:

- Lead name: `name`
- Lead mobile: `phone`
- Lead state: `state`
- Lead city: `city`
- Lead address: `address`

Missing direct column:

- `linked_referrer`

Current behavior:

- If `customer.linked_referrer` exists, app writes it.
- If it does not exist (current DB), app stores linked referrer in `customer.notes` JSON metadata.
- Manager authorization uses `user.access_level` and the HR/KC tags.
- Agent assignment is stored separately from the referrer's preferred agent.

## Environment

Copy `.env.example` into `.env.local` and fill values:

```bash
cp .env.example .env.local
```

Required:

- `DATABASE_URL`
- `JWT_SECRET` (must match Auth Hub JWT secret)
- `APP_BASE_URL`
- `AUTH_HUB_URL` (default: `https://auth.atap.solar`)

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Docker / Railway

This repo includes a production `Dockerfile` for Railway deployment.

Local container commands:

```bash
npm run docker:build
npm run docker:run
```

Railway environment variables to set:

- `DATABASE_URL`
- `JWT_SECRET`
- `APP_BASE_URL`
- `AUTH_HUB_URL`

## WhatsApp Agent Inbound Processing

Baileys promotes inbound WhatsApp messages into `et_messages`. The production worker calls:

```text
POST /api/whatsapp-agent/process
```

with:

```json
{
  "source": "database",
  "limit": 10,
  "lookbackMinutes": 60
}
```

The processor reads unreplied inbound rows from `et_messages`, including `message_type`, `text_content`, `media_url`, and `raw_payload`.

Media handling:

- `contact` / `contacts`: parsed from `raw_payload.message.contactMessage` or `contactsArrayMessage`, then sent to the agent as lead name/phone details.
- `image`: `media_url` is resolved and sent to MiniMax M3 as an image block for visual extraction.
- `video`: `media_url` is resolved and sent to MiniMax M3 as a video block for visual extraction.
- `audio` / voice note: `media_url` is downloaded and sent to ASR first, then the transcript is sent to the agent.
- `document` / `sticker`: caption, filename, and media URL are preserved; the agent asks for missing text details when the content is not extractable.

Webhook/testing payloads are still supported through:

```text
POST /api/whatsapp-agent/webhook
```

The route accepts Meta WhatsApp Cloud API webhook payloads, Baileys-style `messages` arrays, or a simple normalized payload:

```json
{
  "externalMessageId": "msg_123",
  "senderPhone": "60123456789",
  "recipientPhone": "60182920127",
  "messageType": "text",
  "text": "add lead",
  "mediaUrl": ""
}
```

For Meta webhook verification, set `WHATSAPP_AGENT_WEBHOOK_VERIFY_TOKEN`; the route responds to `hub.challenge` on `GET /api/whatsapp-agent/webhook`.

Every webhook request is logged as structured JSON in the app server logs with event names like `whatsapp_agent_webhook_post_received`, `whatsapp_agent_webhook_post_ignored`, and `whatsapp_agent_webhook_post_processed`.

If a message is missing from `et_messages`, check `/api/whatsapp-agent/diagnostics` for recent `wa_inbound_inbox` rows with `process_status != 'processed'` and inspect `last_error`.

Local debug helper:

```bash
npm run whatsapp:debug-media -- summary
npm run whatsapp:debug-media -- pending --limit 20 --lookback 1440
npm run whatsapp:debug-media -- contacts --limit 20
npm run whatsapp:debug-media -- probe-url --id <et_messages_id_or_external_message_id>
npm run whatsapp:debug-media -- asr --id <et_messages_id_or_external_message_id>
```

The helper loads `.env.local` / `.env`, reads through the SQL proxy or `DATABASE_URL`, and does not send WhatsApp replies. `asr` is the only command that calls the ASR endpoint, and only for the selected message or URL.

## Auth flow used

1. User enters app dashboard.
2. If `auth_token` cookie is missing/invalid, app redirects to Auth Hub:
   - `https://auth.atap.solar/?return_to=<your-app-url>`
3. User logs in by WhatsApp OTP at Auth Hub.
4. Auth Hub redirects back.
5. App verifies JWT from `auth_token` using shared `JWT_SECRET`.

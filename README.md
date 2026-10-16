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

## Lead intake API

The Lead API provides four authenticated endpoints configured via `LEADS_API_KEY`:

- `GET /api/leads/sources` (or `GET /api/leads/ads`): Lists available ad accounts and lead sources (e.g. `Meta Ads Leon`, `Google Ads Gan`, `Facebook Ads`, `Google Ads`) with their IDs.
- `GET /api/leads/agents` (or `GET /api/agents`): Lists available sales agents (`access_level` containing `sales`) to assign leads to.
- `POST /api/leads`: Ingests incoming leads, associates them with the selected ad account or referrer, and assigns them to a sales user.
- `GET /api/leads?referrer=Meta%20Ads%20Leon`: Retrieves leads by source name or ID with `limit`/`offset` pagination. Omit `referrer` for all source-account leads.

Public documentation is served at `/api-docs` without login and linked from the
homepage. See [API requests, configuration, and responses](docs/lead-api.md) for
server setup details.

For AI coding tools, the public page links to `/api-docs/agent-guide` (plain
Markdown with a complete integration workflow and runnable read-only Node.js
example) and `/api-docs/openapi.json` (OpenAPI 3.1 request/response contract).
`/llms.txt` provides discovery links. These documents require no API key;
business API calls use the same `LEADS_API_KEY` in the bearer header.

## Run

```bash
npm install
npm run dev
```

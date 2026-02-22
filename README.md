# EE Referral Portal

Next.js landing page + dashboard for a WhatsApp-first referral program.

## What this app does

- Landing page that explains the referral program and 2% commission model.
- WhatsApp sign-in via `https://auth.atap.solar` (Auth Hub flow with `auth_token` cookie).
- Creates a referral account in DB (account name is `Referral`) without using the `user` table.
- Add and edit referrals.
- Dashboard to track referrals and lead status.

## Data mapping used

- Referral account:
  - Stored in `customer` with `name='Referral'` and `remark='REFERRAL_ACCOUNT'`.
- Referral lead:
  - Stored in `customer` (`name`, `phone`, `state`, `lead_source='referral'`, relationship in `remark`, metadata in `notes`).
- Referral tracking/status:
  - Stored in `referral` (`name`, `mobile_number`, `relationship`, `status`, `linked_invoice` -> lead `customer.customer_id`).

## Customer table fit check

Existing `customer` columns already support:

- Lead name: `name`
- Lead mobile: `phone`
- Lead living region: `state`

Missing direct column:

- `linked_referrer`

Current behavior:

- If `customer.linked_referrer` exists, app writes it.
- If it does not exist (current DB), app stores linked referrer in `customer.notes` JSON metadata.

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

## Auth flow used

1. User enters app dashboard.
2. If `auth_token` cookie is missing/invalid, app redirects to Auth Hub:
   - `https://auth.atap.solar/?return_to=<your-app-url>`
3. User logs in by WhatsApp OTP at Auth Hub.
4. Auth Hub redirects back.
5. App verifies JWT from `auth_token` using shared `JWT_SECRET`.

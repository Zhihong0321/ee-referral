# Create leads through the API

Public documentation: https://referral.atap.solar/api-docs (no login required).

The Lead API provides three endpoints:
1. `GET /api/leads/sources` (or `GET /api/leads/ads`): Lists available ad accounts and lead sources (e.g. `Meta Ads Leon`, `Google Ads Gan`, `Facebook Ads`, `Google Ads`) with their IDs.
2. `GET /api/leads/agents` (or `GET /api/agents`): Lists available sales agents (users with a tag containing `sales` in `access_level`) so the caller knows who can be assigned.
3. `POST /api/leads`: Creates a customer lead and its referral workflow record. The introducer can be an ad source account or an existing person's referral account.

## Configuration

Set `LEADS_API_KEY` to a long random secret in the server environment. Generate
one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
Endpoints return `503` until the key is configured. Keep the key in your
server or automation platform; do not embed it in a public website or ad form.

Database access uses the same configuration as web chat: either all three
`WHATSAPP_AGENT_PROXY_URL`, `WHATSAPP_AGENT_PROXY_AUTH`, and
`WHATSAPP_AGENT_PROXY_DB_NAME` values (with the existing `SANDBOX_PROXY_*`
fallbacks), or `DATABASE_URL` with the application's `JWT_SECRET` configured.
The proxy credential must be valid.

Assignment requires `referral.assigned_agent`. If missing, run the existing
`sql/20260313_add_assignment_and_location_to_referral.sql` migration. Other
optional location and project fields fall back to the customer record/metadata.

---

## 1. List Available Ad Accounts & Lead Sources

Call this endpoint to see which ad accounts and source referrers are available.

### Request

```bash
curl --request GET 'https://YOUR_APP_DOMAIN/api/leads/sources' \
  --header "Authorization: Bearer $LEADS_API_KEY"
```

*(Note: `GET /api/leads/ads` and `GET /api/sources` are also available as aliases).*

### Success response (`200 OK`)

```json
{
  "sources": [
    {
      "id": "src_6c7df534e1f9572f1d3da1e3",
      "name": "Meta Ads Leon",
      "type": "ads"
    },
    {
      "id": "src_74b907b7af778fd4154dcff7",
      "name": "Google Ads Gan",
      "type": "ads"
    },
    {
      "id": "src_56c6cd5bfa64e52c9a416340",
      "name": "Facebook Ads",
      "type": "ads"
    },
    {
      "id": "src_62fa52b9d94790dcbd2d6d92",
      "name": "Google Ads",
      "type": "ads"
    }
  ],
  "ads": [
    {
      "id": "src_6c7df534e1f9572f1d3da1e3",
      "name": "Meta Ads Leon",
      "type": "ads"
    },
    {
      "id": "src_74b907b7af778fd4154dcff7",
      "name": "Google Ads Gan",
      "type": "ads"
    },
    {
      "id": "src_56c6cd5bfa64e52c9a416340",
      "name": "Facebook Ads",
      "type": "ads"
    },
    {
      "id": "src_62fa52b9d94790dcbd2d6d92",
      "name": "Google Ads",
      "type": "ads"
    }
  ]
}
```

When creating a lead, you can pass either the source's **`name`** (e.g. `"referrer": "Meta Ads Leon"`), or its **`id`** (e.g. `"referrer": "src_6c7df534e1f9572f1d3da1e3"`), or `{ "customerId": "src_..." }`.

---

## 2. List Available Sales Agents

Call this endpoint to see which sales agents can be assigned to incoming leads.

### Request

```bash
curl --request GET 'https://YOUR_APP_DOMAIN/api/leads/agents' \
  --header "Authorization: Bearer $LEADS_API_KEY"
```

*(Note: `GET /api/agents` is also available as an alias).*

### Success response (`200 OK`)

```json
{
  "agents": [
    {
      "id": "USER_BUBBLE_ID",
      "name": "Ali Sales",
      "bubbleId": "USER_BUBBLE_ID",
      "numericId": 42,
      "accessLevels": ["Sales"]
    }
  ]
}
```

Use the returned `id` (or `bubbleId` / `numericId`) in the `assignedAgentId` field when adding a lead.

---

## 3. Create a Lead

### Example request

```bash
curl --request POST 'https://YOUR_APP_DOMAIN/api/leads' \
  --header "Authorization: Bearer $LEADS_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{
    "leadName": "Tan Ah Kow",
    "leadMobileNumber": "0123456789",
    "referrer": "Meta Ads Leon",
    "assignedAgentId": "USER_BUBBLE_ID",
    "leadState": "Selangor",
    "leadCity": "Kajang",
    "leadAddress": "1 Jalan Example",
    "projectType": "RESIDENTIAL (2%)",
    "remark": "Inquiry from Meta Ads campaign"
  }'
```

Ad source names:
- `"Meta Ads Leon"`
- `"Google Ads Gan"`
- `"Facebook Ads"`
- `"Google Ads"`

Or provide their source ID directly:
`"referrer": "src_6c7df534e1f9572f1d3da1e3"`

For an existing person, use `"referrer": {"customerId": "EXISTING_REFERRER_CUSTOMER_ID"}`.
That customer must be a referral account marked `REFERRAL_ACCOUNT` or
`REFERRER_ACCOUNT`. The API does not create a person's account implicitly.

`assignedAgentId` accepts either `user.bubble_id` (recommended) or a positive
numeric `user.id`. The selected user must have a sales access level when that
column exists. The stored and returned assignment uses `user.bubble_id`, as the
agent dashboard expects. Omit `assignedAgentId` to leave the lead unassigned.

### Fields

| Field | Required | Description |
| --- | --- | --- |
| `leadName` | Yes | Trimmed name, 2–120 characters. |
| `leadMobileNumber` | Yes | Malaysian phone number, normalized to `60…`. |
| `referrer` | Yes | Source name, Source ID (`src_...`), or `{ "customerId": "…" }`. |
| `assignedAgentId` | No | Sales user's Bubble ID or numeric ID. |
| `leadState`, `leadCity` | No | Up to 120 characters each. |
| `leadAddress` | No | Up to 500 characters. |
| `relationship` | No | Existing relationship option; defaults to `Other`. |
| `projectType` | No | `RESIDENTIAL (2%)`, `SHOP-LOT (2%)`, `FACTORY (1%)`, or `OTHERS`; defaults to `OTHERS`. |
| `remark` | No | Up to 500 characters. |

Unknown fields are rejected so misspelled assignments cannot silently disappear.

### Success response

HTTP `201`:

```json
{
  "lead": {
    "referralId": 123,
    "leadCustomerId": "cust_example",
    "leadName": "Tan Ah Kow",
    "leadMobileNumber": "60123456789",
    "referrer": {
      "customerId": "src_6c7df534e1f9572f1d3da1e3",
      "name": "Meta Ads Leon",
      "type": "source"
    },
    "assignedAgentId": "USER_BUBBLE_ID",
    "status": "Assigned"
  }
}
```

Unassigned leads return `assignedAgentId: null` and `status: "Pending"`.

Sources are reusable customer records marked `LEAD_SOURCE_ACCOUNT`, without a
phone or payout account. The referral links to that source through
`linked_customer_profile`, so existing manager/agent views show the source as
the introducer. Digital ad leads use the existing `digital_ads` lead-source
category; the exact source name is retained on the introducer and in lead metadata.
Other named sources use `other`; person introductions use `referral`. Assignment
is saved in `referral.assigned_agent`; the separate preferred-agent field is left empty.

Source creation/reuse, the customer lead, the referral, and its audit entry are
saved atomically. This endpoint does not send WhatsApp messages. Each successful
request creates a new lead; repeated requests are not deduplicated, so do not
automatically replay a request whose outcome is unknown.

## Error responses

Errors have `{ "error": "Readable explanation", "code": "ERROR_CODE" }`.

| Status | Code | Meaning |
| --- | --- | --- |
| `400` | `INVALID_JSON` / `INVALID_INPUT` | Invalid JSON or fields; field errors include an `issues` array. |
| `401` | `UNAUTHORIZED` | Missing or incorrect bearer key. |
| `415` | `INVALID_CONTENT_TYPE` | Send `Content-Type: application/json`. |
| `422` | `INVALID_AGENT` / `INVALID_REFERRER` | Unknown/ineligible assigned user or person account. |
| `503` | `API_NOT_CONFIGURED` | Configure `LEADS_API_KEY`. |
| `503` | `ASSIGNMENT_NOT_CONFIGURED` | Apply the assignment migration. |
| `500` | `INTERNAL_ERROR` | Request failed; database details are not returned. |

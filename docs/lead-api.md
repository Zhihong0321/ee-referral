# Eternalgy Lead API

Public documentation: https://referral.atap.solar/api-docs (no login required).

For AI coding agents, start with the public
[plain Markdown integration guide](https://referral.atap.solar/api-docs/agent-guide)
and [OpenAPI 3.1 JSON contract](https://referral.atap.solar/api-docs/openapi.json).
Discovery links are also available at https://referral.atap.solar/llms.txt.
Use documentation from the same deployed server as the API; confirm the deployment
with the administrator if a documented operation returns 404/405.

The Lead API provides four endpoints:
1. `GET /api/leads/sources` (or `GET /api/leads/ads`): Lists available ad accounts and lead sources (e.g. `Meta Ads Leon`, `Google Ads Gan`, `Facebook Ads`, `Google Ads`) with their IDs.
2. `GET /api/leads/agents` (or `GET /api/agents`): Lists available sales agents (users with a tag containing `sales` in `access_level`) so the caller knows who can be assigned.
3. `POST /api/leads`: Creates a customer lead and its referral workflow record. The introducer can be an ad source account or an existing person's referral account.
4. `GET /api/leads`: Retrieves leads by referrer source name or ID, with pagination.

## Quick start for an integration

Base URL: `https://referral.atap.solar`.

1. Obtain the existing **`LEADS_API_KEY`** from the API administrator. Configure that same value as a backend environment secret; callers do not generate a separate key or need database credentials.
2. Fetch sources and agents. Use real returned IDs; `USER_BUBBLE_ID` in examples is a placeholder. The `ads` array is a subset of `sources`, not another page.
3. For a real incoming lead, POST its name, Malaysian phone, and `referrer`. Include `assignedAgentId` to assign it; omit it for Pending status and null assignment. Save the returned `referralId` and `leadCustomerId`.
4. Query leads with `referrer` set to the source name or ID, increasing `offset` by `limit` until `pagination.hasMore` is false. A runnable, read-only Node.js 22+ example is included in the public Markdown guide.

**Introducer** is the business name; the exact API field/query parameter is
**`referrer`**. `referralId` identifies the workflow, `leadCustomerId` the lead
customer, and `referrer.customerId` the Introducer. Assignment is independent
of the Introducer and feeds the existing assigned-agent dashboard.

Every business endpoint requires `Authorization: Bearer <LEADS_API_KEY value>`.
This is an opaque shared secret, not a JWT/OAuth token; login cookies are unnecessary.
Send `Content-Type: application/json` on POST. A `referrer` filter is not an
authorization boundary: the shared key can query all source accounts.

Meta/Google form connections and assignment/rotation rules belong in the calling
integration. This API provides no update/delete, reassignment, single-lead lookup,
full activity history, or WhatsApp notification operation. Status is the current
value stored in this system, not an automatic pull from an external CRM.

## API server configuration (administrator only)

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

Configured defaults may be listed before they have leads. To add another source,
send its intended name, such as `TikTok Ads Mei`, on the first lead POST; the
successful submission automatically creates/reuses the source account. Listing
and querying do not create sources. Reuse returned IDs for existing accounts;
do not invent IDs because an unknown string is treated as a new source name.

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
An empty list means leave the lead unassigned or contact the administrator.
The normal schema filters access levels containing `sales`; legacy schemas
without `access_level` cannot apply that filter.

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
Use the object form for a person; a bare person's name is treated as a source name.

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
Use exact camelCase names. Omit optional fields for defaults; `null` values and
empty `assignedAgentId` are invalid. An agent string is trimmed, 1–80 characters,
and allows letters, digits, underscores, or hyphens; numeric IDs must be positive
safe integers (maximum 9007199254740991). Mobile input is trimmed, 6–40 characters,
with an optional leading `+`, digits, spaces, parentheses, dots, or hyphens.
After formatting removal and Malaysian prefix normalization it must match
`^60\d{9,11}$`.

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

## 4. Retrieve Leads by Referrer Source

Use `GET /api/leads` with the same bearer API key to retrieve leads introduced
by `Meta Ads Leon`, `Google Ads Gan`, or any other named source account.

```bash
curl --get 'https://YOUR_APP_DOMAIN/api/leads' \
  --header "Authorization: Bearer $LEADS_API_KEY" \
  --data-urlencode 'referrer=Meta Ads Leon' \
  --data-urlencode 'limit=100' \
  --data-urlencode 'offset=0'
```

Replace `Meta Ads Leon` with `Google Ads Gan`, another source name, or a source
`id` returned by `GET /api/leads/sources`. Name matching is exact, ignoring case
and repeated spaces; it does not match partial names. Unknown sources return an
empty list. Omit `referrer` to retrieve leads across all source accounts,
including non-ad sources. Person-referral accounts are excluded.
The GET filter is one string, not a customerId object, array, wildcard, or
comma-separated list. Query multiple sources separately or omit the filter.

| Query parameter | Required | Description |
| --- | --- | --- |
| `referrer` | No | Source name or source customer ID, 2–120 characters. |
| `limit` | No | Page size, 1–500; defaults to `100`. |
| `offset` | No | Number of matching records to skip, 0–2147483647; defaults to `0`. |

Unknown or repeated query parameters are rejected with `400 INVALID_INPUT`.

### Success response (`200 OK`)

```json
{
  "leads": [
    {
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
      "status": "Assigned",
      "leadState": "Selangor",
      "leadCity": "Kajang",
      "leadAddress": "1 Jalan Example",
      "relationship": "Other",
      "projectType": "RESIDENTIAL (2%)",
      "remark": "Inquiry from Meta Ads campaign",
      "createdAt": "2026-10-16T02:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 1,
    "limit": 100,
    "offset": 0,
    "hasMore": false
  }
}
```

Results are ordered by descending referral ID. To retrieve all matching leads,
increase `offset` by `limit` after each page until `hasMore` is `false`.
Pagination reflects current records; fetch during a quiet period if you need a
stable export while new leads are arriving. The response uses `Cache-Control:
no-store` and includes current workflow statuses (not only Pending/Assigned).
Current UI statuses include Pending, Assigned, Contacted, Qualified, Successful,
and Rejected, but clients must preserve unfamiliar legacy status strings.
`leadCustomerId`, `leadMobileNumber`, `assignedAgentId`, and `createdAt` can be
null; `createdAt` is a timestamp string when available.
Missing legacy details return empty strings or `null`; this endpoint does not
create source accounts or change leads.

## Error responses

Errors have `{ "error": "Readable explanation", "code": "ERROR_CODE" }`.

| Status | Code | Meaning |
| --- | --- | --- |
| `400` | `INVALID_JSON` / `INVALID_INPUT` | Invalid JSON, fields, or query parameters; create-lead field errors include an `issues` array. |
| `401` | `UNAUTHORIZED` | Missing or incorrect bearer key. |
| `415` | `INVALID_CONTENT_TYPE` | Send `Content-Type: application/json`. |
| `422` | `INVALID_AGENT` / `INVALID_REFERRER` | Unknown/ineligible assigned user or person account. |
| `503` | `API_NOT_CONFIGURED` | Configure `LEADS_API_KEY`. |
| `503` | `ASSIGNMENT_NOT_CONFIGURED` | Apply the assignment migration. |
| `500` | `INTERNAL_ERROR` | Request failed; database details are not returned. |

Check HTTP status before accessing success fields. Correct validation/auth errors
before retrying; configuration errors require the administrator. Read-only GET
requests may retry transient transport/5xx failures with bounded backoff.
POST has no deduplication or idempotency-key support, including repeated phone
numbers. Do not automatically replay a POST after a timeout, connection loss,
or uncertain response: reconcile first and maintain a caller-side submission
ledger with successful response IDs.

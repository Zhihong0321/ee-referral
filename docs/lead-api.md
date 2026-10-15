# Create leads through the API

Public documentation: https://referral.atap.solar/api-docs (no login required).

`POST /api/leads` creates a customer lead and its referral workflow record. The
introducer can be an advertising source such as `Google Ads` or `Facebook Ads`,
or an existing person's referral account. Assignment is independent of the
introducer and uses the internal `user` table.

## Configuration

Set `LEADS_API_KEY` to a long random secret in the server environment. Generate
one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
The endpoint returns `503` until the key is configured. Keep the key in your
server or automation platform; do not embed it in a public website or ad form.

Database access uses the same configuration as web chat: either all three
`WHATSAPP_AGENT_PROXY_URL`, `WHATSAPP_AGENT_PROXY_AUTH`, and
`WHATSAPP_AGENT_PROXY_DB_NAME` values (with the existing `SANDBOX_PROXY_*`
fallbacks), or `DATABASE_URL` with the application's `JWT_SECRET` configured.
The proxy credential must be valid.

Assignment requires `referral.assigned_agent`. If missing, run the existing
`sql/20260313_add_assignment_and_location_to_referral.sql` migration. Other
optional location and project fields fall back to the customer record/metadata.

## Example request

```bash
curl --request POST 'https://YOUR_APP_DOMAIN/api/leads' \
  --header "Authorization: Bearer $LEADS_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{
    "leadName": "Ali Ahmad",
    "leadMobileNumber": "0123456789",
    "referrer": "Google Ads",
    "assignedAgentId": "USER_BUBBLE_ID",
    "leadState": "Selangor",
    "leadCity": "Kajang",
    "leadAddress": "1 Jalan Example",
    "remark": "Interested in rooftop solar"
  }'
```

Use `"referrer": "Facebook Ads"` for Facebook leads. Source names ignore
surrounding/repeated spaces and case for identity; the two ad names are displayed
as `Google Ads` and `Facebook Ads`. Other source names are also accepted.

For an existing person, use `"referrer": {"customerId": "EXISTING_REFERRER_CUSTOMER_ID"}`.
That customer must be a referral account marked `REFERRAL_ACCOUNT` or
`REFERRER_ACCOUNT`. The API does not create a person's account implicitly.

`assignedAgentId` accepts either `user.bubble_id` (recommended) or a positive
numeric `user.id`. The selected user must have a sales access level when that
column exists. The stored and returned assignment uses `user.bubble_id`, as the
agent dashboard expects. Omit `assignedAgentId` to leave the lead unassigned.

## Fields

| Field | Required | Description |
| --- | --- | --- |
| `leadName` | Yes | Trimmed name, 2–120 characters. |
| `leadMobileNumber` | Yes | Malaysian phone number, normalized to `60…`. |
| `referrer` | Yes | Source name, 2–120 characters, or `{ "customerId": "…" }`. |
| `assignedAgentId` | No | Sales user's Bubble ID or numeric ID. |
| `leadState`, `leadCity` | No | Up to 120 characters each. |
| `leadAddress` | No | Up to 500 characters. |
| `relationship` | No | Existing relationship option; defaults to `Other`. |
| `projectType` | No | `RESIDENTIAL (2%)`, `SHOP-LOT (2%)`, `FACTORY (1%)`, or `OTHERS`; defaults to `OTHERS`. |
| `remark` | No | Up to 500 characters. |

Unknown fields are rejected so misspelled assignments cannot silently disappear.

## Success response

HTTP `201`:

```json
{
  "lead": {
    "referralId": 123,
    "leadCustomerId": "cust_example",
    "leadName": "Ali Ahmad",
    "leadMobileNumber": "60123456789",
    "referrer": {
      "customerId": "src_example",
      "name": "Google Ads",
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
the introducer. Google Ads and Facebook Ads leads use the existing `digital_ads`
lead-source category; the exact source name is retained on the introducer and in
lead metadata. Other named sources use `other`; person introductions use
`referral`. Assignment is saved in `referral.assigned_agent`;
the separate preferred-agent field is left empty.

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
| `500` | `INTERNAL_ERROR` | Creation failed; database details are not returned. |

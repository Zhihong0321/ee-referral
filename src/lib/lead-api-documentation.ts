import { leadSourceCustomerId } from "./lead-api.ts";
import { KNOWN_AD_SOURCES } from "./referral-options.ts";

export const LEAD_API_BASE_URL = "https://referral.atap.solar";

export const sourceExamples = KNOWN_AD_SOURCES.map((name) => ({ id: leadSourceCustomerId(name), name, type: "ads" as const }));
export const agentExample = { id: "USER_BUBBLE_ID", name: "Ali Sales", bubbleId: "USER_BUBBLE_ID", numericId: 42, accessLevels: ["Sales"] };
export const minimalLeadExample = { leadName: "Tan Ah Kow", leadMobileNumber: "0123456789", referrer: "Meta Ads Leon" };
export const assignedLeadExample = {
  ...minimalLeadExample, assignedAgentId: agentExample.id, leadState: "Selangor", leadCity: "Kajang",
  leadAddress: "1 Jalan Example", remark: "Interested in rooftop solar",
};
export const createdLeadExample = {
  referralId: 123, leadCustomerId: "cust_example", leadName: minimalLeadExample.leadName, leadMobileNumber: "60123456789",
  referrer: { customerId: leadSourceCustomerId(minimalLeadExample.referrer), name: minimalLeadExample.referrer, type: "source" as const },
  assignedAgentId: agentExample.id, status: "Assigned" as const,
};
export const listedLeadExample = {
  ...createdLeadExample, leadState: assignedLeadExample.leadState, leadCity: assignedLeadExample.leadCity,
  leadAddress: assignedLeadExample.leadAddress, relationship: "Other", projectType: "OTHERS",
  remark: assignedLeadExample.remark, createdAt: "2026-10-16T02:00:00.000Z",
};
export const leadListExample = { leads: [listedLeadExample], pagination: { total: 1, limit: 100, offset: 0, hasMore: false } };

// This example is shown on the page and in the raw guide. It intentionally
// reads only: running a documentation example must not create live leads.
export const paginationExample = `// Node.js 22+, server-side. Set LEADS_API_KEY in your environment.
const baseUrl = process.env.LEADS_API_BASE_URL || "https://referral.atap.solar";
const apiKey = process.env.LEADS_API_KEY;
if (!apiKey) throw new Error("Set LEADS_API_KEY before calling the API.");

async function getJson(path, params = {}) {
  const url = new URL(path, baseUrl);
  url.search = new URLSearchParams(params).toString();
  const response = await fetch(url, {
    headers: { Authorization: \`Bearer \${apiKey}\` },
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(\`HTTP \${response.status}: \${body.code}: \${body.error}\`);
  }
  return body;
}

const { sources } = await getJson("/api/leads/sources");
const { agents } = await getJson("/api/leads/agents");
// Select actual source/agent IDs from these responses; example IDs are placeholders.
console.log({ sources, agents });

const leadsById = new Map();
const limit = 100;
let offset = 0;
while (true) {
  const page = await getJson("/api/leads", {
    referrer: "Meta Ads Leon", // Or "Google Ads Gan", another source name, or source ID.
    limit: String(limit),
    offset: String(offset),
  });
  for (const lead of page.leads) leadsById.set(lead.referralId, lead);
  if (!page.pagination.hasMore) break;
  offset += page.pagination.limit;
}
const leads = [...leadsById.values()];
console.log({ count: leads.length });`;

export const leadApiAgentGuide = `# Eternalgy Lead API — integration guide for AI agents

Base URL: ${LEAD_API_BASE_URL}
Human documentation: ${LEAD_API_BASE_URL}/api-docs
OpenAPI 3.1 contract: ${LEAD_API_BASE_URL}/api-docs/openapi.json
This Markdown guide: ${LEAD_API_BASE_URL}/api-docs/agent-guide
The documentation URLs are public. Every business API operation requires a bearer key.
Use the documentation and API from the same deployed server. If a documented operation returns 404/405, confirm the deployment with the administrator.

## Vocabulary and scope

- Introducer is the business term. The exact, case-sensitive JSON field and query parameter is referrer, not introducer or source.
- A source account identifies an origin such as Meta Ads Leon, Google Ads Gan, TikTok Ads Mei, or Roadshow.
- assignedAgentId identifies the sales user receiving a lead, independently of its Introducer. It is not the separate preferred-agent field.
- referralId identifies the workflow record; leadCustomerId identifies the customer lead; referrer.customerId identifies the Introducer. Do not interchange them.
- This API stores and retrieves records. Connecting Meta/Google forms or applying a rotation/assignment policy belongs in the calling integration.
- The bearer key is a shared integration credential, not a per-Introducer permission. The referrer filter selects records; it does not restrict what the key can access.
- Current scope: create, list sources, list agents, list source-account leads. There is no API operation here to update/delete leads, reassign existing leads, retrieve a single lead by ID, or fetch full status/activity history.
- Creation sends no WhatsApp notification. Status reflects the last value stored in this system, not an automatic pull from an external CRM.

## Authentication

Ask the administrator for the existing LEADS_API_KEY. Store it as a backend environment secret. Do not generate a different caller-side key, embed it in browser code, or put it in URLs.
Send Authorization: Bearer <LEADS_API_KEY> on every API request. This is an opaque secret, not an OAuth token or JWT; login cookies are unnecessary.
Send Content-Type: application/json on POST only. JSON property names are camelCase and case-sensitive.
All API responses are JSON with Cache-Control: no-store. The caller needs HTTPS access and the key, not database credentials.

## Operations and order

1. GET /api/leads/sources -> 200 { sources: [{ id, name, type }], ads: [...] }. ads is the subset of sources with type=ads, not a second page. Configured defaults are returned even before they have leads. Aliases: GET /api/leads/ads and GET /api/sources.
2. GET /api/leads/agents -> 200 { agents: [{ id, name, bubbleId, numericId, accessLevels }] }. Prefer the returned id for assignedAgentId. On the normal schema agents have an access level containing sales; a legacy database without access_level cannot enforce that filter. An empty list means leave the lead unassigned or contact the administrator. Alias: GET /api/agents.
3. POST /api/leads -> 201 { lead: {...} }. A real write: submit only when an actual lead should be created.
4. GET /api/leads?referrer=Meta%20Ads%20Leon&limit=100&offset=0 -> 200 { leads: [...], pagination: { total, limit, offset, hasMore } }.

### Create a lead

Minimum valid JSON (unassigned; returns status Pending and assignedAgentId null):

\`\`\`json
${JSON.stringify(minimalLeadExample, null, 2)}
\`\`\`

Assigned example (replace USER_BUBBLE_ID with a real returned agent id):

\`\`\`json
${JSON.stringify(assignedLeadExample, null, 2)}
\`\`\`

Required: leadName (trimmed 2–120 characters), leadMobileNumber (6–40 input characters, Malaysian mobile), referrer.
Mobile input allows an optional leading +, digits, spaces, parentheses, dots and hyphens. Formatting is removed and Malaysian 0/1 prefixes are normalized to 60; the result must match ^60\\d{9,11}$. Example: 0123456789 -> 60123456789.
referrer accepts a source name (trimmed 2–120 characters), a source id returned by the list, or { "customerId": "EXISTING_ACCOUNT_ID" } (trimmed 1–120 characters).
An existing person must use the customerId object and have a referral account. A bare person's name is interpreted as a source name.
For a new named source, send its exact intended name. The first successful POST creates/reuses its source account automatically. Subsequent case/spacing variants reuse the same generated ID. Reuse a returned ID for existing/imported accounts; do not invent source IDs, since an unknown string is treated as a new source name.
Optional assignedAgentId: a returned agent id/Bubble ID (trimmed 1–80 letters, digits, _ or -), or positive numeric user ID up to 9007199254740991. Omit it for an unassigned lead; null and empty strings are invalid. Creation returns the Bubble ID.
Optional leadState and leadCity: trimmed strings up to 120 characters; leadAddress and remark: up to 500. Defaults are empty strings.
Optional relationship: Family, Friend, Colleague, Neighbor, Business Partner, Existing Customer, Community Contact, Other. Default Other.
Optional projectType: RESIDENTIAL (2%), SHOP-LOT (2%), FACTORY (1%), OTHERS. Default OTHERS.
Omit optional fields to use defaults. null and unknown fields (including introducer, assigned_agent, status, campaignId) are rejected.
Record the returned lead.referralId and lead.leadCustomerId in the calling system.

### Retrieve all leads for an Introducer

referrer is a single optional string, 2–120 trimmed characters: an exact source name (case/repeated spaces ignored) or exact source customer ID. It is not an object, substring, wildcard, comma-separated list, or array. Query different sources separately, or omit it for all source accounts including non-ad sources. Person-referral accounts are excluded from this GET, even though POST accepts people.
Unknown source -> 200 with an empty leads array; querying never creates a source. URL-encode parameters with URLSearchParams or curl --data-urlencode.
limit defaults to 100, range 1–500. offset defaults to 0, range 0–2147483647. Send decimal whole numbers. Unknown, blank, repeated, negative or fractional parameters are invalid.
Ordering is descending referralId. Keep the same filter/limit and add pagination.limit to offset until hasMore=false. total is the full matching count, not page length; an offset beyond the end returns an empty page with the same total.
Each page reflects current data. Inserts/deletes during an export can shift offsets: deduplicate by referralId and use a quiet period for a stable export. This is not a change feed or snapshot export.
Read response example:

\`\`\`json
${JSON.stringify(leadListExample, null, 2)}
\`\`\`

createdAt is a timestamp string or null. leadCustomerId, leadMobileNumber and assignedAgentId may be null for legacy/unassigned records. Missing location/remarks return empty strings. GET status is an open string: current UI values include Pending, Assigned, Contacted, Qualified, Successful, Rejected, but legacy values can differ. Do not limit reads to the two POST creation statuses.

## Runnable read-only example (Node.js 22+)

Save as example.mjs, configure LEADS_API_KEY, and run node example.mjs. LEADS_API_BASE_URL may override the base for local testing. This example discovers options and reads leads; it never creates one.

\`\`\`javascript
${paginationExample}
\`\`\`

## Errors and retry behavior

Errors: { "error": "Readable explanation", "code": "ERROR_CODE" }. POST validation errors may include issues: [{ path, message }]. Check HTTP status before reading a success shape.
- 400 INVALID_JSON / INVALID_INPUT: fix JSON, field names/values, or query parameters. Do not retry unchanged.
- 401 UNAUTHORIZED: missing/incorrect bearer key; check secret/header.
- 415 INVALID_CONTENT_TYPE: POST needs application/json.
- 422 INVALID_AGENT / INVALID_REFERRER: refresh agents or correct the existing referrer account ID.
- 503 API_NOT_CONFIGURED / ASSIGNMENT_NOT_CONFIGURED: administrator must configure the server or assignment storage.
- 500 INTERNAL_ERROR: request failed; internal database details are intentionally omitted.
GET requests are read-only; transient transport/5xx errors may be retried with bounded exponential backoff. Configuration/validation/authentication errors require correction.
POST is not idempotent: every successful call creates a new lead, including repeated phone numbers. No deduplication or idempotency-key support is implemented. Never automatically retry a POST after a timeout, connection loss, or uncertain response; reconcile first. A source-name filter is not an idempotency check. Save successful response IDs and maintain the caller's submission ledger.
`;

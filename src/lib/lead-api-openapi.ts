import {
  agentExample, assignedLeadExample, createdLeadExample, leadListExample,
  LEAD_API_BASE_URL, minimalLeadExample, sourceExamples,
} from "./lead-api-documentation.ts";
import { PROJECT_TYPE_OPTIONS, RELATIONSHIP_OPTIONS } from "./referral-options.ts";

type Schema = Record<string, unknown>;
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const object = (properties: Record<string, Schema>, required = Object.keys(properties)) => ({
  type: "object", properties, required, additionalProperties: false,
});
const string = { type: "string" };
const nullableString = { type: ["string", "null"] };
const jsonResponse = (description: string, schema: Schema, example?: unknown) => ({
  description,
  headers: { "Cache-Control": { schema: { type: "string", const: "no-store" }, description: "API responses are not cacheable." } },
  content: { "application/json": { schema, ...(example === undefined ? {} : { example }) } },
});
const errorResponse = (description: string, code: string) => jsonResponse(description, ref("Error"), { error: description, code });
const commonErrors = {
  "401": errorResponse("Missing or incorrect Authorization: Bearer <LEADS_API_KEY>.", "UNAUTHORIZED"),
  "503": errorResponse("Server API key is not configured; contact the administrator.", "API_NOT_CONFIGURED"),
  "500": errorResponse("Unable to complete the request. Internal details are omitted.", "INTERNAL_ERROR"),
};
const referrerProperties = { customerId: string, name: string, type: { type: "string", enum: ["source", "person"] } };
const leadProperties = {
  referralId: { type: "integer", description: "Workflow record ID; use for deduplication when reading pages." },
  leadCustomerId: string,
  leadName: string,
  leadMobileNumber: { type: "string", pattern: "^60\\d{9,11}$", description: "Canonical Malaysian mobile number." },
  referrer: ref("Referrer"),
  assignedAgentId: { ...nullableString, description: "Assigned user's Bubble ID, or null if unassigned." },
  status: { type: "string", enum: ["Pending", "Assigned"] },
};

export const leadApiOpenApi = {
  openapi: "3.1.0",
  info: {
    title: "Eternalgy Lead API",
    version: "1.1.0",
    description: "Create leads with source attribution and optional agent assignment; discover source accounts and agents; retrieve current source-account leads. Introducer is the business term for referrer. Use LEADS_API_KEY as an opaque bearer secret, not a JWT. POST is not idempotent and must not be replayed automatically after an uncertain outcome. No update/delete, reassignment, full history, external ad-platform sync, or WhatsApp notification operation is provided here. Contract version describes this deployment's documentation, not a /v1 path.",
  },
  servers: [{ url: LEAD_API_BASE_URL, description: "Production; use a matching deployment for local testing." }],
  externalDocs: { url: `${LEAD_API_BASE_URL}/api-docs/agent-guide`, description: "Complete Markdown integration guide and runnable read-only Node.js example." },
  security: [{ LeadApiKey: [] }],
  tags: [{ name: "Leads" }, { name: "Sources" }, { name: "Agents" }],
  paths: {
    "/api/leads/sources": {
      get: {
        operationId: "listLeadSources", tags: ["Sources"], summary: "List source Introducers",
        description: "Returns configured defaults and stored source accounts. ads is a subset of sources, not another page. Listing does not create accounts or connect to Meta/Google. New named sources are created on the first successful lead POST. Aliases: /api/leads/ads and /api/sources.",
        responses: {
          "200": jsonResponse("Available source accounts (may have no leads yet).", object({
            sources: { type: "array", items: ref("Source") }, ads: { type: "array", items: ref("Source") },
          }), { sources: sourceExamples, ads: sourceExamples }),
          ...commonErrors,
        },
      },
    },
    "/api/leads/agents": {
      get: {
        operationId: "listLeadAgents", tags: ["Agents"], summary: "List assignable sales users",
        description: "Use a returned id as assignedAgentId. id and bubbleId are the same; numericId is also accepted on creation. Normal databases filter access levels containing sales; legacy schemas without access_level cannot apply that filter. An empty result means no eligible users were found. Alias: /api/agents.",
        responses: { "200": jsonResponse("Assignable agents.", object({ agents: { type: "array", items: ref("Agent") } }), { agents: [agentExample] }), ...commonErrors },
      },
    },
    "/api/leads": {
      post: {
        operationId: "createLead", tags: ["Leads"], summary: "Create a lead with Introducer and optional assignment",
        description: "Requires leadName, leadMobileNumber, referrer. Omit assignedAgentId for Pending/null assignment; a valid assignment returns Assigned and the user's Bubble ID. A bare referrer string resolves a known/existing source ID, otherwise creates/reuses a named source. Use {customerId} for an existing person or source; unknown account IDs in that object are rejected. Do not invent source IDs. Optional fields must be omitted rather than null. Unknown fields are rejected. Each successful POST creates a new customer lead and workflow, even for repeated phones; no idempotency-key support or deduplication. Source, lead, workflow, audit save atomically. Sends no WhatsApp notification.",
        requestBody: { required: true, content: { "application/json": {
          schema: ref("CreateLeadInput"),
          examples: { unassigned: { summary: "Minimum request; Pending", value: minimalLeadExample }, assigned: { summary: "Replace USER_BUBBLE_ID with a returned agent id", value: assignedLeadExample } },
        } } },
        responses: {
          "201": jsonResponse("Lead created. Persist both returned IDs in the caller's submission ledger.", object({ lead: ref("CreatedLead") }), { lead: createdLeadExample }),
          "400": jsonResponse("INVALID_JSON or INVALID_INPUT. Payload validation may include issues with field paths.", ref("Error"), { error: "Invalid lead payload.", code: "INVALID_INPUT", issues: [{ path: "leadName", message: "Lead name is required." }] }),
          "415": errorResponse("Send Content-Type: application/json.", "INVALID_CONTENT_TYPE"),
          "422": errorResponse("INVALID_AGENT or INVALID_REFERRER: correct the agent or existing account ID.", "INVALID_AGENT"),
          ...commonErrors,
          "503": errorResponse("API_NOT_CONFIGURED or ASSIGNMENT_NOT_CONFIGURED: contact the administrator.", "ASSIGNMENT_NOT_CONFIGURED"),
        },
      },
      get: {
        operationId: "listLeadsBySource", tags: ["Leads"], summary: "Retrieve current leads by source Introducer",
        description: "Only source-account referrals are included; person referrals are excluded even though POST accepts them. Omit referrer for all source accounts including non-ad sources. A referrer filter is not a permission boundary: the shared key can query all sources. Unknown sources return 200 and an empty list. Single exact source name (ignoring case/repeated spaces) or exact ID, not substring/wildcards/arrays/comma-separated names. Sort: descending referralId. Increase offset by limit until pagination.hasMore=false. New records/deletions can shift offsets; deduplicate by referralId and use a quiet period for stable exports. Current stored state only, not activity history or a change feed. Unknown and repeated query parameters are rejected.",
        parameters: [
          { name: "referrer", in: "query", required: false, description: "One source name or returned source customer ID; URL-encode. Omit rather than send blank. Business term: Introducer.", schema: { type: "string", minLength: 2, maxLength: 120 }, examples: { leon: { value: "Meta Ads Leon" }, gan: { value: "Google Ads Gan" }, byId: { value: sourceExamples[0].id } } },
          { name: "limit", in: "query", required: false, description: "Decimal whole-number page size, once only.", schema: { type: "integer", minimum: 1, maximum: 500, default: 100 } },
          { name: "offset", in: "query", required: false, description: "Decimal whole number of matching records to skip, once only.", schema: { type: "integer", minimum: 0, maximum: 2147483647, default: 0 } },
        ],
        responses: {
          "200": jsonResponse("Matching leads and total count, including total when a page is empty.", ref("LeadList"), leadListExample),
          "400": errorResponse("Invalid query; use referrer, limit (1-500), offset (0-2147483647), once each.", "INVALID_INPUT"),
          ...commonErrors,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      LeadApiKey: { type: "http", scheme: "bearer", description: "Existing LEADS_API_KEY configured on the API server. Opaque shared secret, not OAuth/JWT. Send in Authorization header from your backend; never in URLs or browser bundles. Login cookies are not used." },
    },
    schemas: {
      Source: object({ id: string, name: string, type: { type: "string", enum: ["ads", "other"] } }),
      Agent: object({ id: string, name: string, bubbleId: string, numericId: { type: "integer" }, accessLevels: { type: "array", items: string } }),
      Referrer: object(referrerProperties),
      SourceReferrer: object({ ...referrerProperties, type: { type: "string", const: "source" } }),
      CreateLeadInput: object({
        leadName: { type: "string", minLength: 2, maxLength: 120, description: "Trimmed before checking length." },
        leadMobileNumber: { type: "string", minLength: 6, maxLength: 40, pattern: "^\\+?[\\d\\s().-]+$", description: "Trimmed input. Malaysian mobile only: strip formatting, normalize local 0/1 prefixes to 60, then require ^60\\d{9,11}$. Example 0123456789 -> 60123456789." },
        referrer: { oneOf: [
          { type: "string", minLength: 2, maxLength: 120, description: "Source name or actual returned source ID. Trimmed; repeated spaces normalized. Unknown strings are treated as new source names." },
          object({ customerId: { type: "string", minLength: 1, maxLength: 120, description: "Existing person/source customer account ID; trimmed." } }),
        ], description: "Introducer. Existing persons must use the object form." },
        assignedAgentId: { oneOf: [
          { type: "string", minLength: 1, maxLength: 80, pattern: "^[A-Za-z0-9_-]+$", description: "Trimmed returned agent id/Bubble ID (preferred) or numeric user ID as string." },
          { type: "integer", minimum: 1, maximum: 9007199254740991 },
        ], description: "Optional; omit rather than null/empty for unassigned. Must resolve to an eligible user with a Bubble ID." },
        leadState: { type: "string", maxLength: 120, default: "", description: "Trimmed." },
        leadCity: { type: "string", maxLength: 120, default: "", description: "Trimmed." },
        leadAddress: { type: "string", maxLength: 500, default: "", description: "Trimmed." },
        relationship: { type: "string", enum: [...RELATIONSHIP_OPTIONS], default: "Other" },
        projectType: { type: "string", enum: [...PROJECT_TYPE_OPTIONS], default: "OTHERS" },
        remark: { type: "string", maxLength: 500, default: "", description: "Trimmed." },
      }, ["leadName", "leadMobileNumber", "referrer"]),
      CreatedLead: object(leadProperties),
      ListedLead: object({
        ...leadProperties, leadCustomerId: nullableString, leadMobileNumber: nullableString,
        referrer: ref("SourceReferrer"),
        status: { type: "string", description: "Open set of stored statuses. UI values include Pending, Assigned, Contacted, Qualified, Successful, Rejected; legacy values may differ." },
        leadState: string, leadCity: string, leadAddress: string, relationship: string, projectType: string, remark: string,
        createdAt: { ...nullableString, description: "Stored creation timestamp with timezone; null when unavailable. Example: 2026-10-16T02:00:00.000Z." },
      }),
      LeadList: object({ leads: { type: "array", items: ref("ListedLead") }, pagination: ref("Pagination") }),
      Pagination: object({ total: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 500 }, offset: { type: "integer", minimum: 0, maximum: 2147483647 }, hasMore: { type: "boolean" } }),
      Error: object({
        error: string,
        code: { type: "string", enum: ["INVALID_JSON", "INVALID_INPUT", "UNAUTHORIZED", "INVALID_CONTENT_TYPE", "INVALID_AGENT", "INVALID_REFERRER", "API_NOT_CONFIGURED", "ASSIGNMENT_NOT_CONFIGURED", "INTERNAL_ERROR"] },
        issues: { type: "array", items: object({ path: string, message: string }) },
      }, ["error", "code"]),
    },
  },
};

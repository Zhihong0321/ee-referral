import type { Metadata } from "next";
import Link from "next/link";

import { PROJECT_TYPE_OPTIONS, RELATIONSHIP_OPTIONS } from "@/lib/referral-options";
import {
  agentExample, createdLeadExample, leadListExample, minimalLeadExample, paginationExample, sourceExamples,
} from "@/lib/lead-api-documentation";

export const metadata: Metadata = {
  title: "Lead API Documentation | Eternalgy Referral",
  description: "Create and retrieve leads by ad source, and assign them to a sales agent through the Eternalgy Lead API.",
};

const listSourcesExample = `curl --request GET 'https://referral.atap.solar/api/leads/sources' \\
  --header "Authorization: Bearer $LEADS_API_KEY"`;

const listSourcesResponseExample = JSON.stringify({ sources: sourceExamples, ads: sourceExamples }, null, 2);

const listAgentsExample = `curl --request GET 'https://referral.atap.solar/api/leads/agents' \\
  --header "Authorization: Bearer $LEADS_API_KEY"`;

const listAgentsResponseExample = JSON.stringify({ agents: [agentExample] }, null, 2);

const requestExample = `curl --request POST 'https://referral.atap.solar/api/leads' \\
  --header "Authorization: Bearer $LEADS_API_KEY" \\
  --header 'Content-Type: application/json' \\
  --data '{
    "leadName": "Tan Ah Kow",
    "leadMobileNumber": "0123456789",
    "referrer": "Meta Ads Leon",
    "assignedAgentId": "USER_BUBBLE_ID",
    "leadState": "Selangor",
    "leadCity": "Kajang",
    "leadAddress": "1 Jalan Example",
    "remark": "Interested in rooftop solar"
  }'`;

const successExample = JSON.stringify({ lead: createdLeadExample }, null, 2);

const listLeadsExample = `curl --get 'https://referral.atap.solar/api/leads' \\
  --header "Authorization: Bearer $LEADS_API_KEY" \\
  --data-urlencode 'referrer=Meta Ads Leon' \\
  --data-urlencode 'limit=100' \\
  --data-urlencode 'offset=0'`;

const listLeadsResponseExample = JSON.stringify(leadListExample, null, 2);

const fields = [
  ["leadName", "Yes", "string", "Lead name, 2–120 characters."],
  ["leadMobileNumber", "Yes", "string", "Malaysian mobile number. Local and +60 formats are accepted and normalized to 60… ."],
  ["referrer", "Yes", "string | object", 'An ad source name (e.g. "Meta Ads Leon"), source ID ("src_..."), or { "customerId": "EXISTING_REFERRER_CUSTOMER_ID" }.'],
  ["assignedAgentId", "No", "string | integer", "Sales user’s Bubble ID (recommended) or positive numeric user ID. Omit to leave the lead unassigned."],
  ["leadState", "No", "string", "Up to 120 characters."],
  ["leadCity", "No", "string", "Up to 120 characters."],
  ["leadAddress", "No", "string", "Up to 500 characters."],
  ["relationship", "No", "string", 'One of the relationship options below. Defaults to "Other".'],
  ["projectType", "No", "string", 'One of the project types below. Defaults to "OTHERS".'],
  ["remark", "No", "string", "Up to 500 characters."],
];

const errors = [
  ["400", "INVALID_JSON", "The request body is not valid JSON."],
  ["400", "INVALID_INPUT", "Invalid fields or query parameters. Lead creation errors include an issues array for field details."],
  ["401", "UNAUTHORIZED", "The bearer API key is missing or incorrect."],
  ["415", "INVALID_CONTENT_TYPE", "Send Content-Type: application/json."],
  ["422", "INVALID_AGENT", "The assigned user does not exist or is not eligible for sales assignment."],
  ["422", "INVALID_REFERRER", "The supplied person’s referrer account was not found."],
  ["503", "API_NOT_CONFIGURED", "The site administrator needs to configure the API key."],
  ["503", "ASSIGNMENT_NOT_CONFIGURED", "The site administrator needs to enable assignment storage."],
  ["500", "INTERNAL_ERROR", "The request could not be completed. Database details are not returned."],
];

const sections = [
  ["quick-start", "Quick start for AI agents"],
  ["authentication", "Authentication"],
  ["sources", "List available ad sources"],
  ["agents", "List available sales agents"],
  ["leads", "Retrieve leads by source"],
  ["integration", "Working Node.js example"],
  ["request", "Create lead request"],
  ["introducers", "Introducers & agents"],
  ["fields", "Request fields"],
  ["response", "Success response"],
  ["errors", "Errors"],
];

function CodeBlock({ label, children }: { label: string; children: string }) {
  return (
    <figure className="mt-4 min-w-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-950 text-slate-100">
      <figcaption className="border-b border-slate-800 px-4 py-2 text-xs font-semibold text-slate-300">{label}</figcaption>
      <pre className="overflow-x-auto p-4 text-xs leading-6 sm:text-sm"><code>{children}</code></pre>
    </figure>
  );
}

export default function ApiDocsPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 text-sm">
        <Link href="/" className="font-semibold text-teal-800 hover:underline">← Eternalgy Referral</Link>
        <span className="pill">Developer documentation</span>
      </div>
      <header className="card-glow rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <p className="text-sm font-semibold text-teal-800">Lead intake API</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Create leads and retrieve them by source.</h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600 sm:text-base">
          Query available ad accounts and sales agents, then send incoming leads from Meta Ads, Google Ads, custom forms, or referrers.
          Assign each lead to a sales agent independently of who introduced it.
          Retrieve matching leads by referrer source name or ID.
        </p>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-teal-800">
          <a href="/api-docs/openapi.json" className="underline underline-offset-4" type="application/json">OpenAPI 3.1 specification</a>
          <a href="/api-docs/agent-guide" className="underline underline-offset-4" type="text/markdown">Plain Markdown guide for AI agents</a>
        </div>
        <div className="mt-5 space-y-2">
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-100 p-3">
            <span className="rounded-md bg-indigo-700 px-3 py-1 text-xs font-bold text-white">GET</span>
            <code className="break-all text-sm font-semibold">https://referral.atap.solar/api/leads/sources</code>
            <span className="text-xs text-slate-500">(also: /api/leads/ads, /api/sources)</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-100 p-3">
            <span className="rounded-md bg-blue-700 px-3 py-1 text-xs font-bold text-white">GET</span>
            <code className="break-all text-sm font-semibold">https://referral.atap.solar/api/leads/agents</code>
            <span className="text-xs text-slate-500">(also: /api/agents)</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-100 p-3">
            <span className="rounded-md bg-teal-800 px-3 py-1 text-xs font-bold text-white">POST</span>
            <code className="break-all text-sm font-semibold">https://referral.atap.solar/api/leads</code>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-100 p-3">
            <span className="rounded-md bg-blue-700 px-3 py-1 text-xs font-bold text-white">GET</span>
            <code className="break-all text-sm font-semibold">https://referral.atap.solar/api/leads?referrer=Meta%20Ads%20Leon</code>
          </div>
        </div>
      </header>

      <div className="mt-7 grid min-w-0 gap-7 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="API documentation sections" className="h-fit rounded-2xl border border-slate-200 bg-white p-4 lg:sticky lg:top-6">
          <p className="mb-3 px-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">On this page</p>
          <div className="flex flex-wrap gap-1 lg:flex-col">
            {sections.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="rounded-lg px-2 py-2 text-sm font-medium text-teal-800 hover:bg-teal-50">{label}</a>
            ))}
          </div>
        </nav>

        <div className="min-w-0 space-y-6">
          <section id="quick-start" className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <h2 className="text-xl font-bold">Quick start for AI agents</h2>
            <p className="mt-3 text-sm leading-7 text-slate-700">
              Base URL: <code>https://referral.atap.solar</code>. Use this page with the <a href="/api-docs/openapi.json" className="font-semibold text-teal-800 underline">OpenAPI contract</a> and <a href="/api-docs/agent-guide" className="font-semibold text-teal-800 underline">raw integration guide</a> from the same deployed server.
              If a documented operation returns 404 or 405, confirm the deployed version with the administrator.
            </p>
            <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-7 text-slate-700">
              <li>Obtain the existing <code>LEADS_API_KEY</code> from the administrator and configure it as a backend environment secret.</li>
              <li>Call <code>GET /api/leads/sources</code> and <code>GET /api/leads/agents</code>. Select real returned source and agent IDs; <code>USER_BUBBLE_ID</code> in examples is a placeholder.</li>
              <li>For a real incoming lead, call <code>POST /api/leads</code> with <code>leadName</code>, <code>leadMobileNumber</code>, and <code>referrer</code>. Add <code>assignedAgentId</code> to assign it, or omit the field to leave it pending. Save the returned IDs.</li>
              <li>Call <code>GET /api/leads</code> with the source name or ID as <code>referrer</code>. Page through results until <code>pagination.hasMore</code> is false.</li>
            </ol>
            <CodeBlock label="Minimum creation payload · creates an unassigned lead">{JSON.stringify(minimalLeadExample, null, 2)}</CodeBlock>
            <h3 className="mt-5 font-semibold">Terminology and supported scope</h3>
            <p className="mt-2 text-sm leading-7 text-slate-700">
              <strong>Introducer</strong> is the business term; the exact API field is <code>referrer</code>. <code>referralId</code> identifies the workflow, <code>leadCustomerId</code> the lead customer, and <code>referrer.customerId</code> the Introducer.
              Assignment identifies who receives the lead, independently of its source. Leads submitted here join the existing manager and assigned-agent dashboards.
            </p>
            <p className="mt-3 text-sm leading-7 text-slate-700">
              These operations create and read records. Meta/Google form connections and assignment rules must be implemented by the calling integration.
              This API provides no update/delete, reassignment, single-lead lookup, full activity history, or WhatsApp notification operation. Status is the current value stored in this system.
            </p>
          </section>

          <section id="authentication" className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <h2 className="text-xl font-bold">Authentication</h2>
            <p className="mt-3 text-sm leading-7 text-slate-700">Obtain an API key from the site administrator and include it in every request. Login cookies are not required.</p>
            <CodeBlock label="Every API request">{"Authorization: Bearer <value of LEADS_API_KEY>"}</CodeBlock>
            <p className="mt-3 text-sm leading-7 text-slate-700">For <code>POST</code>, also send <code>Content-Type: application/json</code>. The key is an opaque secret, not a JWT or OAuth token. Use the server&apos;s existing key value as one continuous string; do not generate a different key in the calling application.</p>
            <p className="mt-4 text-sm leading-7 text-slate-700">Keep the key on your server or in your automation platform’s secret storage. Send requests from that server or platform.</p>
            <p className="mt-3 text-sm leading-7 text-slate-700">The same key authenticates all four operations. It is a shared integration credential: filtering by <code>referrer</code> does not restrict the key to that source. Documentation is public; API data requires the key. Database credentials are unnecessary for callers.</p>
          </section>

          <section id="sources" className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <h2 className="text-xl font-bold">List available ad sources</h2>
            <p className="mt-3 text-sm leading-7 text-slate-700">
              Query the available ad accounts and lead source referrers (e.g. <code>Meta Ads Leon</code>, <code>Google Ads Gan</code>, <code>Facebook Ads</code>, <code>Google Ads</code>) along with their customer IDs.
            </p>
            <CodeBlock label="cURL · List available ad sources">{listSourcesExample}</CodeBlock>
            <h3 className="mt-4 font-semibold">Response (`200 OK`)</h3>
            <CodeBlock label="200 OK · application/json">{listSourcesResponseExample}</CodeBlock>
            <p className="mt-4 text-sm leading-7 text-slate-700">
              Pass either the source’s <code>name</code> or its <code>id</code> into the <code>referrer</code> field when creating a lead.
              The <code>ads</code> array is a subset of <code>sources</code>, not another page. Configured defaults can be listed before they have any leads.
            </p>
          </section>

          <section id="agents" className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <h2 className="text-xl font-bold">List available sales agents</h2>
            <p className="mt-3 text-sm leading-7 text-slate-700">
              Call this endpoint before creating a lead to see which sales agents can be assigned.
              On the normal database schema, users must have an access level containing <code>sales</code>. Legacy schemas without that column cannot apply the access-level filter.
            </p>
            <CodeBlock label="cURL · List available agents">{listAgentsExample}</CodeBlock>
            <h3 className="mt-4 font-semibold">Response (`200 OK`)</h3>
            <CodeBlock label="200 OK · application/json">{listAgentsResponseExample}</CodeBlock>
            <p className="mt-4 text-sm leading-7 text-slate-700">
              Pass the returned <code>id</code> (or <code>numericId</code>) as the <code>assignedAgentId</code> when creating the lead.
              An empty list means leave the lead unassigned or contact the administrator.
            </p>
          </section>

          <section id="leads" className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <h2 className="text-xl font-bold">Retrieve leads by referrer source</h2>
            <p className="mt-3 text-sm leading-7 text-slate-700">
              Use <code>GET /api/leads</code> with the same bearer API key. Set <code>referrer</code> to <code>Meta Ads Leon</code>, <code>Google Ads Gan</code>,
              another source name, or a source ID from the sources endpoint. Names match exactly, ignoring case and repeated spaces.
              Omit <code>referrer</code> for leads across all source accounts, including non-ad sources. Person-referral accounts are excluded.
            </p>
            <CodeBlock label="cURL · Retrieve leads from Meta Ads Leon">{listLeadsExample}</CodeBlock>
            <p className="mt-4 text-sm leading-7 text-slate-700">
              <code>referrer</code> accepts one string of 2–120 trimmed characters, not an object, array, partial match, wildcard, or comma-separated list. Query multiple sources separately or omit the filter.{" "}
              <code>limit</code> defaults to 100 (range 1–500), and <code>offset</code> defaults to 0 (range 0–2147483647). Send decimal whole numbers and URL-encode names.
              Unknown or repeated parameters return <code>400 INVALID_INPUT</code>. Unknown sources return an empty list.
            </p>
            <CodeBlock label="200 OK · application/json">{listLeadsResponseExample}</CodeBlock>
            <p className="mt-4 text-sm leading-7 text-slate-700">
              Results are ordered by descending referral ID and include current status, assignment, contact, location, and remarks.
              Increase <code>offset</code> by <code>limit</code> until <code>pagination.hasMore</code> is false to retrieve every matching lead.
              New arrivals can shift pages during retrieval. Missing legacy details return empty strings or null.{" "}
              <code>pagination.total</code> counts all matching records, not this page. An offset beyond the end returns an empty page with the same total.
            </p>
            <p className="mt-3 text-sm leading-7 text-slate-700">
              Status is an open string. Current UI values include <code>Pending</code>, <code>Assigned</code>, <code>Contacted</code>, <code>Qualified</code>, <code>Successful</code>, and <code>Rejected</code>; preserve unfamiliar legacy values.
              <code>leadCustomerId</code>, <code>leadMobileNumber</code>, <code>assignedAgentId</code>, and <code>createdAt</code> can be null. <code>createdAt</code> is a timestamp string when available.
            </p>
          </section>

          <section id="integration" className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <h2 className="text-xl font-bold">Working Node.js example</h2>
            <p className="mt-3 text-sm leading-7 text-slate-700">Save as <code>example.mjs</code>, configure <code>LEADS_API_KEY</code>, and run <code>node example.mjs</code> on Node.js 22 or later. This example discovers options and reads all pages without creating leads. Use a quiet period for a stable export; deduplication by referral ID handles repeats when pages shift.</p>
            <CodeBlock label="JavaScript · discovery and paginated retrieval">{paginationExample}</CodeBlock>
          </section>

          <section id="request" className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <h2 className="text-xl font-bold">Create lead request</h2>
            <p className="mt-3 text-sm leading-7 text-slate-700">Set your API key in the <code>LEADS_API_KEY</code> environment variable, then replace <code>USER_BUBBLE_ID</code> with the assigned sales user’s ID from the agents list above.</p>
            <CodeBlock label="cURL · Meta Ads lead assigned to an agent">{requestExample}</CodeBlock>
          </section>

          <section id="introducers" className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <h2 className="text-xl font-bold">Introducers &amp; agents</h2>
            <h3 className="mt-4 font-semibold">Advertising or another source</h3>
            <p className="mt-2 text-sm leading-7 text-slate-700">Use a source name (such as <code>Meta Ads Leon</code>, <code>Google Ads Gan</code>, <code>Facebook Ads</code>, <code>Google Ads</code>) or a source ID (e.g. <code>src_6c7df534e1f9572f1d3da1e3</code>). Case and repeated spaces are canonicalized automatically.</p>
            <p className="mt-2 text-sm leading-7 text-slate-700">To add another source, send its intended name, for example <code>TikTok Ads Mei</code>. The first successful lead submission creates/reuses the source account automatically. Listing or querying does not create one. Reuse returned IDs for existing accounts; an unknown string is interpreted as a new source name, so do not invent IDs.</p>
            <CodeBlock label="Meta Ads Leon by name">{'\"referrer\": \"Meta Ads Leon\"'}</CodeBlock>
            <CodeBlock label="Meta Ads Leon by ID">{'\"referrer\": \"src_6c7df534e1f9572f1d3da1e3\"'}</CodeBlock>
            <h3 className="mt-5 font-semibold">An existing person</h3>
            <p className="mt-2 text-sm leading-7 text-slate-700">Supply the customer ID of an existing referral account. This request does not create a person’s referrer account.</p>
            <p className="mt-2 text-sm leading-7 text-slate-700">Use the object form for a person. A bare person&apos;s name is treated as a source name. The source-lead retrieval endpoint excludes person referrals.</p>
            <CodeBlock label="Existing referrer account">{'\"referrer\": { \"customerId\": \"EXISTING_REFERRER_CUSTOMER_ID\" }'}</CodeBlock>
            <h3 className="mt-5 font-semibold">Independent agent assignment</h3>
            <p className="mt-2 text-sm leading-7 text-slate-700">Use the sales user’s Bubble ID or numeric user ID in <code>assignedAgentId</code>. The response returns the Bubble ID. Omit the field to create an unassigned lead. This sets the assigned agent; it leaves the separate preferred agent empty.</p>
          </section>

          <section id="fields" className="scroll-mt-6 min-w-0 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <h2 className="text-xl font-bold">Request fields</h2>
            <p className="mt-3 text-sm leading-7 text-slate-700">Send a JSON object. Unknown fields are rejected; optional text fields default to empty strings.</p>
            <p className="mt-2 text-sm leading-7 text-slate-700">Use exact camelCase field names. Omit optional fields for defaults; null is invalid, and an empty <code>assignedAgentId</code> is invalid. Source names and text fields are trimmed. Phone input accepts digits, an optional leading +, spaces, parentheses, dots and hyphens (6–40 characters); normalization must produce a Malaysian number matching <code>{"^60\\d{9,11}$"}</code>.</p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[600px] text-left text-sm">
                <caption className="sr-only">Lead creation request fields, requirements, types, and descriptions</caption>
                <thead className="border-b-2 border-slate-200 text-slate-500"><tr>{["Field", "Required", "Type", "Description"].map((heading) => <th key={heading} scope="col" className="px-3 py-3 font-semibold first:pl-0">{heading}</th>)}</tr></thead>
                <tbody>{fields.map(([name, required, type, description]) => <tr key={name} className="border-b border-slate-100 align-top"><th scope="row" className="py-3 pr-3 font-mono text-xs font-medium text-teal-800">{name}</th><td className="px-3 py-3">{required}</td><td className="px-3 py-3 font-mono text-xs">{type}</td><td className="px-3 py-3 leading-6 text-slate-700">{description}</td></tr>)}</tbody>
              </table>
            </div>
            <h3 className="mt-6 font-semibold">Relationship options</h3>
            <p className="mt-2 text-sm leading-7 text-slate-700">{RELATIONSHIP_OPTIONS.join(", ")}</p>
            <h3 className="mt-5 font-semibold">Project types</h3>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-slate-700">{PROJECT_TYPE_OPTIONS.map((type) => <li key={type}><code>{type}</code></li>)}</ul>
          </section>

          <section id="response" className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <h2 className="text-xl font-bold">Success response</h2>
            <p className="mt-3 text-sm leading-7 text-slate-700">HTTP <code>201 Created</code> returns the new referral and lead IDs, the introducer, and the assigned user.</p>
            <CodeBlock label="201 Created · application/json">{successExample}</CodeBlock>
            <p className="mt-4 text-sm leading-7 text-slate-700">Unassigned leads return <code>assignedAgentId: null</code> and <code>status: &quot;Pending&quot;</code>. Person introductions return <code>referrer.type: &quot;person&quot;</code>.</p>
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-950">
              Each successful request creates a new lead. Requests are not deduplicated, so do not automatically replay a request whose outcome is unknown. A successful response means the lead, assignment, and audit entry have been saved together. This endpoint does not send WhatsApp messages.
            </div>
          </section>

          <section id="errors" className="scroll-mt-6 min-w-0 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <h2 className="text-xl font-bold">Error responses</h2>
            <p className="mt-3 text-sm leading-7 text-slate-700">Check HTTP status before reading success fields. Errors contain <code>error</code> and <code>code</code>; POST field validation may include <code>issues</code> with <code>path</code> and <code>message</code>.</p>
            <CodeBlock label="Example · 422 Unprocessable Content">{JSON.stringify({ error: "Assigned agent was not found or is not in sales.", code: "INVALID_AGENT" }, null, 2)}</CodeBlock>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[500px] text-left text-sm">
                <caption className="sr-only">Error response status codes, internal error codes, and descriptions</caption>
                <thead className="border-b-2 border-slate-200 text-slate-500"><tr>{["Status", "Code", "Description"].map((heading) => <th key={heading} scope="col" className="px-3 py-3 font-semibold first:pl-0">{heading}</th>)}</tr></thead>
                <tbody>{errors.map(([status, code, description]) => <tr key={code} className="border-b border-slate-100 align-top"><th scope="row" className="py-3 pr-3 font-mono text-xs font-medium text-teal-800">{status}</th><td className="px-3 py-3 font-mono text-xs">{code}</td><td className="px-3 py-3 leading-6 text-slate-700">{description}</td></tr>)}</tbody>
              </table>
            </div>
            <p className="mt-4 text-sm leading-7 text-slate-700">Correct 400/401/415/422 errors before retrying. Configuration errors require the administrator. Read-only GET requests may retry transient transport/5xx failures with bounded backoff. POST has no deduplication or idempotency-key support: after a timeout, connection loss, or uncertain response, reconcile the submission before retrying. Maintain the caller&apos;s submission ledger and save successful response IDs.</p>
          </section>
        </div>
      </div>
    </main>
  );
}

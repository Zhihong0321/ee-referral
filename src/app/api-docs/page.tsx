import type { Metadata } from "next";
import Link from "next/link";

import { PROJECT_TYPE_OPTIONS, RELATIONSHIP_OPTIONS } from "@/lib/referral-options";

export const metadata: Metadata = {
  title: "Lead API Documentation | Eternalgy Referral",
  description: "Create leads from Google Ads, Facebook Ads, or a referrer, and assign them to a sales agent through the Eternalgy Lead API.",
};

const requestExample = `curl --request POST 'https://referral.atap.solar/api/leads' \\
  --header "Authorization: Bearer $LEADS_API_KEY" \\
  --header 'Content-Type: application/json' \\
  --data '{
    "leadName": "Ali Ahmad",
    "leadMobileNumber": "0123456789",
    "referrer": "Google Ads",
    "assignedAgentId": "USER_BUBBLE_ID",
    "leadState": "Selangor",
    "leadCity": "Kajang",
    "leadAddress": "1 Jalan Example",
    "remark": "Interested in rooftop solar"
  }'`;

const successExample = JSON.stringify({
  lead: {
    referralId: 123,
    leadCustomerId: "cust_example",
    leadName: "Ali Ahmad",
    leadMobileNumber: "60123456789",
    referrer: { customerId: "src_example", name: "Google Ads", type: "source" },
    assignedAgentId: "USER_BUBBLE_ID",
    status: "Assigned",
  },
}, null, 2);

const fields = [
  ["leadName", "Yes", "string", "Lead name, 2–120 characters."],
  ["leadMobileNumber", "Yes", "string", "Malaysian mobile number. Local and +60 formats are accepted and normalized to 60… ."],
  ["referrer", "Yes", "string | object", 'A source name, 2–120 characters, or { "customerId": "EXISTING_REFERRER_CUSTOMER_ID" }.'],
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
  ["400", "INVALID_INPUT", "One or more fields are invalid. Check the issues array for field details."],
  ["401", "UNAUTHORIZED", "The bearer API key is missing or incorrect."],
  ["415", "INVALID_CONTENT_TYPE", "Send Content-Type: application/json."],
  ["422", "INVALID_AGENT", "The assigned user does not exist or is not eligible for sales assignment."],
  ["422", "INVALID_REFERRER", "The supplied person’s referrer account was not found."],
  ["503", "API_NOT_CONFIGURED", "The site administrator needs to configure the API key."],
  ["503", "ASSIGNMENT_NOT_CONFIGURED", "The site administrator needs to enable assignment storage."],
  ["500", "INTERNAL_ERROR", "The lead could not be created. Database details are not returned."],
];

const sections = [
  ["authentication", "Authentication"], ["request", "Example request"], ["introducers", "Introducers & agents"],
  ["fields", "Request fields"], ["response", "Success response"], ["errors", "Errors"],
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
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Create a lead. Keep its source.</h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600 sm:text-base">
          Send leads from Google Ads, Facebook Ads, another source, or an existing referrer.
          Assign each lead to a sales agent independently of who introduced it.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl bg-slate-100 p-4">
          <span className="rounded-md bg-teal-800 px-3 py-1 text-xs font-bold text-white">POST</span>
          <code className="break-all text-sm font-semibold">https://referral.atap.solar/api/leads</code>
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
          <section id="authentication" className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <h2 className="text-xl font-bold">Authentication</h2>
            <p className="mt-3 text-sm leading-7 text-slate-700">Obtain an API key from the site administrator and include it in every request. Login cookies are not required.</p>
            <CodeBlock label="Required headers">{"Authorization: Bearer YOUR_API_KEY\nContent-Type: application/json"}</CodeBlock>
            <p className="mt-4 text-sm leading-7 text-slate-700">Keep the key on your server or in your automation platform’s secret storage. Send lead creation requests from that server or platform.</p>
          </section>

          <section id="request" className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <h2 className="text-xl font-bold">Example request</h2>
            <p className="mt-3 text-sm leading-7 text-slate-700">Set your API key in the <code>LEADS_API_KEY</code> environment variable, then replace <code>USER_BUBBLE_ID</code> with the assigned sales user’s ID.</p>
            <CodeBlock label="cURL · Google Ads lead assigned to an agent">{requestExample}</CodeBlock>
          </section>

          <section id="introducers" className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <h2 className="text-xl font-bold">Introducers &amp; agents</h2>
            <h3 className="mt-4 font-semibold">Advertising or another source</h3>
            <p className="mt-2 text-sm leading-7 text-slate-700">Use a source name as the referrer. Google Ads and Facebook Ads are displayed consistently; case and repeated spaces do not create a different source. Other source names are accepted too.</p>
            <CodeBlock label="Facebook Ads">{'"referrer": "Facebook Ads"'}</CodeBlock>
            <h3 className="mt-5 font-semibold">An existing person</h3>
            <p className="mt-2 text-sm leading-7 text-slate-700">Supply the customer ID of an existing referral account. This request does not create a person’s referrer account.</p>
            <CodeBlock label="Existing referrer account">{'"referrer": { "customerId": "EXISTING_REFERRER_CUSTOMER_ID" }'}</CodeBlock>
            <h3 className="mt-5 font-semibold">Independent agent assignment</h3>
            <p className="mt-2 text-sm leading-7 text-slate-700">Use the sales user’s Bubble ID or numeric user ID in <code>assignedAgentId</code>. The response returns the Bubble ID. Omit the field to create an unassigned lead. This sets the assigned agent; it leaves the separate preferred agent empty.</p>
          </section>

          <section id="fields" className="scroll-mt-6 min-w-0 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <h2 className="text-xl font-bold">Request fields</h2>
            <p className="mt-3 text-sm leading-7 text-slate-700">Send a JSON object. Unknown fields are rejected; optional text fields default to empty strings.</p>
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
            <CodeBlock label="Example · 422 Unprocessable Content">{JSON.stringify({ error: "Assigned agent was not found or is not in sales.", code: "INVALID_AGENT" }, null, 2)}</CodeBlock>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[550px] text-left text-sm">
                <caption className="sr-only">HTTP statuses and API error codes</caption>
                <thead className="border-b-2 border-slate-200 text-slate-500"><tr><th scope="col" className="py-3 pr-3">Status</th><th scope="col" className="px-3 py-3">Code</th><th scope="col" className="px-3 py-3">Meaning</th></tr></thead>
                <tbody>{errors.map(([status, code, meaning]) => <tr key={code} className="border-b border-slate-100 align-top"><td className="py-3 pr-3 font-mono">{status}</td><th scope="row" className="px-3 py-3 font-mono text-xs font-medium text-teal-800">{code}</th><td className="px-3 py-3 leading-6 text-slate-700">{meaning}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

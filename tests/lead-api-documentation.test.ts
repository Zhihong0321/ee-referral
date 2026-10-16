import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import { GET as getGuide } from "../src/app/api-docs/agent-guide/route.ts";
import { GET as getOpenApi } from "../src/app/api-docs/openapi.json/route.ts";
import {
  createLeadApiHandler, createListAgentsApiHandler, createListLeadsApiHandler, createListSourcesApiHandler,
  leadApiInputSchema, listLeadsQuerySchema, type CreatedApiLead,
} from "../src/lib/lead-api.ts";
import {
  agentExample, assignedLeadExample, createdLeadExample, leadApiAgentGuide, leadListExample,
  minimalLeadExample, paginationExample, sourceExamples,
} from "../src/lib/lead-api-documentation.ts";
import { leadApiOpenApi } from "../src/lib/lead-api-openapi.ts";

function contractValidator(schema: unknown) {
  // Resolve component refs as JSON Schema defs; check the published schema,
  // not a separately maintained validation schema.
  return z.fromJSONSchema(JSON.parse(JSON.stringify({
    ...(schema as object), $defs: leadApiOpenApi.components.schemas,
  }).replaceAll("#/components/schemas/", "#/$defs/")));
}

test("public docs expose Markdown and valid referenced JSON schemas without credentials", async () => {
  const guide = getGuide();
  assert.equal(guide.status, 200);
  assert.match(guide.headers.get("content-type") || "", /text\/markdown/);
  assert.equal(await guide.text(), leadApiAgentGuide);
  const response = getOpenApi();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  assert.deepEqual(await response.json(), leadApiOpenApi);
  for (const schema of Object.values(leadApiOpenApi.components.schemas)) contractValidator(schema);
  const operations = Object.values(leadApiOpenApi.paths).flatMap((path) => Object.values(path));
  assert.equal(new Set(operations.map((operation) => operation.operationId)).size, 4);
  assert.equal(leadApiOpenApi.components.securitySchemes.LeadApiKey.scheme, "bearer");
});

test("documented creation examples satisfy the handler and published request contract", () => {
  const schema = leadApiOpenApi.components.schemas.CreateLeadInput;
  const validator = contractValidator(schema);
  for (const input of [minimalLeadExample, assignedLeadExample, { ...minimalLeadExample, assignedAgentId: 42 }, { ...minimalLeadExample, referrer: { customerId: "person_1" } }]) {
    assert.ok(leadApiInputSchema.safeParse(input).success);
    assert.ok(validator.safeParse(input).success);
  }
  for (const input of [
    { ...minimalLeadExample, assignedAgentId: null }, { ...minimalLeadExample, assignedAgentId: "" },
    { ...minimalLeadExample, assignedAgentId: 0 }, { ...minimalLeadExample, assignedAgentId: 9007199254740992 },
    { ...minimalLeadExample, leadName: "x" }, { ...minimalLeadExample, relationship: "Unknown" },
    { ...minimalLeadExample, projectType: "Unknown" }, { ...minimalLeadExample, introducer: "Meta Ads Leon" },
    { ...minimalLeadExample, referrer: { customerId: "person_1", unexpected: true } },
  ]) {
    assert.equal(leadApiInputSchema.safeParse(input).success, false);
    assert.equal(validator.safeParse(input).success, false);
  }
  const parameters = leadApiOpenApi.paths["/api/leads"].get.parameters;
  for (const name of ["limit", "offset"] as const) {
    const parameter = parameters.find((parameter) => parameter.name === name)!;
    const paramValidator = contractValidator(parameter.schema);
    for (const value of [0, 1, 100, 500, 501, -1, 1.5, 2147483647, 2147483648]) {
      assert.equal(paramValidator.safeParse(value).success, listLeadsQuerySchema.safeParse({ [name]: String(value) }).success);
    }
  }
});

test("actual success and error handler responses satisfy the published OpenAPI schemas", async () => {
  const key = { getApiKey: () => "documentation-test" };
  const get = (path: string) => new Request(`https://example.test${path}`, { headers: { Authorization: "Bearer documentation-test" } });
  const sourceHandler = createListSourcesApiHandler({ ...key, listSources: async () => sourceExamples });
  const agentHandler = createListAgentsApiHandler({ ...key, listAgents: async () => [agentExample] });
  const leadsHandler = createListLeadsApiHandler({ ...key, listLeads: async () => leadListExample });
  const createHandler = createLeadApiHandler({ ...key, createLead: async () => createdLeadExample as CreatedApiLead });
  const paths = leadApiOpenApi.paths;
  for (const [response, schema] of [
    [await sourceHandler(get("/api/leads/sources")), paths["/api/leads/sources"].get.responses["200"].content["application/json"].schema],
    [await agentHandler(get("/api/leads/agents")), paths["/api/leads/agents"].get.responses["200"].content["application/json"].schema],
    [await leadsHandler(get("/api/leads?referrer=Meta%20Ads%20Leon")), paths["/api/leads"].get.responses["200"].content["application/json"].schema],
    [await leadsHandler(new Request("https://example.test/api/leads")), paths["/api/leads"].get.responses["401"].content["application/json"].schema],
    [await leadsHandler(get("/api/leads?limit=0")), paths["/api/leads"].get.responses["400"].content["application/json"].schema],
    [await createHandler(new Request("https://example.test/api/leads", { method: "POST", headers: { Authorization: "Bearer documentation-test", "Content-Type": "application/json" }, body: JSON.stringify(assignedLeadExample) })), paths["/api/leads"].post.responses["201"].content["application/json"].schema],
  ] as const) {
    assert.ok(contractValidator(schema).safeParse(await response.json()).success);
  }
  const listed = contractValidator(leadApiOpenApi.components.schemas.ListedLead);
  assert.ok(listed.safeParse({ ...leadListExample.leads[0], status: "Legacy Custom Status", assignedAgentId: null, leadCustomerId: null, leadMobileNumber: null, createdAt: null }).success);
});

test("published read-only Node.js example runs, authenticates and paginates without writes", async () => {
  const urls: URL[] = [];
  const logs: unknown[] = [];
  const fetchExample = async (url: URL, options: RequestInit) => {
    urls.push(url);
    assert.equal(options.headers && (options.headers as Record<string, string>).Authorization, "Bearer example-key");
    assert.equal(options.method, undefined);
    if (url.pathname === "/api/leads/sources") return Response.json({ sources: sourceExamples });
    if (url.pathname === "/api/leads/agents") return Response.json({ agents: [agentExample] });
    assert.equal(url.pathname, "/api/leads");
    assert.equal(url.searchParams.get("referrer"), "Meta Ads Leon");
    assert.equal(url.searchParams.get("limit"), "100");
    const offset = Number(url.searchParams.get("offset"));
    assert.ok(offset === 0 || offset === 100);
    return Response.json({ leads: offset === 0 ? [{ referralId: 3 }, { referralId: 2 }] : [{ referralId: 2 }, { referralId: 1 }], pagination: { limit: 100, offset, total: 3, hasMore: offset === 0 } });
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction("process", "fetch", "console", paginationExample);
  await run({ env: { LEADS_API_KEY: "example-key", LEADS_API_BASE_URL: "https://example.test" } }, fetchExample, { log: (value: unknown) => logs.push(value) });
  assert.deepEqual(logs.at(-1), { count: 3 });
  assert.equal(urls.length, 4);
  assert.ok(urls.every((url) => url.origin === "https://example.test"));
  await assert.rejects(run({ env: {} }, fetchExample, { log() {} }), /Set LEADS_API_KEY/);
  await assert.rejects(run({ env: { LEADS_API_KEY: "wrong" } }, async () => Response.json({ code: "UNAUTHORIZED", error: "Invalid API key." }, { status: 401 }), { log() {} }), /HTTP 401: UNAUTHORIZED/);
});

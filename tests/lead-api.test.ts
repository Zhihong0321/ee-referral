import assert from "node:assert/strict";
import test from "node:test";

import {
  createLeadApiHandler,
  createListAgentsApiHandler,
  createListLeadsApiHandler,
  createListSourcesApiHandler,
  LeadApiError,
  leadApiInputSchema,
  leadSourceCustomerId,
  type ApiAgentOption,
  type ApiLeadSource,
  type ApiLeadList,
  type CreatedApiLead,
} from "../src/lib/lead-api.ts";

const validLead = { leadName: "Ali Ahmad", leadMobileNumber: "012-345 6789", referrer: " google   ads ", assignedAgentId: 42 };
const created: CreatedApiLead = {
  referralId: 12, leadCustomerId: "cust_test", leadName: "Ali Ahmad", leadMobileNumber: "60123456789",
  referrer: { customerId: "src_test", name: "Google Ads", type: "source" }, assignedAgentId: "user_agent", status: "Assigned",
};
const dummyAgents: ApiAgentOption[] = [
  { id: "agent_42", name: "Agent A", bubbleId: "agent_42", numericId: 42, accessLevels: ["Sales"] },
];
const dummySources: ApiLeadSource[] = [
  { id: "src_meta_leon", name: "Meta Ads Leon", type: "ads" },
  { id: "src_google_gan", name: "Google Ads Gan", type: "ads" },
];

function request(body: unknown = validLead, token = "test-key", contentType = "application/json") {
  return new Request("http://localhost/api/leads", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType }, body: JSON.stringify(body),
  });
}

function getAgentsRequest(token = "test-key") {
  return new Request("http://localhost/api/leads/agents", {
    method: "GET", headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

function getSourcesRequest(token = "test-key") {
  return new Request("http://localhost/api/leads/sources", {
    method: "GET", headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

test("lead API canonicalizes advertising sources and Malaysian phones independently of assignment", () => {
  const lead = leadApiInputSchema.parse(validLead);
  assert.equal(lead.referrer, "Google Ads");
  assert.equal(lead.leadMobileNumber, "60123456789");
  assert.equal(lead.assignedAgentId, "42");
  assert.equal(leadApiInputSchema.parse({ ...validLead, referrer: "FACEBOOK Ads" }).referrer, "Facebook Ads");
  assert.equal(leadApiInputSchema.parse({ ...validLead, referrer: " meta ads   leon " }).referrer, "Meta Ads Leon");
  assert.equal(leadApiInputSchema.parse({ ...validLead, referrer: "GOOGLE ADS GAN" }).referrer, "Google Ads Gan");
  assert.equal(leadSourceCustomerId(" Google   Ads "), leadSourceCustomerId("google ads"));
  assert.notEqual(leadSourceCustomerId("Google Ads"), leadSourceCustomerId("Facebook Ads"));
});

test("lead API supports existing people and unassigned leads", () => {
  const lead = leadApiInputSchema.parse({ ...validLead, referrer: { customerId: "cust_person" }, assignedAgentId: undefined });
  assert.deepEqual(lead.referrer, { customerId: "cust_person" });
  assert.equal(lead.assignedAgentId, undefined);
  assert.equal(lead.relationship, "Other");
  assert.equal(lead.projectType, "OTHERS");
});

test("lead API rejects malformed fields and unknown payload keys", () => {
  for (const change of [
    { leadName: " " }, { leadMobileNumber: "abc0123456789" }, { leadMobileNumber: "123" },
    { referrer: " " }, { referrer: {} }, { assignedAgentId: "not an ID" }, { assignedAgentId: 0 },
    { assignedAgentId: Number.MAX_SAFE_INTEGER + 1 }, { relationship: "invalid" }, { remark: "x".repeat(501) },
    { assigned_agent: "agent_1" },
  ]) assert.equal(leadApiInputSchema.safeParse({ ...validLead, ...change }).success, false, JSON.stringify(change));
});

test("lead API fails closed before calling persistence when authentication is unavailable or invalid", async () => {
  let calls = 0;
  const createLead = async () => { calls++; return created; };
  const disabled = createLeadApiHandler({ getApiKey: () => undefined, createLead });
  assert.equal((await disabled(request())).status, 503);
  const enabled = createLeadApiHandler({ getApiKey: () => "test-key", createLead });
  assert.equal((await enabled(request(validLead, "wrong-key"))).status, 401);
  assert.equal((await enabled(new Request("http://localhost/api/leads", { method: "POST" }))).status, 401);
  assert.equal(calls, 0);
});

test("lead API rejects invalid JSON, content type, and payload without persistence", async () => {
  let calls = 0;
  const handler = createLeadApiHandler({ getApiKey: () => "test-key", createLead: async () => { calls++; return created; } });
  assert.equal((await handler(request(validLead, "test-key", "text/plain"))).status, 415);
  assert.equal((await handler(request({}))).status, 400);
  const malformed = new Request("http://localhost/api/leads", {
    method: "POST",
    headers: { Authorization: "Bearer test-key", "Content-Type": "application/json" },
    body: "{broken",
  });
  assert.equal((await handler(malformed)).status, 400);
  assert.equal(calls, 0);
});

test("lead API returns 201 with persisted IDs and assignment", async () => {
  const handler = createLeadApiHandler({ getApiKey: () => "test-key", createLead: async (lead) => {
    assert.equal(lead.referrer, "Google Ads");
    assert.equal(lead.leadMobileNumber, "60123456789");
    return created;
  } });
  const response = await handler(request());
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { lead: created });
});

test("lead API preserves actionable errors and hides database error details", async () => {
  const invalidAgent = createLeadApiHandler({ getApiKey: () => "test-key", createLead: async () => {
    throw new LeadApiError(422, "INVALID_AGENT", "Assigned agent was not found or is not in sales.");
  } });
  const response = await invalidAgent(request());
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, "INVALID_AGENT");
  const failed = createLeadApiHandler({ getApiKey: () => "test-key", createLead: async () => {
    throw new Error("private database connection details");
  } });
  const failure = await failed(request());
  assert.equal(failure.status, 500);
  assert.doesNotMatch(await failure.text(), /private database/);
});

test("list agents API requires authentication and returns available sales agents", async () => {
  let calls = 0;
  const listAgents = async () => { calls++; return dummyAgents; };

  const disabled = createListAgentsApiHandler({ getApiKey: () => undefined, listAgents });
  assert.equal((await disabled(getAgentsRequest())).status, 503);

  const enabled = createListAgentsApiHandler({ getApiKey: () => "test-key", listAgents });
  assert.equal((await enabled(getAgentsRequest("wrong-key"))).status, 401);
  assert.equal((await enabled(getAgentsRequest(""))).status, 401);

  const response = await enabled(getAgentsRequest("test-key"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { agents: dummyAgents });
  assert.equal(calls, 1);

  const failed = createListAgentsApiHandler({ getApiKey: () => "test-key", listAgents: async () => {
    throw new Error("db failure");
  } });
  const failure = await failed(getAgentsRequest("test-key"));
  assert.equal(failure.status, 500);
  assert.doesNotMatch(await failure.text(), /db failure/);
});

test("list sources API requires authentication and returns available ads and sources", async () => {
  let calls = 0;
  const listSources = async () => { calls++; return dummySources; };

  const disabled = createListSourcesApiHandler({ getApiKey: () => undefined, listSources });
  assert.equal((await disabled(getSourcesRequest())).status, 503);

  const enabled = createListSourcesApiHandler({ getApiKey: () => "test-key", listSources });
  assert.equal((await enabled(getSourcesRequest("wrong-key"))).status, 401);
  assert.equal((await enabled(getSourcesRequest(""))).status, 401);

  const response = await enabled(getSourcesRequest("test-key"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    sources: dummySources,
    ads: dummySources,
  });
  assert.equal(calls, 1);

  const failed = createListSourcesApiHandler({ getApiKey: () => "test-key", listSources: async () => {
    throw new Error("db failure");
  } });
  const failure = await failed(getSourcesRequest("test-key"));
  assert.equal(failure.status, 500);
  assert.doesNotMatch(await failure.text(), /db failure/);
});

test("list leads API authenticates before querying and validates source filters and pagination", async () => {
  let calls = 0;
  const listLeads = async (): Promise<ApiLeadList> => {
    calls++;
    return { leads: [], pagination: { total: 0, limit: 100, offset: 0, hasMore: false } };
  };
  const get = (query = "", token = "test-key") => new Request(`http://localhost/api/leads${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const disabled = createListLeadsApiHandler({ getApiKey: () => undefined, listLeads });
  assert.equal((await disabled(get())).status, 503);
  const handler = createListLeadsApiHandler({ getApiKey: () => "test-key", listLeads });
  assert.equal((await handler(get("", ""))).status, 401);
  assert.equal((await handler(get("", "wrong-key"))).status, 401);
  for (const query of [
    "?referrer=", "?referrer=x", `?referrer=${"x".repeat(121)}`,
    "?limit=0", "?limit=501", "?limit=1.5", "?limit=abc", "?limit=",
    "?offset=-1", "?offset=1.5", "?offset=2147483648",
    "?referrer=Meta%20Ads%20Leon&referrer=Google%20Ads%20Gan", "?limit=1&limit=2", "?source=Google%20Ads",
  ]) {
    const response = await handler(get(query));
    assert.equal(response.status, 400, query);
    assert.equal((await response.json()).code, "INVALID_INPUT");
  }
  assert.equal(calls, 0);

  const filtered = createListLeadsApiHandler({ getApiKey: () => "test-key", listLeads: async (query) => {
    assert.deepEqual(query, { referrer: "Meta Ads Leon", limit: 25, offset: 50 });
    return listLeads();
  } });
  const response = await filtered(get("?referrer=%20meta%20ads%20%20leon%20&limit=25&offset=50"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), await listLeads());
  const defaults = createListLeadsApiHandler({ getApiKey: () => "test-key", listLeads: async (query) => {
    assert.deepEqual(query, { limit: 100, offset: 0 });
    return listLeads();
  } });
  assert.equal((await defaults(get())).status, 200);
});

test("list leads API preserves domain errors and hides database failures", async () => {
  const request = new Request("http://localhost/api/leads?referrer=Google%20Ads", {
    headers: { Authorization: "Bearer test-key" },
  });
  for (const [error, status, code] of [
    [new LeadApiError(400, "INVALID_INPUT", "Invalid lead query."), 400, "INVALID_INPUT"],
    [new Error("private database details"), 500, "INTERNAL_ERROR"],
  ] as const) {
    const handler = createListLeadsApiHandler({ getApiKey: () => "test-key", listLeads: async () => { throw error; } });
    const response = await handler(request);
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.code, code);
    assert.doesNotMatch(JSON.stringify(body), /private database/);
  }
});

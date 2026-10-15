import assert from "node:assert/strict";
import test from "node:test";

import { createLeadApiHandler, LeadApiError, leadApiInputSchema, leadSourceCustomerId, type CreatedApiLead } from "../src/lib/lead-api.ts";

const validLead = { leadName: "Ali Ahmad", leadMobileNumber: "012-345 6789", referrer: " google   ads ", assignedAgentId: 42 };
const created: CreatedApiLead = {
  referralId: 12, leadCustomerId: "cust_test", leadName: "Ali Ahmad", leadMobileNumber: "60123456789",
  referrer: { customerId: "src_test", name: "Google Ads", type: "source" }, assignedAgentId: "user_agent", status: "Assigned",
};

function request(body: unknown = validLead, token = "test-key", contentType = "application/json") {
  return new Request("http://localhost/api/leads", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType }, body: JSON.stringify(body),
  });
}

test("lead API canonicalizes advertising sources and Malaysian phones independently of assignment", () => {
  const lead = leadApiInputSchema.parse(validLead);
  assert.equal(lead.referrer, "Google Ads");
  assert.equal(lead.leadMobileNumber, "60123456789");
  assert.equal(lead.assignedAgentId, "42");
  assert.equal(leadApiInputSchema.parse({ ...validLead, referrer: "FACEBOOK Ads" }).referrer, "Facebook Ads");
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
    method: "POST", headers: { Authorization: "Bearer test-key", "Content-Type": "application/json" }, body: "{broken",
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

import assert from "node:assert/strict";
import test from "node:test";

import {
  extractAssignmentText,
  isCancelMessage,
  isSkipMessage,
  matchAgentName,
  parseExplicitLeadUpdate,
  parseLeadCandidate,
} from "../src/lib/agent/whatsapp-intent.ts";

test("parses referral details extracted from an image", () => {
  assert.deepEqual(
    parseLeadCandidate(
      "[System: User sent an image. Extracted content:]\nLead name: Blackpepper Studio | Lead phone: 017-260 4102 | Area: Taman Sungai Besi, Kuala Lumpur | Notes: Photography studio",
    ),
    {
      leadName: "Blackpepper Studio",
      leadMobileNumber: "017-260 4102",
      area: "Taman Sungai Besi, Kuala Lumpur",
      preferredAgentText: "",
      source: "structured_media",
    },
  );
});

test("parses an explicit text lead without requiring an AI decision", () => {
  const parsed = parseLeadCandidate("please add 0123334444 name Kumar from Ipoh");
  assert.equal(parsed?.leadMobileNumber, "0123334444");
  assert.equal(parsed?.leadName, "Kumar");
  assert.equal(parsed?.area, "Ipoh");
});

test("parses a WhatsApp contact card", () => {
  assert.deepEqual(
    parseLeadCandidate(
      "WhatsApp contact card received:\n1. Kumar — +60 12-333 4444\nTreat the contact card as lead details if it contains a phone number.",
    ),
    {
      leadName: "Kumar",
      leadMobileNumber: "+60 12-333 4444",
      area: "",
      preferredAgentText: "",
      source: "structured_media",
    },
  );
});

test("does not mistake a status lookup for a new lead", () => {
  assert.equal(parseLeadCandidate("do I already have 0123334444?"), null);
});

test("accepts a bare phone or phone plus short name as a lead", () => {
  assert.equal(parseLeadCandidate("0123334444")?.leadMobileNumber, "0123334444");
  assert.equal(parseLeadCandidate("0123334444 Kumar")?.leadName, "Kumar");
});

test("accepts phone plus direct assignment as a new lead", () => {
  const parsed = parseLeadCandidate("0182220099 pass to Zhi Hong");
  assert.equal(parsed?.leadMobileNumber, "0182220099");
  assert.equal(parsed?.preferredAgentText, "Zhi Hong");
});

test("extracts preferred-agent language", () => {
  assert.equal(extractAssignmentText("Pass to Zhi Hong"), "Zhi Hong");
  assert.equal(extractAssignmentText("let Zhi Hong handle it"), "Zhi Hong");
  assert.equal(extractAssignmentText("preferred agent: Zhi Hong"), "Zhi Hong");
});

test("matches a short agent name to the configured full name", () => {
  const result = matchAgentName("Zhi Hong", [
    { id: "1", name: "GAN ZHI HONG" },
    { id: "2", name: "GAN LAI HOCK" },
  ]);
  assert.equal(result.status, "matched");
  assert.equal(result.matches[0]?.name, "GAN ZHI HONG");
});

test("recognizes skip and cancellation messages", () => {
  assert.equal(isSkipMessage("skip"), true);
  assert.equal(isSkipMessage("no preferred agent"), true);
  assert.equal(isCancelMessage("sent wrong, cancel"), true);
});

test("parses explicit numbered updates", () => {
  assert.deepEqual(parseExplicitLeadUpdate("update lead 2 name to Ali"), {
    leadNumber: 2,
    field: "name",
    value: "Ali",
  });
  assert.deepEqual(parseExplicitLeadUpdate("assign lead 1 agent to Zhi Hong"), {
    leadNumber: 1,
    field: "agent",
    value: "Zhi Hong",
  });
});

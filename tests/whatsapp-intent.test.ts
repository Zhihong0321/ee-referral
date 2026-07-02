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
      remark: "Photography studio",
      source: "structured_media",
    },
  );
});

test("ignores OCR placeholders for a missing preferred agent", () => {
  const parsed = parseLeadCandidate(
    "[System: User sent an image. Extracted content:]\nLead name: Iconbag KL | Lead phone: 018-963 8220 | Area: Sungai Besi | Preferred agent: None visible | Notes: manufacturer",
  );
  assert.equal(parsed?.preferredAgentText, "");
  assert.equal(parsed?.leadMobileNumber, "018-963 8220");
  assert.equal(parsed?.remark, "manufacturer");
});

test("ignores an OCR placeholder for missing notes", () => {
  const parsed = parseLeadCandidate(
    "[System: User sent an image. Extracted content:]\nLead name: Iconbag KL | Lead phone: 018-963 8220 | Notes: None visible",
  );
  assert.equal(parsed?.remark, "");
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
      remark: "",
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
  for (const input of ["Zhi Hong", "Zhihong", "Zhi-Hong"]) {
    const result = matchAgentName(input, [
      { id: "1", name: "GAN ZHI HONG" },
      { id: "2", name: "GAN LAI HOCK" },
    ]);
    assert.equal(result.status, "matched", input);
    assert.equal(result.matches[0]?.name, "GAN ZHI HONG", input);
  }
});

test("exact token match beats prefix match instead of tying into ambiguity", () => {
  const result = matchAgentName("ali", [
    { id: "1", name: "ALI HASSAN" },
    { id: "2", name: "ALIA WONG" },
  ]);
  assert.equal(result.status, "matched");
  assert.equal(result.matches[0]?.name, "ALI HASSAN");
});

test("rejects fragments that are too short to trust", () => {
  const result = matchAgentName("al", [
    { id: "1", name: "ALI HASSAN" },
    { id: "2", name: "ALIA WONG" },
  ]);
  assert.equal(result.status, "none");
});

test("same-score candidates stay ambiguous so the agent must ask", () => {
  const result = matchAgentName("gan", [
    { id: "1", name: "GAN ZHI HONG" },
    { id: "2", name: "GAN LAI HOCK" },
  ]);
  assert.equal(result.status, "ambiguous");
  assert.equal(result.matches.length, 2);
});

test("finds the agent when the full name is buried in a longer sentence", () => {
  const result = matchAgentName("please let zhi hong follow up", [
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

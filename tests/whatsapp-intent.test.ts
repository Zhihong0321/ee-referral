import assert from "node:assert/strict";
import test from "node:test";

import {
  extractAssignmentText,
  isCancelMessage,
  isSkipMessage,
  matchAgentName,
  parseExplicitLeadUpdate,
  parseLeadCandidate,
  isAdminModeTrigger,
  isAdminModeExit,
  parseAdminReferrerQuery,
  parseAdminReferrerSelection,
  parseAdminLeadCandidate,
  isCreateReferrerCommand,
  isSearchMyReferralsCommand,
  isSearchReferrerCommand,
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

test("ignores OCR placeholders for a missing preferred agent", () => {
  const parsed = parseLeadCandidate(
    "[System: User sent an image. Extracted content:]\nLead name: Iconbag KL | Lead phone: 018-963 8220 | Area: Sungai Besi | Preferred agent: None visible | Notes: manufacturer",
  );
  assert.equal(parsed?.preferredAgentText, "");
  assert.equal(parsed?.leadMobileNumber, "018-963 8220");
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
  for (const input of ["Zhi Hong", "Zhihong", "Zhi-Hong"]) {
    const result = matchAgentName(input, [
      { id: "1", name: "GAN ZHI HONG" },
      { id: "2", name: "GAN LAI HOCK" },
    ]);
    assert.equal(result.status, "matched", input);
    assert.equal(result.matches[0]?.name, "GAN ZHI HONG", input);
  }
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

test("admin mode trigger and exit", () => {
  assert.equal(isAdminModeTrigger("ee-admin"), true);
  assert.equal(isAdminModeTrigger(" ee-admin "), true);
  assert.equal(isAdminModeTrigger("admin"), false);
  
  assert.equal(isAdminModeExit("exit"), true);
  assert.equal(isAdminModeExit("done"), true);
  assert.equal(isAdminModeExit("quit"), true);
  assert.equal(isAdminModeExit("leave"), true);
  assert.equal(isAdminModeExit("stop"), false);
});

test("admin referrer query parsing", () => {
  assert.deepEqual(parseAdminReferrerQuery("search referrer 012345678"), { phone: "6012345678" });
  assert.deepEqual(parseAdminReferrerQuery("6012345678"), { phone: "6012345678" });
  assert.equal(parseAdminReferrerQuery("abc"), null);
});

test("admin referrer selection", () => {
  assert.equal(parseAdminReferrerSelection("1"), 1);
  assert.equal(parseAdminReferrerSelection(" 2 "), 2);
  assert.equal(parseAdminReferrerSelection("abc"), null);
});

test("admin lead candidate with inline referrer phone", () => {
  const parsed = parseAdminLeadCandidate("0123334444 for 0198887777");
  assert.equal(parsed?.leadMobileNumber, "0123334444");
  assert.equal(parsed?.referrerPhone, "60198887777");
  
  const parsed2 = parseAdminLeadCandidate("0123334444 under referrer 60198887777");
  assert.equal(parsed2?.leadMobileNumber, "0123334444");
  assert.equal(parsed2?.referrerPhone, "60198887777");
  
  const parsed3 = parseAdminLeadCandidate("0123334444");
  assert.equal(parsed3?.leadMobileNumber, "0123334444");
  assert.equal(parsed3?.referrerPhone, "");
});

test("admin commands detection", () => {
  assert.equal(isCreateReferrerCommand("create referrer"), true);
  assert.equal(isCreateReferrerCommand("new Ali"), true);
  assert.equal(isCreateReferrerCommand("add Kumar"), true);
  
  assert.equal(isSearchMyReferralsCommand("my leads"), true);
  assert.equal(isSearchMyReferralsCommand("show leads"), true);
  
  assert.equal(isSearchReferrerCommand("search referrer"), true);
  assert.equal(isSearchReferrerCommand("find referrer"), true);
  assert.equal(isSearchReferrerCommand("lookup referrer 0123"), true);
});

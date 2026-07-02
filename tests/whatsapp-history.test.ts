import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanMessages,
  distillHistoryTurnText,
  formatAgentTimestamp,
  formatLeadStateLines,
} from "../src/lib/agent/whatsapp-history.ts";

test("distills an image-extraction turn instead of dropping it", () => {
  const distilled = distillHistoryTurnText(
    "[System: User sent an image. Extracted content:]\nLead name: Ali | Lead phone: 017-778 8899 | Area: Penang",
  );
  assert.match(distilled, /^\(sent an image\)/);
  assert.match(distilled, /Lead name: Ali/);
  assert.match(distilled, /017-778 8899/);
  assert.doesNotMatch(distilled, /\[System:/);
});

test("admin mode redacts reusable lead fields from a past image turn", () => {
  const distilled = distillHistoryTurnText(
    "[System: User sent an image. Extracted content:]\nLead name: Zhi hong | Lead phone: 011-3325 0855 | Area: Bukit Changgang",
    { redactLeadFields: true },
  );
  assert.doesNotMatch(distilled, /011-3325 0855/);
  assert.doesNotMatch(distilled, /Zhi hong/);
  assert.match(distilled, /PENDING LEAD DATA/);
});

test("admin mode redacts a past contact card but leaves other history alone", () => {
  const distilled = distillHistoryTurnText(
    "WhatsApp contact card received:\n1. Kumar — +60 12-333 4444\nTreat the contact card as lead details if it contains a phone number.",
    { redactLeadFields: true },
  );
  assert.doesNotMatch(distilled, /\+60 12-333 4444/);
  assert.equal(distillHistoryTurnText("assign Ali to lead 1", { redactLeadFields: true }), "assign Ali to lead 1");
});

test("without redactLeadFields, admin history still surfaces lead details as before", () => {
  const distilled = distillHistoryTurnText(
    "[System: User sent an image. Extracted content:]\nLead name: Ali | Lead phone: 017-778 8899",
  );
  assert.match(distilled, /017-778 8899/);
});

test("distills a voice transcript turn and keeps the transcript", () => {
  const distilled = distillHistoryTurnText(
    "[System: User sent a voice note. Transcript:]\nplease add lead Kumar 0123334444",
  );
  assert.match(distilled, /^\(sent a voice note\)/);
  assert.match(distilled, /Kumar 0123334444/);
});

test("collapses unreadable-media turns and strips bot instructions", () => {
  const distilled = distillHistoryTurnText(
    "[System: User sent a voice note. Transcription failed: timeout.]\n" +
      "Instruct the AI Agent to reply exactly with: '( Voice note failed to read ), can you write in text?'",
  );
  assert.equal(distilled, "(sent media that could not be read)");
});

test("leaves plain text turns untouched", () => {
  assert.equal(distillHistoryTurnText("assign Ali to lead 1"), "assign Ali to lead 1");
});

test("a conversation that started with an image lead keeps both turns in history", () => {
  const history = [
    {
      role: "user" as const,
      text: "[System: User sent an image. Extracted content:]\nLead name: Ali | Lead phone: 0177788899",
    },
    { role: "assistant" as const, text: "Lead: Ali\nReferrer: Ahmad\nAgent: none" },
  ];

  const messages = cleanMessages(history, "assign Ali to handle it");

  // Previously: the [System: turn was filtered, the confirmation became a
  // leading assistant turn and was dropped too -> the model got zero history.
  assert.equal(messages.length, 3);
  assert.equal(messages[0].role, "user");
  assert.match(String(messages[0].content), /Lead name: Ali/);
  assert.equal(messages[1].role, "assistant");
  assert.match(String(messages[1].content), /Referrer: Ahmad/);
  assert.equal(messages[2].content, "assign Ali to handle it");
});

test("formats a timestamp in Malaysia time with the zone name attached", () => {
  const formatted = formatAgentTimestamp("2026-07-02T08:20:00.000Z");
  assert.match(formatted, /2026/);
  assert.match(formatted, /Asia\/Kuala_Lumpur/);
});

test("history turns with a time are prefixed with a bracketed timestamp", () => {
  const history = [
    { role: "user" as const, text: "add 0123334444", time: "2026-06-30T01:12:00.000Z" },
  ];

  const messages = cleanMessages(history, "any update?");

  assert.match(String(messages[0].content), /^\[[^\]]+\] add 0123334444/);
});

test("history turns without a time are left unprefixed", () => {
  const history = [{ role: "user" as const, text: "hello" }];
  const messages = cleanMessages(history, "any update?");
  assert.doesNotMatch(String(messages[0].content), /^\[/);
});

test("still merges consecutive same-role turns and drops a leading assistant turn", () => {
  const history = [
    { role: "assistant" as const, text: "orphaned greeting" },
    { role: "user" as const, text: "hello" },
    { role: "user" as const, text: "anyone there?" },
  ];

  const messages = cleanMessages(history, "add 0123334444");

  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "user");
  assert.match(String(messages[0].content), /hello\nanyone there\?\nadd 0123334444/);
});

test("formats the numbered lead state block", () => {
  const lines = formatLeadStateLines([
    { leadName: "Ali", leadMobile: "60177788899", leadState: "Penang", leadCity: null, preferredAgentName: null, status: "Pending" },
    { leadName: null, leadMobile: "60161112222", leadState: null, leadCity: null, preferredAgentName: "GAN ZHI HONG", status: "Won" },
  ]);

  assert.equal(lines.length, 2);
  assert.match(lines[0], /^ {2}1\. Lead "Ali" — 60177788899 — Penang — sales agent: none — Pending$/);
  assert.match(lines[1], /2\. Lead "\(no name\)" — 60161112222 — sales agent: GAN ZHI HONG — Won/);
});

test("appends the remark to a lead line when present, omits it when absent", () => {
  const lines = formatLeadStateLines([
    { leadName: "Ali", leadMobile: "60177788899", leadState: "Penang", leadCity: null, preferredAgentName: null, status: "Pending", remark: "Call after 6pm" },
    { leadName: "Kumar", leadMobile: "60161112222", leadState: null, leadCity: null, preferredAgentName: null, status: "Pending", remark: null },
  ]);

  assert.match(lines[0], /remark: "Call after 6pm"$/);
  assert.doesNotMatch(lines[1], /remark:/);
});

test("caps the lead state block and says how many were hidden", () => {
  const many = Array.from({ length: 25 }, (_, i) => ({
    leadName: `L${i + 1}`,
    leadMobile: `60120000${String(i).padStart(3, "0")}`,
    leadState: null,
    leadCity: null,
    preferredAgentName: null,
    status: "Pending",
  }));

  const lines = formatLeadStateLines(many);
  assert.equal(lines.length, 21);
  assert.match(lines[20], /and 5 more/);
});

test("empty lead list renders a placeholder", () => {
  assert.deepEqual(formatLeadStateLines([]), ["  (no leads yet)"]);
});

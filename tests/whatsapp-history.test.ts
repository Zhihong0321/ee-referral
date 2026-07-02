import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanMessages,
  distillHistoryTurnText,
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

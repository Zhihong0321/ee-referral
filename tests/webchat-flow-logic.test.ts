import assert from "node:assert/strict";
import test from "node:test";

import {
  EDIT_FIELD_OPTIONS,
  GLOBAL_RESET_COMMANDS,
  buildAddConfirm,
  handleAddAgent,
  handleAddName,
  handleAddPhone,
  handleEditAgentPick,
  handleEditPickLead,
  handleEditValue,
  isNo,
  isPlausibleMalaysiaMobile,
  isSkip,
  isYes,
  parseMenuSelection,
  parseNumber,
} from "../src/lib/agent/webchat-flow-logic.ts";

function canonicalizeStub(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("60")) return digits;
  if (digits.startsWith("0")) return `60${digits.slice(1)}`;
  return digits;
}

test("parseMenuSelection maps digits and keywords to the three menu actions", () => {
  assert.equal(parseMenuSelection("1"), "add");
  assert.equal(parseMenuSelection("add lead"), "add");
  assert.equal(parseMenuSelection("2"), "edit");
  assert.equal(parseMenuSelection("edit"), "edit");
  assert.equal(parseMenuSelection("3"), "check");
  assert.equal(parseMenuSelection("check leads"), "check");
  assert.equal(parseMenuSelection("hi"), null);
  assert.equal(parseMenuSelection(""), null);
});

test("isSkip/isYes/isNo recognize the fixed keyword set only", () => {
  assert.equal(isSkip("skip"), true);
  assert.equal(isSkip(""), true);
  assert.equal(isSkip("no"), false);
  assert.equal(isYes("yes"), true);
  assert.equal(isYes("y"), true);
  assert.equal(isYes("confirm"), true);
  assert.equal(isYes("yeah"), false);
  assert.equal(isNo("no"), true);
  assert.equal(isNo("n"), true);
  assert.equal(isNo("nah"), false);
});

test("parseNumber only accepts plain digit strings", () => {
  assert.equal(parseNumber("5"), 5);
  assert.equal(parseNumber("01"), 1);
  assert.equal(parseNumber("abc"), null);
  assert.equal(parseNumber("-1"), null);
  assert.equal(parseNumber("1.5"), null);
  assert.equal(parseNumber(""), null);
});

test("isPlausibleMalaysiaMobile requires a canonical 60-prefixed number", () => {
  assert.equal(isPlausibleMalaysiaMobile("60123456789"), true);
  assert.equal(isPlausibleMalaysiaMobile("123"), false);
  assert.equal(isPlausibleMalaysiaMobile(""), false);
});

test("GLOBAL_RESET_COMMANDS covers menu/cancel/0 and nothing else", () => {
  assert.equal(GLOBAL_RESET_COMMANDS.has("menu"), true);
  assert.equal(GLOBAL_RESET_COMMANDS.has("cancel"), true);
  assert.equal(GLOBAL_RESET_COMMANDS.has("0"), true);
  assert.equal(GLOBAL_RESET_COMMANDS.has("hi"), false);
});

test("handleAddPhone rejects an invalid number and stays on add_phone", () => {
  const result = handleAddPhone("123", canonicalizeStub);
  assert.equal(result.nextState.step, "add_phone");
  assert.match(result.reply, /doesn't look like a valid phone number/);
});

test("handleAddPhone accepts a valid number and advances to add_name with the canonical value", () => {
  const result = handleAddPhone("012-3456789", canonicalizeStub);
  assert.equal(result.nextState.step, "add_name");
  assert.equal((result.nextState as { draft: { leadMobileNumber: string } }).draft.leadMobileNumber, "60123456789");
});

test("handleAddName treats 'skip' as an empty name and always advances to add_area", () => {
  const skipped = handleAddName({ step: "add_name", draft: { leadMobileNumber: "60123456789" } }, "skip", "skip");
  assert.equal(skipped.nextState.step, "add_area");
  assert.equal((skipped.nextState as { draft: { leadName: string } }).draft.leadName, "");

  const named = handleAddName({ step: "add_name", draft: { leadMobileNumber: "60123456789" } }, "Ali Bin Ahmad", "ali bin ahmad");
  assert.equal((named.nextState as { draft: { leadName: string } }).draft.leadName, "Ali Bin Ahmad");
});

test("handleAddAgent: skip clears the preferred agent and goes straight to confirm", () => {
  const state = {
    step: "add_agent" as const,
    draft: { leadMobileNumber: "60123456789", leadName: "Ali", area: "Penang" },
    agents: [{ id: "a1", name: "Agent One" }],
  };
  const result = handleAddAgent(state, "skip", "skip");
  assert.equal(result.nextState.step, "add_confirm");
  assert.equal((result.nextState as { draft: { preferredAgentId: string | null } }).draft.preferredAgentId, null);
});

test("handleAddAgent: an out-of-range number re-prompts without losing the agent list", () => {
  const state = {
    step: "add_agent" as const,
    draft: { leadMobileNumber: "60123456789", leadName: "Ali", area: "Penang" },
    agents: [{ id: "a1", name: "Agent One" }],
  };
  const result = handleAddAgent(state, "9", "9");
  assert.equal(result.nextState.step, "add_agent");
  assert.deepEqual((result.nextState as typeof state).agents, state.agents);
});

test("handleAddAgent: a valid pick carries the agent id/name into confirm", () => {
  const state = {
    step: "add_agent" as const,
    draft: { leadMobileNumber: "60123456789", leadName: "Ali", area: "Penang" },
    agents: [{ id: "a1", name: "Agent One" }, { id: "a2", name: "Agent Two" }],
  };
  const result = handleAddAgent(state, "2", "2");
  assert.equal(result.nextState.step, "add_confirm");
  assert.equal((result.nextState as { draft: { preferredAgentId: string | null } }).draft.preferredAgentId, "a2");
});

test("buildAddConfirm renders every collected field, defaulting missing ones to (none)", () => {
  const result = buildAddConfirm({
    leadMobileNumber: "60123456789",
    leadName: "",
    area: "",
    preferredAgentId: null,
    preferredAgentName: null,
  });
  assert.match(result.reply, /Name: \(none\)/);
  assert.match(result.reply, /Area: \(none\)/);
  assert.match(result.reply, /Preferred agent: \(none\)/);
});

test("handleEditPickLead rejects an out-of-range pick and keeps the same lead list", () => {
  const state = { step: "edit_pick_lead" as const, leads: [{ referralId: 1, label: "Ali" }] };
  const result = handleEditPickLead(state, "5");
  assert.equal(result.nextState.step, "edit_pick_lead");
});

test("handleEditPickLead on a valid pick shows every editable field", () => {
  const state = { step: "edit_pick_lead" as const, leads: [{ referralId: 42, label: "Ali" }] };
  const result = handleEditPickLead(state, "1");
  assert.equal(result.nextState.step, "edit_pick_field");
  assert.equal((result.nextState as { referralId: number }).referralId, 42);
  for (const opt of EDIT_FIELD_OPTIONS) {
    assert.match(result.reply, new RegExp(opt.label));
  }
});

test("handleEditValue rejects an invalid phone re-entry without leaving edit_value", () => {
  const state = { step: "edit_value" as const, referralId: 1, leadLabel: "Ali", field: "leadMobileNumber" as const };
  const result = handleEditValue(state, "123", "123", canonicalizeStub);
  assert.equal(result.nextState.step, "edit_value");
});

test("handleEditValue treats 'skip' on remark as clearing it", () => {
  const state = { step: "edit_value" as const, referralId: 1, leadLabel: "Ali", field: "remark" as const };
  const result = handleEditValue(state, "skip", "skip", canonicalizeStub);
  assert.equal(result.nextState.step, "edit_confirm");
  assert.equal((result.nextState as { value: string }).value, "");
});

test("handleEditAgentPick: skip clears the agent, a valid pick sets field to preferredAgent", () => {
  const state = {
    step: "edit_agent_pick" as const,
    referralId: 7,
    leadLabel: "Ali",
    agents: [{ id: "a1", name: "Agent One" }],
  };

  const cleared = handleEditAgentPick(state, "skip", "skip");
  assert.equal(cleared.nextState.step, "edit_confirm");
  assert.equal((cleared.nextState as { value: string }).value, "");

  const picked = handleEditAgentPick(state, "1", "1");
  assert.equal((picked.nextState as { field: string }).field, "preferredAgent");
  assert.equal((picked.nextState as { value: string }).value, "a1");
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_REMARK,
  maskSensitive,
  validateAddLeadSubmission,
  validateProfileSubmission,
} from "../src/lib/agent/webchat-forms.ts";

function canonicalizeStub(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("60")) return digits;
  if (digits.startsWith("0")) return `60${digits.slice(1)}`;
  return digits;
}

const AGENT_IDS = ["a1", "a2"];

function addLead(input: Record<string, unknown>) {
  return validateAddLeadSubmission(input, { canonicalize: canonicalizeStub, agentIds: AGENT_IDS });
}

test("add lead: a complete form canonicalizes the phone and keeps every field", () => {
  const result = addLead({
    leadName: "  Ali Bin Ahmad  ",
    leadMobileNumber: "012-345 6789",
    area: " Johor ",
    preferredAgentId: "a2",
    remark: " Wants a quote ",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value, {
    leadName: "Ali Bin Ahmad",
    leadMobileNumber: "60123456789",
    area: "Johor",
    preferredAgentId: "a2",
    remark: "Wants a quote",
  });
});

test("add lead: name and phone are required, area/agent/remark are not", () => {
  const missing = addLead({ leadName: "  ", leadMobileNumber: "" });
  assert.equal(missing.ok, false);
  assert.ok(!missing.ok && missing.errors.leadName);
  assert.ok(!missing.ok && missing.errors.leadMobileNumber);

  const minimal = addLead({ leadName: "Ali", leadMobileNumber: "0123456789" });
  assert.equal(minimal.ok, true);
  assert.equal(minimal.ok && minimal.value.area, "");
  assert.equal(minimal.ok && minimal.value.preferredAgentId, "");
  assert.equal(minimal.ok && minimal.value.remark, "");
});

test("add lead: a phone that is present but malformed reports a format error", () => {
  const result = addLead({ leadName: "Ali", leadMobileNumber: "123" });
  assert.equal(result.ok, false);
  assert.match((!result.ok && result.errors.leadMobileNumber) || "", /valid phone number/);
});

test("add lead: an agent id that is not on the offered list is rejected", () => {
  const result = addLead({ leadName: "Ali", leadMobileNumber: "0123456789", preferredAgentId: "a9" });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.errors.preferredAgentId);
});

test("add lead: over-long free text is truncated rather than rejected", () => {
  const result = addLead({
    leadName: "Ali",
    leadMobileNumber: "0123456789",
    remark: "x".repeat(MAX_REMARK + 50),
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.remark.length, MAX_REMARK);
});

test("add lead: non-string fields are treated as empty, not coerced", () => {
  const result = addLead({ leadName: 42, leadMobileNumber: "0123456789" });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.errors.leadName);
});

test("profile: all three fields are required", () => {
  const result = validateProfileSubmission({ name: "", bankAccount: "", icNumber: "" });
  assert.equal(result.ok, false);
  assert.deepEqual(
    !result.ok && Object.keys(result.errors).sort(),
    ["bankAccount", "icNumber", "name"],
  );
});

test("profile: a complete form trims each value", () => {
  const result = validateProfileSubmission({
    name: "  Siti  ",
    bankAccount: " Maybank 1234567890 ",
    icNumber: " 900101-14-5678 ",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value, {
    name: "Siti",
    bankAccount: "Maybank 1234567890",
    icNumber: "900101-14-5678",
  });
});

test("profile: an IC with too few alphanumerics is rejected, separators do not count", () => {
  const tooShort = validateProfileSubmission({ name: "Siti", bankAccount: "123", icNumber: "12-34" });
  assert.equal(tooShort.ok, false);
  assert.match((!tooShort.ok && tooShort.errors.icNumber) || "", /too short/);

  // A passport number is a valid IC value here — the check is deliberately loose.
  const passport = validateProfileSubmission({ name: "Siti", bankAccount: "123", icNumber: "A1234567" });
  assert.equal(passport.ok, true);
});

test("maskSensitive keeps only the last four characters, ignoring spacing", () => {
  assert.equal(maskSensitive("Maybank 1234567890"), "••••7890");
  assert.equal(maskSensitive("900101-14-5678"), "••••5678");
});

test("maskSensitive reveals nothing when the value is four characters or fewer", () => {
  assert.equal(maskSensitive("1234"), "••••");
  assert.equal(maskSensitive("12"), "••••");
  assert.equal(maskSensitive(""), "••••");
  // Spaces must not pad a short secret past the threshold.
  assert.equal(maskSensitive("1 2 3"), "••••");
});

/**
 * Shared shapes and pure validators for the two webchat forms.
 *
 * Both the browser (src/components/web-chat.tsx) and the server
 * (src/app/api/web-chat/form/route.ts) import this module, so the same rules
 * decide what a valid submission is on each side. The browser validation is a
 * convenience only — the route re-runs it and is the authority.
 *
 * IMPORTANT: this module must stay free of runtime imports (type-only imports
 * are fine) — the node:test runner loads it directly and cannot resolve the
 * "@/" path alias. Callers that need phone canonicalization pass the function
 * in, the same way webchat-flow-logic.ts does.
 */

export type WebchatAgentOption = { id: string; name: string };

/** "1. Add Lead" — one form, submitted in a single shot. */
export type WebchatAddLeadForm = {
  kind: "add_lead";
  // Field 2 of the form: the referrer is never typed, it is whoever is logged in.
  referrer: { name: string; phone: string };
  agents: WebchatAgentOption[];
};

/** "4. My Details" — the referrer's own payout profile. */
export type WebchatProfileForm = {
  kind: "profile";
  phone: string;
  values: {
    name: string;
    bankName: string;
    bankAccount: string;
    icNumber: string;
    tin: string;
    mykadAddress: string;
  };
};

export type WebchatForm = WebchatAddLeadForm | WebchatProfileForm;

export type AddLeadSubmission = {
  leadName: string;
  leadMobileNumber: string;
  area: string;
  preferredAgentId: string;
  remark: string;
};

export type ProfileSubmission = {
  name: string;
  bankName: string;
  bankAccount: string;
  icNumber: string;
  tin: string;
  mykadAddress: string;
};

export type FieldErrors = Record<string, string>;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

export const MAX_LEAD_NAME = 200;
export const MAX_AREA = 200;
export const MAX_REMARK = 500;
export const MAX_REFERRER_NAME = 120;
export const MAX_BANK_NAME = 80;
export const MAX_BANK_ACCOUNT = 80;
export const MAX_IC_NUMBER = 40;
export const MAX_TIN = 40;
export const MAX_MYKAD_ADDRESS = 400;

export function isPlausibleMalaysiaMobile(canonicalPhone: string) {
  return /^60\d{9,11}$/.test(canonicalPhone);
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function alphanumericLength(value: string) {
  return value.replace(/[^A-Za-z0-9]/g, "").length;
}

/**
 * Bank account, IC, and TIN values are saved in full on the referrer's record,
 * but the chat transcript is a different audience: it is replayed into the
 * browser and shown in admin message views. Echo only the last four characters
 * there.
 */
export function maskSensitive(value: string) {
  const compact = value.replace(/\s+/g, "");
  if (compact.length <= 4) return "••••";
  return `••••${compact.slice(-4)}`;
}

export function validateAddLeadSubmission(
  input: Partial<Record<keyof AddLeadSubmission, unknown>>,
  options: { canonicalize: (value: string) => string; agentIds: string[] },
): ValidationResult<AddLeadSubmission> {
  const errors: FieldErrors = {};

  const leadName = text(input.leadName, MAX_LEAD_NAME);
  if (!leadName) {
    errors.leadName = "Enter the lead's name.";
  }

  const rawPhone = typeof input.leadMobileNumber === "string" ? input.leadMobileNumber : "";
  const leadMobileNumber = options.canonicalize(rawPhone);
  if (!rawPhone.trim()) {
    errors.leadMobileNumber = "Enter the lead's phone number.";
  } else if (!isPlausibleMalaysiaMobile(leadMobileNumber)) {
    errors.leadMobileNumber = "That doesn't look like a valid phone number, e.g. 012-345 6789.";
  }

  const preferredAgentId = text(input.preferredAgentId, 120);
  if (preferredAgentId && !options.agentIds.includes(preferredAgentId)) {
    errors.preferredAgentId = "Pick an agent from the list.";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      leadName,
      leadMobileNumber,
      area: text(input.area, MAX_AREA),
      preferredAgentId,
      remark: text(input.remark, MAX_REMARK),
    },
  };
}

export function validateProfileSubmission(
  input: Partial<Record<keyof ProfileSubmission, unknown>>,
): ValidationResult<ProfileSubmission> {
  const errors: FieldErrors = {};

  const name = text(input.name, MAX_REFERRER_NAME);
  if (!name) {
    errors.name = "Enter your name.";
  }

  const bankName = text(input.bankName, MAX_BANK_NAME);
  if (!bankName) {
    errors.bankName = "Enter your bank.";
  } else if (!/[A-Za-z]/.test(bankName)) {
    errors.bankName = "Enter the bank name, for example Maybank or CIMB.";
  }

  const bankAccount = text(input.bankAccount, MAX_BANK_ACCOUNT);
  if (!bankAccount) {
    errors.bankAccount = "Enter your bank account number.";
  } else if (bankAccount.replace(/\D/g, "").length < 5) {
    errors.bankAccount = "That account number looks too short.";
  }

  // IC formats vary (old 7-digit, new 12-digit, passport for non-citizens), so
  // this only rejects obvious junk rather than enforcing one layout.
  const icNumber = text(input.icNumber, MAX_IC_NUMBER);
  if (!icNumber) {
    errors.icNumber = "Enter your IC number.";
  } else if (alphanumericLength(icNumber) < 6) {
    errors.icNumber = "That IC number looks too short.";
  }

  // LHDN tax account numbers vary (IG/SG prefixes, hyphens, or a MyKad used as
  // the TIN). Require a real identifier and reject obvious junk.
  const tin = text(input.tin, MAX_TIN);
  if (!tin) {
    errors.tin = "Enter your TIN (tax account number).";
  } else if (alphanumericLength(tin) < 8) {
    errors.tin = "That TIN looks too short.";
  }

  const mykadAddress = text(input.mykadAddress, MAX_MYKAD_ADDRESS);
  if (!mykadAddress) {
    errors.mykadAddress = "Enter your address as shown on your MyKad.";
  } else if (mykadAddress.length < 8) {
    errors.mykadAddress = "Enter the full address printed on your MyKad.";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: { name, bankName, bankAccount, icNumber, tin, mykadAddress } };
}

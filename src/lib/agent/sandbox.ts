import type { ReferralRow, ReferrerAccount } from "@/lib/referrals";

import { getSandboxReferrerByPhone, listSandboxReferralsByReferrer } from "@/lib/agent/sandbox-data";

export const DEFAULT_SANDBOX_PHONE = "601121000099";

export type AgentSandboxSnapshot = {
  phone: string;
  referrer: ReferrerAccount | null;
  referrals: ReferralRow[];
};

function normalizeSandboxPhone(phone: string | null | undefined) {
  const value = (phone || DEFAULT_SANDBOX_PHONE).replace(/\s+/g, "").trim();
  return value || DEFAULT_SANDBOX_PHONE;
}

export async function getAgentSandboxSnapshot(phoneInput?: string): Promise<AgentSandboxSnapshot> {
  const phone = normalizeSandboxPhone(phoneInput);
  const referrer = await getSandboxReferrerByPhone(phone);

  if (!referrer) {
    return {
      phone,
      referrer: null,
      referrals: [],
    };
  }

  const referrals = await listSandboxReferralsByReferrer(referrer.customerId);

  return {
    phone,
    referrer,
    referrals,
  };
}

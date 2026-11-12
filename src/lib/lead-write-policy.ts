/**
 * Single add-lead method policy.
 *
 * Leads may ONLY be created through the webchat (https://referral.atap.solar/webchat),
 * which submits to /api/web-chat/form and persists through createWhatsappReferral().
 *
 * Every other writer (public API, dashboard form, agent sandbox) wrote leads with a
 * different column layout (assigned_agent vs linked_agent, status, lead_source,
 * created_by). Mixing them produced inconsistent rows, so those writers are retired.
 * They are blocked at the persistence function itself, not only at the route, so a
 * future caller cannot bypass the policy.
 */

export const ALLOWED_LEAD_ROUTE = "/webchat";
export const ALLOWED_LEAD_URL = "https://referral.atap.solar/webchat";

export type RetiredLeadChannel = "api" | "dashboard" | "sandbox";

export const RETIRED_LEAD_MESSAGE =
  `Adding leads here has been retired. Please add leads through the webchat: ${ALLOWED_LEAD_URL}`;

/**
 * Records the blocked attempt (channel only, never lead details) so retired
 * callers can be found in the logs. Never throws.
 */
export function recordRetiredLeadAttempt(channel: RetiredLeadChannel) {
  try {
    console.warn(`[lead-write-policy] Blocked retired add-lead method "${channel}". Allowed: ${ALLOWED_LEAD_ROUTE}`);
  } catch {
    // Logging must never change the outcome.
  }
}

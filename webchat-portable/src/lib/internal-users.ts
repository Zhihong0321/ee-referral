import type { AuthHubUser } from "@/lib/auth";
import { query } from "@/lib/db";

export type InternalAppUser = {
  bubbleId: string;
  name: string;
  accessLevels: string[];
  linkedAgentProfile: string | null;
  agentId: string | null;
  agentBubbleId: string | null;
  agentName: string | null;
};

function normalizePhone(phone: string) {
  return phone.replace(/\D+/g, "").trim();
}

function normalizeAccessLevels(accessLevels: string[] | null): string[] {
  if (!Array.isArray(accessLevels)) {
    return [];
  }

  return accessLevels
    .map((level) => level.trim())
    .filter((level) => level.length > 0);
}

export function hasAnyAccessLevel(accessLevels: string[], expected: string[]) {
  const expectedSet = new Set(expected.map((value) => value.trim().toLowerCase()));

  return accessLevels.some((value) => expectedSet.has(value.trim().toLowerCase()));
}

export async function findInternalAppUser(authUser: AuthHubUser): Promise<InternalAppUser | null> {
  const normalizedPhone = normalizePhone(authUser.phone);
  const authUserId = authUser.userId?.trim() || null;

  const userResult = await query<{
    bubble_id: string;
    name: string | null;
    access_level: string[] | null;
    linked_agent_profile: string | null;
  }>(
    `
      SELECT bubble_id, name, access_level, linked_agent_profile
      FROM "user"
      WHERE (
        $1::text IS NOT NULL
        AND bubble_id = $1
      )
      OR (
        $2::text <> ''
        AND regexp_replace(COALESCE(contact, ''), '[^0-9]+', '', 'g') = $2
      )
      ORDER BY
        CASE
          WHEN $1::text IS NOT NULL AND bubble_id = $1 THEN 0
          ELSE 1
        END,
        updated_at DESC NULLS LAST,
        id DESC
      LIMIT 1
    `,
    [authUserId, normalizedPhone],
  );

  const matchedUser = userResult.rows[0];

  if (!matchedUser) {
    return null;
  }

  const agentResult = await query<{
    id: number;
    bubble_id: string;
    name: string | null;
  }>(
    `
      SELECT id, bubble_id, name
      FROM agent
      WHERE (
        $1::text IS NOT NULL
        AND bubble_id = $1
      )
      OR linked_user_login = $2
      ORDER BY
        CASE
          WHEN $1::text IS NOT NULL AND bubble_id = $1 THEN 0
          WHEN linked_user_login = $2 THEN 1
          ELSE 2
        END,
        updated_at DESC NULLS LAST,
        id DESC
      LIMIT 1
    `,
    [matchedUser.linked_agent_profile, matchedUser.bubble_id],
  );

  const matchedAgent = agentResult.rows[0];

  return {
    bubbleId: matchedUser.bubble_id,
    name: matchedUser.name?.trim() || authUser.name?.trim() || authUser.phone,
    accessLevels: normalizeAccessLevels(matchedUser.access_level),
    linkedAgentProfile: matchedUser.linked_agent_profile,
    agentId: matchedAgent ? String(matchedAgent.id) : null,
    agentBubbleId: matchedAgent?.bubble_id ?? null,
    agentName: matchedAgent?.name?.trim() ?? null,
  };
}

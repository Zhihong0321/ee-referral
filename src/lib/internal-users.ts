import type { AuthHubUser } from "@/lib/auth";
import { query } from "@/lib/db";

export type InternalAppUser = {
  userId: string;
  bubbleId: string;
  name: string;
  accessLevels: string[];
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
    id: number;
    bubble_id: string;
    name: string | null;
    access_level: string[] | null;
  }>(
    `
      SELECT id, bubble_id, name, access_level
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

  if (!matchedUser?.bubble_id?.trim()) {
    return null;
  }

  return {
    userId: String(matchedUser.id),
    bubbleId: matchedUser.bubble_id.trim(),
    name: matchedUser.name?.trim() || authUser.name?.trim() || authUser.phone,
    accessLevels: normalizeAccessLevels(matchedUser.access_level),
  };
}

-- One-time data migration for both preferred and assigned referral agents.
-- Normal application code must not read the legacy agent table. This script
-- reads it only to translate old agent identifiers to the linked user row.
--
-- Canonical key after this migration: user.bubble_id
-- referral.linked_agent: preferred user
-- referral.assigned_agent: manager-assigned user
--
-- If a numeric legacy key matches user.id and agent.id, user.id takes priority.
-- Review the unresolved rows first, then run the UPDATE block.

ALTER TABLE referral
ADD COLUMN IF NOT EXISTS assigned_agent varchar;

-- Show legacy references that cannot be mapped to a user.
WITH referral_agent_refs AS (
  SELECT 'linked_agent'::text AS source_column, linked_agent AS legacy_key
  FROM referral
  WHERE linked_agent IS NOT NULL AND BTRIM(linked_agent) <> ''
  UNION ALL
  SELECT 'assigned_agent'::text AS source_column, assigned_agent AS legacy_key
  FROM referral
  WHERE assigned_agent IS NOT NULL AND BTRIM(assigned_agent) <> ''
)
SELECT refs.source_column, refs.legacy_key, COUNT(*) AS referral_count
FROM referral_agent_refs refs
WHERE NOT EXISTS (
    SELECT 1 FROM "user" u
    WHERE u.bubble_id = refs.legacy_key
       OR (refs.legacy_key ~ '^[0-9]+$' AND u.id = refs.legacy_key::bigint)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM agent a
    JOIN "user" u ON u.bubble_id = a.linked_user_login
    WHERE a.bubble_id = refs.legacy_key
       OR (refs.legacy_key ~ '^[0-9]+$' AND a.id = refs.legacy_key::bigint)
  )
GROUP BY refs.source_column, refs.legacy_key
ORDER BY refs.source_column, refs.legacy_key;

-- Do not partially migrate records whose legacy key has no user mapping.
DO $$
DECLARE
  unmapped_count bigint;
BEGIN
  WITH referral_agent_refs AS (
    SELECT linked_agent AS legacy_key FROM referral
    WHERE linked_agent IS NOT NULL AND BTRIM(linked_agent) <> ''
    UNION ALL
    SELECT assigned_agent AS legacy_key FROM referral
    WHERE assigned_agent IS NOT NULL AND BTRIM(assigned_agent) <> ''
  )
  SELECT COUNT(*) INTO unmapped_count
  FROM referral_agent_refs refs
  WHERE NOT EXISTS (
      SELECT 1 FROM "user" u
      WHERE u.bubble_id = refs.legacy_key
         OR (refs.legacy_key ~ '^[0-9]+$' AND u.id = refs.legacy_key::bigint)
    )
    AND NOT EXISTS (
      SELECT 1 FROM agent a
      JOIN "user" u ON u.bubble_id = a.linked_user_login
      WHERE a.bubble_id = refs.legacy_key
         OR (refs.legacy_key ~ '^[0-9]+$' AND a.id = refs.legacy_key::bigint)
    );

  IF unmapped_count > 0 THEN
    RAISE EXCEPTION 'Migration stopped: % referral agent references have no matching user. Resolve them before retrying.', unmapped_count;
  END IF;
END $$;

BEGIN;

-- Normalize preferred-agent references to user.bubble_id.
WITH source_rows AS (
  SELECT id, linked_agent AS legacy_key
  FROM referral
  WHERE linked_agent IS NOT NULL AND BTRIM(linked_agent) <> ''
), resolved AS (
  SELECT
    source_rows.id,
    COALESCE(
      (SELECT u.bubble_id FROM "user" u WHERE u.bubble_id = source_rows.legacy_key LIMIT 1),
      (SELECT u.bubble_id FROM "user" u
       WHERE source_rows.legacy_key ~ '^[0-9]+$' AND u.id = source_rows.legacy_key::bigint LIMIT 1),
      (SELECT u.bubble_id FROM agent a JOIN "user" u ON u.bubble_id = a.linked_user_login
       WHERE a.bubble_id = source_rows.legacy_key ORDER BY u.id LIMIT 1),
      (SELECT u.bubble_id FROM agent a JOIN "user" u ON u.bubble_id = a.linked_user_login
       WHERE source_rows.legacy_key ~ '^[0-9]+$' AND a.id = source_rows.legacy_key::bigint ORDER BY u.id LIMIT 1)
    ) AS user_bubble_id
  FROM source_rows
)
UPDATE referral r
SET linked_agent = resolved.user_bubble_id,
    updated_at = NOW()
FROM resolved
WHERE r.id = resolved.id
  AND resolved.user_bubble_id IS NOT NULL
  AND r.linked_agent IS DISTINCT FROM resolved.user_bubble_id;

-- Normalize manager-assigned references to user.bubble_id.
WITH source_rows AS (
  SELECT id, assigned_agent AS legacy_key
  FROM referral
  WHERE assigned_agent IS NOT NULL AND BTRIM(assigned_agent) <> ''
), resolved AS (
  SELECT
    source_rows.id,
    COALESCE(
      (SELECT u.bubble_id FROM "user" u WHERE u.bubble_id = source_rows.legacy_key LIMIT 1),
      (SELECT u.bubble_id FROM "user" u
       WHERE source_rows.legacy_key ~ '^[0-9]+$' AND u.id = source_rows.legacy_key::bigint LIMIT 1),
      (SELECT u.bubble_id FROM agent a JOIN "user" u ON u.bubble_id = a.linked_user_login
       WHERE a.bubble_id = source_rows.legacy_key ORDER BY u.id LIMIT 1),
      (SELECT u.bubble_id FROM agent a JOIN "user" u ON u.bubble_id = a.linked_user_login
       WHERE source_rows.legacy_key ~ '^[0-9]+$' AND a.id = source_rows.legacy_key::bigint ORDER BY u.id LIMIT 1)
    ) AS user_bubble_id
  FROM source_rows
)
UPDATE referral r
SET assigned_agent = resolved.user_bubble_id,
    updated_at = NOW()
FROM resolved
WHERE r.id = resolved.id
  AND resolved.user_bubble_id IS NOT NULL
  AND r.assigned_agent IS DISTINCT FROM resolved.user_bubble_id;

COMMIT;

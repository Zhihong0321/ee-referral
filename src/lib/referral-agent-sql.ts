// Existing dashboards use numeric user IDs in their controls. API assignments
// store Bubble IDs; resolve either format without casting arbitrary text.
export function assignedUserJoin(column: string, alias: string) {
  return `LEFT JOIN LATERAL (
    SELECT u.id, u.bubble_id, u.name FROM "user" u
    WHERE u.bubble_id = ${column} OR u.id::text = ${column}
    ORDER BY CASE WHEN u.bubble_id = ${column} THEN 0 ELSE 1 END, u.id
    LIMIT 1
  ) ${alias} ON TRUE`;
}

export function assignedUserMatch(column: string, parameter: number) {
  return `(${column} = $${parameter} OR EXISTS (
    SELECT 1 FROM "user" matched_user
    WHERE (matched_user.bubble_id = $${parameter} OR matched_user.id::text = $${parameter})
      AND (${column} = matched_user.bubble_id OR ${column} = matched_user.id::text)
  ))`;
}

const URL = "https://pg-proxy-production.up.railway.app/api/sql";
const AUTH = process.env.PG_PROXY_AUTH;
if (!AUTH) {
  console.error("Set PG_PROXY_AUTH env var");
  process.exit(2);
}
async function q(sql, params = []) {
  const r = await fetch(URL, {
    method: "POST",
    headers: { Authorization: AUTH, "Content-Type": "application/json" },
    body: JSON.stringify({ db_name: "prod_main", sql, params }),
  });
  const t = await r.text();
  const j = JSON.parse(t);
  if (!r.ok || j.error) throw new Error(j.error || t);
  return j.rows || [];
}

const updated = await q(`
  UPDATE "user" u
  SET name = BTRIM(a.name), updated_at = NOW()
  FROM agent a
  WHERE u.linked_agent_profile = a.bubble_id
    AND (u.name IS NULL OR BTRIM(u.name) = '')
    AND BTRIM(COALESCE(a.name,'')) <> ''
  RETURNING u.id, u.name`);
console.log("PATCHED " + updated.length + " rows");
console.log(JSON.stringify(updated, null, 2));

const koh = await q(`
  SELECT u.id, u.name FROM "user" u
  WHERE u.name IS NOT NULL AND BTRIM(u.name) <> ''
    AND EXISTS (SELECT 1 FROM unnest(u.access_level) x WHERE LOWER(x) LIKE '%sales%')
    AND LOWER(u.name) LIKE '%koh%' ORDER BY u.id`);
console.log("ROSTER 'koh' NOW:", JSON.stringify(koh, null, 2));

const left = await q(
  `SELECT COUNT(*)::int n FROM "user" u WHERE (u.name IS NULL OR BTRIM(u.name)='') AND EXISTS(SELECT 1 FROM unnest(u.access_level) x WHERE LOWER(x) LIKE '%sales%')`,
);
console.log("SALES USERS STILL NAME-LESS:", left[0].n);

import { readFileSync } from "fs";

const env = readFileSync(".env.local", "utf8");
const cfg = {};
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) cfg[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
const url = cfg.WHATSAPP_AGENT_PROXY_URL || cfg.SANDBOX_PROXY_URL;
const auth = cfg.WHATSAPP_AGENT_PROXY_AUTH || cfg.SANDBOX_PROXY_AUTH;
const db = cfg.WHATSAPP_AGENT_PROXY_DB_NAME || cfg.SANDBOX_PROXY_DB_NAME;
if (!url || !auth || !db) {
  console.error("Missing proxy config in .env.local");
  process.exit(2);
}

async function q(sql, params = []) {
  const sqlUrl = url.replace(/\/$/, "") + "/api/sql";
  const res = await fetch(sqlUrl, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ db_name: db, sql, params }),
    cache: "no-store",
  });
  const t = await res.text();
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    throw new Error("HTTP " + res.status + ": " + t.slice(0, 300));
  }
  if (!res.ok || j.error) throw new Error(j.error || "HTTP " + res.status);
  return j.rows || [];
}

// 1) Is Koh in the user table, and what is access_level?
const koh = await q(
  `SELECT id, name, access_level, contact FROM "user" WHERE LOWER(name) LIKE $1 ORDER BY id`,
  ["%koh%"],
);
console.log("KOH ROWS:", JSON.stringify(koh, null, 2));

// 2) Reproduce exactly what listWhatsappAgents() returns for Koh — does the sales filter pass?
const filtered = await q(
  `SELECT u.id, u.name, u.access_level
     FROM "user" u
    WHERE u.name IS NOT NULL AND BTRIM(u.name) <> ''
      AND EXISTS (SELECT 1 FROM unnest(u.access_level) AS x WHERE LOWER(x) LIKE '%sales%')
      AND LOWER(u.name) LIKE $1`,
  ["%koh%"],
);
console.log("PASSES SALES FILTER:", JSON.stringify(filtered, null, 2));

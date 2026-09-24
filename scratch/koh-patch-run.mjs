import { readFileSync } from "fs";
const env = readFileSync(".env.local","utf8"); const cfg={};
for(const l of env.split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)cfg[m[1]]=m[2].replace(/^["']|["']$/g,"").trim();}
const url=cfg.WHATSAPP_AGENT_PROXY_URL, auth=cfg.WHATSAPP_AGENT_PROXY_AUTH, db=cfg.WHATSAPP_AGENT_PROXY_DB_NAME;
async function q(sql,params=[]){const r=await fetch(url.replace(/\/$/,"")+"/api/sql",{method:"POST",headers:{Authorization:auth,"Content-Type":"application/json"},body:JSON.stringify({db_name:db,sql,params})});const t=await r.text();const j=JSON.parse(t);if(!r.ok||j.error)throw new Error(j.error||t);return j.rows||[];}

const updated = await q(`
  UPDATE "user" u
  SET name = BTRIM(a.name), updated_at = NOW()
  FROM agent a
  WHERE u.linked_agent_profile = a.bubble_id
    AND (u.name IS NULL OR BTRIM(u.name) = '')
    AND BTRIM(COALESCE(a.name,'')) <> ''
  RETURNING u.id, u.name`);
console.log("PATCHED " + updated.length + " rows:");
console.log(JSON.stringify(updated, null, 2));

// verify: Koh Yi Jay now passes the exact roster query
const roster = await q(`
  SELECT u.id, u.name FROM "user" u
  WHERE u.name IS NOT NULL AND BTRIM(u.name) <> ''
    AND EXISTS (SELECT 1 FROM unnest(u.access_level) x WHERE LOWER(x) LIKE '%sales%')
    AND LOWER(u.name) LIKE '%koh yi jay%'`);
console.log("ROSTER NOW INCLUDES KOH YI JAY:", JSON.stringify(roster));

// residual: any sales users still name-less?
const left = await q(`SELECT COUNT(*)::int n FROM "user" u WHERE (u.name IS NULL OR BTRIM(u.name)='') AND EXISTS(SELECT 1 FROM unnest(u.access_level) x WHERE LOWER(x) LIKE '%sales%')`);
console.log("SALES USERS STILL NAME-LESS:", left[0].n);
